const { isRecord, isGameId, gameRoom, isFiniteNumber } = require('./validation');

function registerSocketHandlers(socket, gameManager) {
    const onRoomEvent = (event, handler) => {
        socket.on(event, data => {
            if (!isRecord(data) || !isGameId(data.gameId)) {
                socket.emit('error', { message: `Invalid ${event} payload.` });
                return;
            }
            handler(data);
        });
    };
    const onPlayerEvent = (event, handler) => {
        onRoomEvent(event, data => {
            if (gameManager.hasPlayer(socket, data.gameId)) handler(data);
        });
    };

    socket.emit('connected', { id: socket.id });
    onRoomEvent('join_game', data => gameManager.handleJoin(socket, data.gameId, data.config));
    onRoomEvent('spectator_join', data => gameManager.handleSpectatorJoin(socket, data.gameId));
    onPlayerEvent('start_game', data => gameManager.startGame(data.gameId));
    onPlayerEvent('play_card', data => gameManager.handlePlayCard(socket, data.gameId, data.cardIndex));
    onPlayerEvent('reorder_hand', data => gameManager.handleHandReorder(socket, data.gameId, data.newHand));
    onPlayerEvent('request_hand', data => gameManager.handleRequestHand(socket, data.gameId));
    onPlayerEvent('place_bet', data => gameManager.handleBet(socket, data.gameId, data.amount));
    onPlayerEvent('radio_action', data => gameManager.handleRadioAction(socket, data.gameId, data.action));
    onPlayerEvent('request_play_again', data => gameManager.handleRequestPlayAgain(socket, data.gameId));

    onPlayerEvent('mouse_move', data => {
        if (!isFiniteNumber(data.x, 0, 100) || !isFiniteNumber(data.y, 0, 100)) return;
        socket.to(gameRoom(data.gameId)).emit('opponent_mouse_move', { x: data.x, y: data.y, id: socket.id });
    });
    onPlayerEvent('card_drag', data => {
        if (!isFiniteNumber(data.x, 0, 100) || !isFiniteNumber(data.y, 0, 100)
            || !Number.isInteger(data.cardIndex) || data.cardIndex < 0 || data.cardIndex >= 5) return;
        socket.to(gameRoom(data.gameId)).emit('opponent_card_drag', {
            gameId: data.gameId, x: data.x, y: data.y, cardIndex: data.cardIndex
        });
    });
    onPlayerEvent('card_positions', data => {
        if (!isRecord(data.positions) || Object.keys(data.positions).length > 5) return;
        const positions = {};
        for (const [index, pos] of Object.entries(data.positions)) {
            if (!/^[0-4]$/.test(index) || !isRecord(pos)
                || !isFiniteNumber(pos.x, -100000, 100000) || !isFiniteNumber(pos.y, -100000, 100000)
                || !isFiniteNumber(pos.rotation, -360, 360) || !Number.isInteger(pos.zIndex)
                || pos.zIndex < 0 || pos.zIndex > 10000) return;
            positions[index] = { x: pos.x, y: pos.y, rotation: pos.rotation, zIndex: pos.zIndex };
        }
        socket.to(gameRoom(data.gameId)).emit('opponent_card_positions', { positions });
    });
    socket.on('disconnect', () => gameManager.handleDisconnect(socket));
}

module.exports = { registerSocketHandlers };
