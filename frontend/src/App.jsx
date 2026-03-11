import React, { useState, useEffect } from 'react';
import { io } from 'socket.io-client';
import './styles/pixel-theme.css';
import GameTable from './components/GameTable';
import CustomCursor from './components/CustomCursor';

// Connect to backend dynamically based on current host
const socket = io(`http://${window.location.hostname}:3000`);

function App() {
  const [connected, setConnected] = useState(false);
  const [gameState, setGameState] = useState(null);
  const [inputGameId, setInputGameId] = useState('');
  const [myPlayerId, setMyPlayerId] = useState(null);
  const [error, setError] = useState('');
  const [lobbyConfig, setLobbyConfig] = useState({
    initialHearts: 20,
    maxRounds: 8,
    swapInterval: 2
  });
  const [showConfig, setShowConfig] = useState(false);

  // Mouse Tracking
  useEffect(() => {
    socket.on('connected', (data) => {
      setConnected(true);
      setMyPlayerId(data.id);
    });

    socket.on('disconnect', () => {
      setConnected(false);
    });

    socket.on('game_update', (data) => {
      console.log('game_update received:', data);
      if (gameState?.isSpectator) return;
      setGameState(data);
    });

    socket.on('spectator_join', (data) => {
      console.log('Spectator joined:', data);
      setGameState(data);
    });

    socket.on('spectator_update', (data) => {
      setGameState(data);
    });

    socket.on('error', (err) => {
      console.log('Socket error:', err);
      setError(err.message);
      setTimeout(() => setError(''), 5000);
    });

    // Global mouse tracking
    const handleMouseMove = (e) => {
      if (!gameState) return;

      const x = (e.clientX / window.innerWidth) * 100;
      const y = (e.clientY / window.innerHeight) * 100;

      socket.emit('mouse_move', {
        gameId: gameState.id,
        x,
        y
      });
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => {
      socket.off('connected');
      socket.off('game_update');
      socket.off('spectator_join');
      socket.off('spectator_update');
      socket.off('error');
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, [gameState]);

  const joinGame = () => {
    if (!inputGameId) return;
    // Pass config if creating, server handles if it's new
    socket.emit('join_game', { gameId: inputGameId, config: lobbyConfig });
  };

  const joinSpectator = () => {
    if (!inputGameId) return;
    socket.emit('spectator_join', { gameId: inputGameId });
  };

  if (!gameState) {
    return (
      <div className="app-container" style={{ cursor: 'auto' }}>
        {/* Custom cursor only in game or everywhere? Let's keep system cursor for lobby for ease */}

        <div className="start-screen">
          <h1>E-CARD</h1>
          <p>Emperor vs Slave - Extreme</p>

          <div style={{ margin: '20px 0' }}>
            <label>ROOM ID: </label>
            <input
              type="text"
              className="pixel-input"
              placeholder="Enter Game ID"
              value={inputGameId}
              onChange={(e) => setInputGameId(e.target.value)}
            />
          </div>

          <button className="pixel-btn" onClick={() => setShowConfig(!showConfig)} style={{ fontSize: '0.6rem', padding: '10px', marginBottom: '10px' }}>
            {showConfig ? 'HIDE SETTINGS' : 'GAME SETTINGS'}
          </button>

          {showConfig && (
            <div style={{ textAlign: 'left', fontSize: '0.7rem', border: '2px dashed #555', padding: '10px', marginBottom: '10px' }}>
              <div style={{ marginBottom: '5px' }}>
                <label>Starting Hearts: {lobbyConfig.initialHearts}</label>
                <br />
                <input type="range" min="10" max="100" step="5"
                  value={lobbyConfig.initialHearts}
                  onChange={(e) => setLobbyConfig({ ...lobbyConfig, initialHearts: parseInt(e.target.value) })}
                />
              </div>
              <div style={{ marginBottom: '5px' }}>
                <label>Total Rounds: {lobbyConfig.maxRounds}</label>
                <br />
                <input type="range" min="4" max="24" step="2"
                  value={lobbyConfig.maxRounds}
                  onChange={(e) => setLobbyConfig({ ...lobbyConfig, maxRounds: parseInt(e.target.value) })}
                />
              </div>
              <div>
                <label>Swap Role Every: {lobbyConfig.swapInterval} Rounds</label>
                <br />
                <input type="number" min="1" max="10" className="pixel-input"
                  value={lobbyConfig.swapInterval}
                  onChange={(e) => setLobbyConfig({ ...lobbyConfig, swapInterval: parseInt(e.target.value) })}
                  style={{ width: '50px' }}
                />
              </div>
            </div>
          )}

          <br />
          <button className="pixel-btn" onClick={joinGame}>
            ENTER GAME
          </button>

          <button className="pixel-btn" onClick={joinSpectator} style={{ marginTop: '10px', backgroundColor: '#333' }}>
            SPECTATE
          </button>

          {error && <p style={{ color: 'red', fontSize: '10px' }}>{error}</p>}

          <div style={{ marginTop: '20px', fontSize: '10px', color: '#888' }}>
            Status: {connected ? 'Online' : 'Connecting...'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      <CustomCursor />
      <GameTable socket={socket} gameState={gameState} myPlayerId={myPlayerId} />
    </div>
  );
}

export default App;
