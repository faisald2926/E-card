# E-card

A real-time multiplayer E-card game built with React and Node.js, inspired by the card game from *Kaiji*.

[![CI](https://github.com/faisald2926/E-card/actions/workflows/ci.yml/badge.svg)](https://github.com/faisald2926/E-card/actions/workflows/ci.yml)

## Tech Stack

- **Frontend:** React 19, Vite, Socket.IO Client
- **Backend:** Express, Socket.IO, Node.js
- **Infrastructure:** Docker Compose

## Getting Started

### With Docker

```bash
docker compose up --build
```

- Frontend: http://localhost:5173
- Backend: http://localhost:3000

### Without Docker

**Backend:**
Requires Node.js 22.12 or later.
```bash
cd backend
npm ci
npm start
```

**Frontend:**
```bash
cd frontend
npm ci
npm run dev
```

## Playing and spectating

Two players enter the same room ID to start a match. Room IDs contain 1–64 letters, numbers, underscores or hyphens. The first player chooses the settings; both players place a bet before selecting a card.

Spectators are read-only and see card backs until played cards are revealed. The room creator can enable **Reveal both hands to spectators** in Game Settings for an open demonstration. Share that room ID only with people you intend to give this view.

## Local network setup

The backend and Docker's published ports default to localhost. To play across a trusted LAN, set `BIND_ADDRESS=0.0.0.0` and `CORS_ORIGINS` to the frontend URL used by the players, then start Docker Compose. For example, in PowerShell, replacing the address with your host's LAN IP:

```powershell
$env:BIND_ADDRESS = '0.0.0.0'
$env:CORS_ORIGINS = 'http://192.168.1.20:5173'
docker compose up --build
```

For a native backend, set `HOST=0.0.0.0` and the same `CORS_ORIGINS` before `npm start`. `CORS_ORIGINS` accepts a comma-separated list of exact browser origins. Reload the frontend after changing its URL.

This is an in-memory game for local or trusted-network play. Room IDs are shared access codes, with no account authentication; browser-origin checks do not authenticate non-browser clients. Restarting the server ends all rooms. Internet hosting requires a separate deployment setup with HTTPS, authentication, and abuse controls.

## Verification

```bash
cd backend
npm ci
npm test
cd ../frontend
npm ci
npm run build
```

The tests cover card ownership, duplicate cards, malformed socket messages, spectator permissions, room isolation, complete rounds and rematches, disconnect cleanup, and real Socket.IO client/server connections. CI runs the backend tests and frontend build.

## Project Structure

```
E-card/
├── frontend/        # React + Vite app
├── backend/         # Express + Socket.IO server and regression tests
├── docker-compose.yml
└── package.json
```
