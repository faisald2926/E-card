const test = require('node:test');
const assert = require('node:assert/strict');
const { GameManager } = require('../src/gameManager');
const { registerSocketHandlers } = require('../src/socketHandlers');

function setup(t, config) {
    const emissions = [];
    const io = {
        to: room => ({ emit: (event, data) => emissions.push({ room, event, data: structuredClone(data) }) }),
        in: room => ({ socketsLeave: () => emissions.push({ room, event: 'leave' }) })
    };
    const manager = new GameManager(io);
    const socket = id => ({
        id, handlers: new Map(), rooms: new Set(),
        on(event, handler) { this.handlers.set(event, handler); },
        emit(event, data) { emissions.push({ room: this.id, event, data: structuredClone(data) }); },
        join(room) { this.rooms.add(room); },
        to: io.to
    });
    const p1 = socket('player1');
    const p2 = socket('player2');
    manager.handleJoin(p1, 'room', config);
    manager.handleJoin(p2, 'room');
    t.after(() => Object.values(manager.games).forEach(game => manager.clearTimers(game)));
    return { manager, p1, p2, socket, emissions, game: manager.getGame('room') };
}

test('reordering preserves cards and duplicate counts; forged and malformed hands are rejected', t => {
    const { manager, p1, game } = setup(t);
    const original = [...game.players[0].hand];
    for (const proposed of [undefined, null, {}, 'abcde', ['slave', 'citizen', 'citizen', 'citizen', 'citizen'],
        ['emperor', 'emperor', 'citizen', 'citizen', 'citizen'], ['citizen'], Array(5).fill('unknown')]) {
        manager.handleHandReorder(p1, 'room', proposed);
        assert.deepEqual(game.players[0].hand, original);
    }
    const reordered = [...original].reverse();
    manager.handleHandReorder(p1, 'room', reordered);
    assert.deepEqual(game.players[0].hand, reordered);
    reordered.fill('slave');
    assert.deepEqual(game.players[0].hand, [...original].reverse());
});

test('reserved and malformed room IDs are rejected without changing the game registry', t => {
    const { manager, socket } = setup(t);
    for (const room of ['__proto__', 'constructor', 'prototype', '', 'a'.repeat(65), 'room name', {}, [], 123, null, undefined]) {
        assert.doesNotThrow(() => manager.handleJoin(socket('outsider'), room));
        assert.equal(manager.getGame(room), undefined);
    }
    assert.deepEqual(Object.keys(manager.games), ['room']);
    manager.handleJoin(socket('new-player'), 'toString');
    assert.equal(manager.getGame('toString').players.length, 1);
});

test('invalid game settings cannot create a room or poison score calculations', t => {
    const { manager, socket } = setup(t);
    for (const config of [null, [], { initialHearts: '20' }, { initialHearts: Infinity },
        { maxRounds: 0 }, { swapInterval: 0 }, { revealSpectatorHands: 'true' }]) {
        manager.handleJoin(socket('outsider'), 'invalid', config);
        assert.equal(manager.getGame('invalid'), undefined);
    }
});

test('a socket cannot occupy both seats or gain a spectator identity', t => {
    const { manager, p1, game, socket } = setup(t);
    manager.handleJoin(p1, 'room');
    manager.handleJoin(p1, 'another');
    manager.handleSpectatorJoin(p1, 'room');
    assert.equal(game.players.length, 2);
    assert.equal(game.spectators.length, 0);
    assert.equal(manager.getGame('another'), undefined);
    const spectator = socket('viewer');
    manager.handleSpectatorJoin(spectator, 'room');
    manager.handleSpectatorJoin(spectator, 'room');
    manager.handleJoin(spectator, 'another');
    assert.deepEqual(game.spectators, ['viewer']);
    assert.equal(manager.getGame('another'), undefined);
});

test('spectators see card backs and no unrevealed choice by default', t => {
    const { manager, p1, p2, game } = setup(t);
    manager.handleBet(p1, 'room', 1);
    manager.handleBet(p2, 'room', 1);
    manager.handlePlayCard(p1, 'room', 'emperor');
    const state = manager.getSpectatorState('room');
    assert.deepEqual(state.players[0].hand, Array(4).fill('back'));
    assert.equal(state.players[0].playedCard, null);
    assert.equal(state.players[0].hasPlayed, true);
    assert.equal(JSON.stringify(manager.getPublicState('room')).includes('"hand":'), false);
    assert.equal(game.players[0].playedCard, 'emperor');
});

test('the room creator can explicitly enable full-hand spectator viewing', t => {
    const { manager, game } = setup(t, { revealSpectatorHands: true });
    const state = manager.getSpectatorState('room');
    assert.deepEqual(state.players[0].hand, game.players[0].hand);
    state.players[0].hand.pop();
    assert.equal(game.players[0].hand.length, 5);
});

test('spectators cannot change the radio, bet, play, reorder, or request a rematch', t => {
    const { manager, socket, game } = setup(t);
    const spectator = socket('viewer');
    manager.handleSpectatorJoin(spectator, 'room');
    manager.handleRadioAction(spectator, 'room', { type: 'play_track', trackIndex: 2 });
    manager.handleBet(spectator, 'room', 5);
    manager.handlePlayCard(spectator, 'room', 'emperor');
    manager.handleHandReorder(spectator, 'room', Array(5).fill('slave'));
    game.state = 'finished';
    manager.handleRequestPlayAgain(spectator, 'room');
    assert.equal(game.radio.trackIndex, 0);
    assert.equal(game.players.some(p => p.hasBet || p.playedCard), false);
    assert.equal(game.playAgainRequests, undefined);
    assert.equal(game.state, 'finished');
});

