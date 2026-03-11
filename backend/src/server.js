const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { GameManager } = require('./gameManager');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // Allow all for local network play
        methods: ["GET", "POST"]
    }
});

const gameManager = new GameManager(io);

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Initial simple handshake
    socket.emit('connected', { id: socket.id });

    // Game Events
    socket.on('join_game', ({ gameId, config }) => {
        gameManager.handleJoin(socket, gameId, config);
    });

    socket.on('spectator_join', ({ gameId }) => {
        gameManager.handleSpectatorJoin(socket, gameId);
    });

    socket.on('start_game', ({ gameId }) => {
        gameManager.handleStart(socket, gameId);
    });

    socket.on('mouse_move', (data) => {
        const game = gameManager.games[data.gameId];
        if (!game) return;

        // Strict: Only players in the game can move mouse
        if (!game.players.some(p => p.id === socket.id)) return;

        // Broadcast to other player in the room (excluding sender)
        // data: { x, y, gameId }
        socket.to(data.gameId).emit('opponent_mouse_move', {
            x: data.x,
            y: data.y, // Maintain raw Y for processing by client
            id: socket.id
        });
    });

    socket.on('card_drag', (data) => {
        // Validate Sender
        const game = gameManager.games[data.gameId];
        if (!game || !game.players.some(p => p.id === socket.id)) return;

        // Visualize card movement
        // data: { x, y, cardId, gameId }
        socket.to(data.gameId).emit('opponent_card_drag', data);
    });

    socket.on('card_positions', (data) => {
        // Validate Sender
        const game = gameManager.games[data.gameId]; // Note: data.gameId vs gameId in payload
        if (!game || !game.players.some(p => p.id === socket.id)) return;

        // Broadcast all card positions to opponent
        // data: { gameId, positions: { [index]: { x, y, rotation, zIndex } } }
        socket.to(data.gameId).emit('opponent_card_positions', {
            positions: data.positions
        });
    });

    socket.on('play_card', (data) => {
        // Player locks in a card
        // data: { gameId, cardIndex }
        gameManager.handlePlayCard(socket, data.gameId, data.cardIndex);
    });

    socket.on('reorder_hand', (data) => {
        gameManager.handleHandReorder(socket, data.gameId, data.newHand);
    });

    socket.on('request_hand', (data) => {
        gameManager.handleRequestHand(socket, data.gameId);
    });

    socket.on('radio_action', (data) => {
        // data: { gameId, action: { type, ... } }
        gameManager.handleRadioAction(socket, data.gameId, data.action);
    });

    socket.on('place_bet', (data) => {
        // data: { gameId, amount }
        gameManager.handleBet(socket, data.gameId, data.amount);
    });

    socket.on('request_play_again', (data) => {
        gameManager.handleRequestPlayAgain(socket, data.gameId);
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        gameManager.handleDisconnect(socket);
    });
});

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});
