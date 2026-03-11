import React, { useEffect, useState } from 'react';

import CursorIcon from './CursorIcon';

const HandCursor = () => {
    const [position, setPosition] = useState({ x: -100, y: -100 });
    const [clicked, setClicked] = useState(false);

    useEffect(() => {
        const move = (e) => {
            setPosition({ x: e.clientX, y: e.clientY });
        };
        const down = () => setClicked(true);
        const up = () => setClicked(false);

        // We only want to track if we are NOT in lobby?
        // Actually, CSS handles hiding system mouse, so we should always show this if mounted.

        window.addEventListener('mousemove', move);
        window.addEventListener('mousedown', down);
        window.addEventListener('mouseup', up);

        return () => {
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mousedown', down);
            window.removeEventListener('mouseup', up);
        };
    }, []);

    return (
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            transform: `translate(${position.x}px, ${position.y}px)`,
            pointerEvents: 'none',
            zIndex: 9999,
            transition: 'transform 0.05s linear', // Smoother
            marginLeft: '-12px', // Hotspot adjustment
            marginTop: '-2px'
        }}>
            <CursorIcon color="white" scale={clicked ? 0.9 : 1} />
        </div>
    );
};

export default HandCursor;
