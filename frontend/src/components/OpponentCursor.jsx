import React from 'react';

import CursorIcon from './CursorIcon';

export default function OpponentCursor({ x, y, label }) {
    // Convert percentage to viewport position
    const style = {
        position: 'absolute', // Added here since we removed class usage partially? 
        // Actually class still exists but we override content
        top: `${y}%`,
        left: `${x}%`,
        zIndex: 9998,
        pointerEvents: 'none',
        transition: 'top 0.1s linear, left 0.1s linear'
    };

    return (
        <div style={style}>
            <CursorIcon color="#ff5252" />
            <div style={{
                background: 'rgba(0,0,0,0.5)',
                color: 'white',
                fontSize: '10px',
                padding: '2px 4px',
                borderRadius: '4px',
                marginTop: '10px',
                whiteSpace: 'nowrap'
            }}>
                {label || "Opponent"}
            </div>
        </div>
    );
}