test('invalid bets leave state unchanged and an accepted bet cannot be changed', t => {
    const { manager, p1, game } = setup(t);
    for (const amount of [undefined, null, {}, '2', NaN, Infinity, -1, 0, 1.5]) {
        manager.handleBet(p1, 'room', amount);
        assert.equal(game.players[0].hasBet, false);
    }
    manager.handleBet(p1, 'room', 3);
    manager.handleBet(p1, 'room', 5);
    assert.equal(game.players[0].betAmount, 3);
});

test('only valid radio actions from players are applied and rebroadcast', t => {
    const { manager, p1, game, emissions } = setup(t);
    const before = emissions.length;
    for (const action of [null, undefined, [], { type: 'play_track', trackIndex: 99 },
        { type: 'set_volume', volume: NaN }, { type: 'set_volume', volume: -1 },
        { type: 'sync', trackIndex: 0, volume: 1, isPlaying: true, currentTime: -1 }]) {
        assert.doesNotThrow(() => manager.handleRadioAction(p1, 'room', action));
    }
    assert.equal(emissions.length, before);
    manager.handleRadioAction(p1, 'room', { type: 'sync', trackIndex: 3, volume: 2, isPlaying: true, currentTime: 20 });
    assert.equal(game.radio.trackIndex, 3);
    assert.equal(game.radio.volume, 2);
    assert.equal(emissions.at(-1).data.currentTime, 20);
});

test('players can bet, resolve a tie, complete rounds and mutually restart', t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const { manager, p1, p2, game } = setup(t, { maxRounds: 4 });
    manager.handleBet(p1, 'room', 1);
    manager.handleBet(p2, 'room', 1);
    manager.handlePlayCard(p1, 'room', 'citizen');
    manager.handlePlayCard(p2, 'room', 'citizen');
    assert.equal(game.state, 'resolved');
    assert.equal(game.history[0].winner, 'tie');
    t.mock.timers.tick(9000);
    assert.equal(game.state, 'playing');
    assert.equal(game.round, 1);
    for (let round = 1; round <= 4; round++) {
        if (game.state === 'betting') {
            manager.handleBet(p1, 'room', 1);
            manager.handleBet(p2, 'room', 1);
        }
        const emperor = game.roles.emperor === p1.id ? p1 : p2;
        const other = emperor === p1 ? p2 : p1;
        manager.handlePlayCard(emperor, 'room', 'emperor');
        manager.handlePlayCard(other, 'room', 'citizen');
        t.mock.timers.tick(9000);
    }
    assert.equal(game.state, 'finished');
    manager.handleRequestPlayAgain(p1, 'room');
    assert.equal(game.state, 'finished');
    manager.handleRequestPlayAgain(p2, 'room');
    assert.equal(game.state, 'betting');
    assert.equal(game.round, 1);
    assert.deepEqual(game.history, []);
    assert.equal(game.players[0].hand.length, 5);
});

test('disconnect cancels pending transitions even when the same room ID is reused', t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const { manager, p1, p2, socket, game } = setup(t);
    manager.handleBet(p1, 'room', 1);
    manager.handleBet(p2, 'room', 1);
    manager.handlePlayCard(p1, 'room', 'emperor');
    manager.handlePlayCard(p2, 'room', 'citizen');
    assert.equal(game.pendingTimeouts.size, 1);
    manager.handleDisconnect(p1);
    assert.equal(game.pendingTimeouts.size, 0);
    manager.handleJoin(socket('new-player'), 'room');
    const replacement = manager.getGame('room');
    assert.doesNotThrow(() => t.mock.timers.tick(9000));
    assert.equal(replacement.round, 1);
    assert.equal(replacement.state, 'waiting');
});

test('a timeout is resolved once and cannot accept late cards or double-charge a player', t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const { manager, p1, p2, game } = setup(t);
    manager.handleBet(p1, 'room', 1);
    manager.handleBet(p2, 'room', 1);
    manager.handlePlayCard(p1, 'room', 'emperor');
    manager.handleTimeout('room');
    const hearts = game.players[1].hearts;
    manager.handlePlayCard(p2, 'room', 'slave');
    manager.handleTimeout('room');
    assert.equal(game.state, 'resolved');
    assert.equal(game.players[1].hearts, hearts);
    assert.equal(game.players[1].playedCard, null);
});

test('every socket handler tolerates absent, malformed, and reserved-room payloads', t => {
    const { manager, socket } = setup(t);
    const client = socket('outsider');
    registerSocketHandlers(client, manager);
    for (const [event, handler] of client.handlers) {
        if (event === 'disconnect') continue;
        for (const payload of [undefined, null, [], 'bad', 1, {}, { gameId: '__proto__' }, { gameId: {} }]) {
            assert.doesNotThrow(() => handler(payload), event);
        }
        assert.doesNotThrow(() => handler({ gameId: 'room' }), event);
    }
    assert.equal(manager.getGame('room').players.length, 2);
});

test('room broadcasts cannot collide with private socket rooms', t => {
    const { manager, socket, emissions } = setup(t);
    const p1 = socket('private-socket');
    manager.handleJoin(p1, 'private-socket');
    manager.handleJoin(socket('second'), 'private-socket');
    assert.ok(p1.rooms.has('game:private-socket'));
    assert.equal(p1.rooms.has('private-socket'), false);
    assert.ok(emissions.some(e => e.room === 'private-socket' && e.event === 'hand_update'));
    assert.ok(emissions.some(e => e.room === 'game:private-socket' && e.event === 'game_update'));
    assert.equal(emissions.some(e => e.room === 'private-socket' && e.event === 'game_update'), false);
});
