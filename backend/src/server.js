const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { GameManager } = require('./gameManager');
const { registerSocketHandlers } = require('./socketHandlers');

function createGameServer({ allowedOrigins = (process.env.CORS_ORIGINS
    || 'http://localhost:5173,http://127.0.0.1:5173').split(',').map(origin => origin.trim()) } = {}) {
    const allowsOrigin = origin => !origin || allowedOrigins.includes(origin);
    const app = express();
    app.use(cors({ origin: (origin, callback) => callback(null, allowsOrigin(origin)) }));

    const server = http.createServer(app);
    const io = new Server(server, {
        cors: { origin: (origin, callback) => callback(null, allowsOrigin(origin)), methods: ['GET', 'POST'] },
        allowRequest: (request, callback) => callback(null, allowsOrigin(request.headers.origin))
    });
    const gameManager = new GameManager(io);
    io.on('connection', socket => registerSocketHandlers(socket, gameManager));
    return { server, io, gameManager };
}

if (require.main === module) {
    const { server } = createGameServer();
    const port = process.env.PORT || 3000;
    const host = process.env.HOST || '127.0.0.1';
    server.listen(port, host, () => console.log(`Server running on ${host}:${port}`));
}

module.exports = { createGameServer };
