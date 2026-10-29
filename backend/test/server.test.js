const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { io: connectClient } = require('socket.io-client');
const { createGameServer } = require('../src/server');

function waitFor(socket, event, predicate = () => true) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            socket.off(event, handler);
            reject(new Error(`Timed out waiting for ${event}`));
        }, 3000);
        const handler = data => {
            if (!predicate(data)) return;
            clearTimeout(timer);
            socket.off(event, handler);
            resolve(data);
        };
        socket.on(event, handler);
    });
}

async function setup(t) {
    const instance = createGameServer();
    const clients = [];
    instance.server.listen(0, '127.0.0.1');
    await once(instance.server, 'listening');
    const url = `http://127.0.0.1:${instance.server.address().port}`;
    t.after(async () => {
        clients.forEach(client => client.disconnect());
        Object.values(instance.gameManager.games).forEach(game => instance.gameManager.clearTimers(game));
        await new Promise(resolve => instance.io.close(resolve));
    });
    async function connect(options = {}) {
        const client = connectClient(url, {
            autoConnect: false, reconnection: false, transports: ['websocket'], ...options
        });
        clients.push(client);
        const connected = waitFor(client, 'connect');
        client.connect();
        await connected;
        return client;
    }
    return { ...instance, url, clients, connect };
}

test('real clients reject malformed messages and forged cards while normal play succeeds', async t => {
    const { connect, gameManager } = await setup(t);
    const p1 = await connect();
    const p2 = await connect();
    const viewer = await connect();
    let update = waitFor(p1, 'game_update');
    p1.emit('join_game', { gameId: 'network-room' });
    await update;
    const dealt = waitFor(p1, 'hand_update');
    update = waitFor(p1, 'game_update', data => data.players.length === 2);
    p2.emit('join_game', { gameId: 'network-room' });
    const original = (await dealt).hand;
    await update;
    const spectating = waitFor(viewer, 'spectator_join');
    viewer.emit('spectator_join', { gameId: 'network-room' });
    assert.deepEqual((await spectating).players[0].hand, Array(5).fill('back'));

    for (const event of ['join_game', 'spectator_join', 'start_game', 'mouse_move', 'card_drag',
        'card_positions', 'play_card', 'reorder_hand', 'request_hand', 'radio_action', 'place_bet', 'request_play_again']) {
        const rejected = waitFor(p1, 'error');
        p1.emit(event, null);
        assert.match((await rejected).message, /Invalid/);
    }
    const rejected = waitFor(p1, 'error');
    p1.emit('join_game', { gameId: '__proto__' });
    await rejected;

    update = waitFor(p1, 'game_update', data => data.state === 'playing');
    p1.emit('place_bet', { gameId: 'network-room', amount: 1 });
    p2.emit('place_bet', { gameId: 'network-room', amount: 1 });
    await update;
    const hand = waitFor(p1, 'hand_update');
    p1.emit('reorder_hand', { gameId: 'network-room', newHand: Array(5).fill('slave') });
    p1.emit('play_card', { gameId: 'network-room', cardIndex: 'slave' });
    p1.emit('request_hand', { gameId: 'network-room' });
    assert.deepEqual((await hand).hand, original);
    assert.equal(gameManager.getGame('network-room').players[0].playedCard, null);

    const barrier = waitFor(viewer, 'error');
    viewer.emit('radio_action', { gameId: 'network-room', action: { type: 'play_track', trackIndex: 3 } });
    viewer.emit('request_play_again', { gameId: 'network-room' });
    viewer.emit('radio_action', null);
    await barrier;
    assert.equal(gameManager.getGame('network-room').radio.trackIndex, 0);
    assert.equal(gameManager.getGame('network-room').state, 'playing');

    const result = waitFor(p1, 'round_result');
    p1.emit('play_card', { gameId: 'network-room', cardIndex: 'emperor' });
    p2.emit('play_card', { gameId: 'network-room', cardIndex: 'citizen' });
    assert.equal((await result).winner, 'p1_wins');
});

test('browser origins are checked for both polling and WebSocket connections', async t => {
    const { url, clients } = await setup(t);
    const path = `${url}/socket.io/?EIO=4&transport=polling`;
    const allowed = await fetch(path, { headers: { Origin: 'http://localhost:5173' } });
    assert.equal(allowed.status, 200);
    await allowed.text();
    const blocked = await fetch(path, { headers: { Origin: 'https://untrusted.example' } });
    assert.equal(blocked.status, 403);
    await blocked.text();
    const client = connectClient(url, {
        autoConnect: false, reconnection: false, transports: ['websocket'],
        extraHeaders: { Origin: 'https://untrusted.example' }
    });
    clients.push(client);
    const rejection = waitFor(client, 'connect_error');
    client.connect();
    await rejection;
    assert.equal(client.connected, false);
});

test('a user-chosen room ID cannot join another connection\'s private room', async t => {
    const { io, connect } = await setup(t);
    const victim = await connect();
    const attacker = await connect();
    const joined = waitFor(attacker, 'game_update');
    attacker.emit('join_game', { gameId: victim.id });
    await joined;
    assert.equal(io.sockets.adapter.rooms.get(victim.id).has(attacker.id), false);
    assert.equal(io.sockets.adapter.rooms.get(`game:${victim.id}`).has(attacker.id), true);
});
