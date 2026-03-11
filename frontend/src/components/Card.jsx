import React, { useState } from 'react';

export default function Card({ type, index, socket, gameId, isActive }) {
    const [isDragging, setIsDragging] = useState(false);

    // Visual types
    const getSymbol = () => {
        switch (type) {
            case 'emperor': return 'EMPEROR';
            case 'citizen': return 'CITIZEN';
            case 'slave': return 'SLAVE';
            default: return '?';
        }
    };

    const handleDragStart = (e) => {
        if (!isActive) return;
        setIsDragging(true);
        e.dataTransfer.setData('cardIndex', index);

        // Broadcast drag start (optional, maybe just use drag over for updates)
    };

    const handleDragEnd = () => {
        setIsDragging(false);
    };

    const handleDrag = (e) => {
        // Emit position to server for opponent to see
        // Note: HTML5 dnd drag event fires repeatedly
        if (e.clientX === 0 && e.clientY === 0) return; // Ignore end event 0 coords

        const x = (e.clientX / window.innerWidth) * 100;
        const y = (e.clientY / window.innerHeight) * 100;

        socket.emit('card_drag', {
            gameId,
            x,
            y,
            cardIndex: index
        });
    };

    return (
        <div
            className={`card ${type} ${isDragging ? 'dragging' : ''}`}
            draggable={isActive}
            onDragStart={handleDragStart}
            onDrag={handleDrag}
            onDragEnd={handleDragEnd}
            style={{ cursor: isActive ? 'grab' : 'default' }}
        >
            <div className="card-face">
                <h3>{getSymbol()}</h3>
            </div>
            {/* Pixel decorative corners or border could go here */}
        </div>
    );
}
