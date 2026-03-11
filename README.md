# E-card

A real-time multiplayer E-card game built with React and Node.js, inspired by the card game from *Kaiji*.

## Tech Stack

- **Frontend:** React 19, Vite, Socket.IO Client
- **Backend:** Express, Socket.IO, Node.js
- **Infrastructure:** Docker Compose

## Getting Started

### With Docker

```bash
docker-compose up --build
```

- Frontend: http://localhost:5173
- Backend: http://localhost:3000

### Without Docker

**Backend:**
```bash
cd backend
npm install
npm start
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev
```

## Project Structure

```
E-card/
├── frontend/        # React + Vite app
├── backend/         # Express + Socket.IO server
├── docker-compose.yml
└── package.json
```
