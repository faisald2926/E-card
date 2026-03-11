import React, { useEffect, useState } from 'react';

export default function Dashboard({ socket, gameState, myPlayerId }) {
    const [timeLeft, setTimeLeft] = useState(180);

    // Derived state
    const myPlayer = gameState.players.find(p => p.id === myPlayerId);
    const opponent = gameState.players.find(p => p.id !== myPlayerId);

    useEffect(() => {
        socket.on('timer_update', (data) => {
            setTimeLeft(data.remaining);
        });

        // Reset local timer on new round if needed, but server dictates
        socket.on('new_round', () => setTimeLeft(180));

        return () => {
            socket.off('timer_update');
            socket.off('new_round');
        };
    }, [socket]);

    const formatTime = (seconds) => {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m}:${s < 10 ? '0' : ''}${s}`;
    };

    const formatMoney = (amount) => {
        if (!amount && amount !== 0) return '$0';
        if (amount >= 1000000) {
            return `$${(amount / 1000000).toLocaleString(undefined, { maximumFractionDigits: 1 })}M`;
        }
        return `$${(amount / 1000).toLocaleString()}K`;
    };

    return (
        <div className="dashboard-container pixel-box">
            {/* Left: My Stats */}
            <div className="stat-group left">
                <div className="stat-label">YOU</div>
                <div className="stat-value hearts">♥ {myPlayer?.hearts}</div>
                <div className="stat-value money" style={{ color: '#85bb65', fontSize: '12px' }}>{formatMoney(myPlayer?.money || 0)}</div>
                <div className="stat-value bet">BET: {myPlayer?.betAmount || 0}</div>
            </div>

            {/* Center: Timer & Round */}
            <div className="stat-group center">
                <div className="round-info">ROUND {gameState.round}/{gameState.config?.maxRounds || 8}</div>
                <div className={`timer-display ${timeLeft < 30 ? 'warning' : ''}`}>
                    {formatTime(timeLeft)}
                </div>
            </div>

            {/* Right: Opponent Stats */}
            <div className="stat-group right">
                <div className="stat-label">OPP</div>
                <div className="stat-value hearts">♥ {opponent?.hearts}</div>
                <div className="stat-value money" style={{ color: '#85bb65', fontSize: '12px' }}>{formatMoney(opponent?.money || 0)}</div>
                <div className="stat-value bet">BET: {opponent?.betAmount || 0}</div>
            </div>
        </div>
    );
}
