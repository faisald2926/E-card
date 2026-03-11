import React, { useEffect, useState, useRef } from 'react';
import Card from './Card';
import OpponentCursor from './OpponentCursor';
import Dashboard from './Dashboard';
import Radio from './Radio';

export default function GameTable({ socket, gameState, myPlayerId }) {
    const [cursors, setCursors] = useState({});
    const gameStateRef = useRef(gameState);

    useEffect(() => {
        gameStateRef.current = gameState;
    }, [gameState]);
    const [myHand, setMyHand] = useState([]);

    // Physics State
    // cardPositions: { [index]: { x, y, rotation, zIndex } }
    const [cardPositions, setCardPositions] = useState({});
    const [draggingCard, setDraggingCard] = useState(null); // { index, offsetX, offsetY }

    // Play Area Refs for "Drop Zone" detection
    const dropZoneRef = useRef(null);
    const playerAreaRef = useRef(null);

    const [roundResult, setRoundResult] = useState(null);

    const [opponentCardPositions, setOpponentCardPositions] = useState({});
    const [revealPhase, setRevealPhase] = useState('idle'); // 'idle' | 'countdown' | 'revealed' | 'result'
    const [countDown, setCountDown] = useState(3);
    const [betInput, setBetInput] = useState(1);
    const [playAgainRequested, setPlayAgainRequested] = useState(false);
    const [playAgainStatus, setPlayAgainStatus] = useState(null);
    const [localHasPlayed, setLocalHasPlayed] = useState(false); // Optimistic UI state
    const [gameOverData, setGameOverData] = useState(null); // Detailed game over info
    const countdownTimerRef = useRef(null); // Ref to track countdown interval

    // Robust check: If we are flagged as spectator OR we are not in the players list, treat as spectator
    const isPlayer = gameState.players.some(p => p.id === myPlayerId);
    const isSpectator = gameState.isSpectator || !isPlayer;

    const myPlayer = isSpectator ? gameState.players[0] : gameState.players.find(p => p.id === myPlayerId);
    const opponent = isSpectator ? gameState.players[1] : gameState.players.find(p => p.id !== myPlayerId);
    const amIP1 = isSpectator ? true : gameState.players[0]?.id === myPlayerId;

    useEffect(() => {
        if (isSpectator && myPlayer?.hand) {
            setMyHand(myPlayer.hand);
        }
    }, [gameState, isSpectator, myPlayer]);

    // --- Sockets ---
    useEffect(() => {
        // Invert Y-axis only to simulate sitting across the table
        // X stays same (left is still left), Y is inverted (their bottom is our top)
        socket.on('opponent_mouse_move', (data) => {
            setCursors(prev => {
                const gs = gameStateRef.current;
                const myId = myPlayerId; // captured from scope
                const isPlayer = gs.players.some(p => p.id === myId);
                const isSpectator = gs.isSpectator || !isPlayer;

                let finalY = 100 - data.y; // Default: Inverted (Opponent View)
                let label = "Opponent";

                if (isSpectator) {
                    if (gs.players[0] && data.id === gs.players[0].id) {
                        label = "Player 1";
                        finalY = data.y; // P1 (Bottom) -> Spectator sees Bottom (Raw)
                    } else if (gs.players[1] && data.id === gs.players[1].id) {
                        label = "Player 2";
                        finalY = 100 - data.y; // P2 (Top) -> Spectator sees Top (Inverted)
                    }
                }

                return {
                    ...prev,
                    [data.id]: { x: data.x, y: finalY, label }
                };
            });
        });

        socket.on('player_action', (data) => {
            // Logic handled by game state update
            if (data.playerId === myPlayerId && data.action === 'played_card') {
                // The server knows we played, so we can rely on gameState now?
                // Actually, gameState updates via 'game_update' usually.
                // Let's keep local true until next round starts or reset.
            }
        });

        socket.on('play_again_status', (data) => {
            setPlayAgainStatus(data);
        });

        socket.on('game_reset', () => {
            setRoundResult(null);
            setRevealPhase('idle');
            setPlayAgainRequested(false);
            setPlayAgainStatus(null);
            setLocalHasPlayed(false);
            setGameOverData(null);
        });

        socket.on('game_over', (data) => {
            console.log('Game Over:', data);
            setGameOverData(data);
        });

        socket.on('new_round', () => {
            setLocalHasPlayed(false);
            setRoundResult(null);
            setRevealPhase('idle');
            setCardPositions({}); // Reset positions for new hand
        });

        socket.on('tie_replay', () => {
            // Unlock hand for replay and reset visual state
            setLocalHasPlayed(false);
            setRoundResult(null);
            setRevealPhase('idle');
        });

        socket.on('hand_update', (data) => {
            const newHand = data.hand;
            setMyHand(newHand);
        });

        socket.on('round_result', (data) => {
            setRoundResult(data);

            // Start Suspense Sequence
            setRevealPhase('countdown');
            setCountDown(3);

            // Clear any existing timer to prevent freeze from multiple instances
            if (countdownTimerRef.current) {
                clearInterval(countdownTimerRef.current);
            }

            // Countdown Logic
            let count = 3;
            countdownTimerRef.current = setInterval(() => {
                count--;
                setCountDown(count);
                if (count <= 0) {
                    clearInterval(countdownTimerRef.current);
                    countdownTimerRef.current = null;

                    // Step 1: Flip Cards
                    setRevealPhase('revealed');

                    // Step 2: Show Result Modal (after 3s delay to let flip finish)
                    setTimeout(() => {
                        setRevealPhase('result');

                        // Step 3: Reset Game State (after 5s of showing result)
                        setTimeout(() => {
                            setRoundResult(null);
                            setRevealPhase('idle');
                            setLocalHasPlayed(false);
                        }, 5000);
                    }, 3000);
                }
            }, 1000);
        });

        // Handle tie - replay with same cards
        socket.on('tie_replay', () => {
            setLocalHasPlayed(false);
            setRoundResult(null);
            setRevealPhase('idle');
            // DON'T reset cardPositions - keep them in place
        });



        socket.on('opponent_card_positions', (data) => {
            // Received opponent's card positions - invert Y to show them upside down
            const inverted = {};
            Object.keys(data.positions).forEach(k => {
                const pos = data.positions[k];
                inverted[k] = {
                    x: pos.x,
                    y: 300 - pos.y - 140, // Invert within 300px area (opponent area height), 140 is card height
                    rotation: -pos.rotation, // Mirror rotation
                    zIndex: pos.zIndex
                };
            });
            setOpponentCardPositions(inverted);
        });

        return () => {
            socket.off('opponent_mouse_move');
            socket.off('player_action');
            socket.off('hand_update');
            socket.off('round_result');
            socket.off('opponent_card_positions');
            socket.off('game_reset');
            socket.off('game_over');
            socket.off('new_round');
            socket.off('tie_replay');
        };
    }, [socket, myPlayerId]);

    // Request Hand on Mount to ensure sync
    useEffect(() => {
        if (gameState.id && !isSpectator) {
            socket.emit('request_hand', { gameId: gameState.id });
        }
    }, [socket, gameState.id, isSpectator]);

    // Sync positions when hand changes
    useEffect(() => {
        setCardPositions(prev => {
            const next = { ...prev };

            // Calculate total width of hand to center it
            const cardWidth = 100; // px
            const gap = 20; // px
            const totalWidth = (myHand.length * cardWidth) + ((myHand.length - 1) * gap);
            const startX = (1000 / 2) - (totalWidth / 2); // 1000 is table width

            myHand.forEach((card, i) => {
                // If no position exists for this index, set it.
                if (!next[i]) {
                    next[i] = {
                        x: startX + (i * (cardWidth + gap)),
                        y: 50, // Top of player area
                        rotation: Math.random() * 10 - 5, // Random rotation -5 to 5
                        zIndex: i
                    };
                }
            });
            // Cleanup old keys if hand size completely changed (though not typical in this game)
            Object.keys(next).forEach(k => {
                if (parseInt(k) >= myHand.length) delete next[k];
            });
            return next;
        });
    }, [myHand]);

    // Broadcast card positions to opponent when they change
    useEffect(() => {
        if (!isSpectator && gameState.id && Object.keys(cardPositions).length > 0) {
            socket.emit('card_positions', {
                gameId: gameState.id,
                positions: cardPositions
            });
        }
    }, [cardPositions, gameState.id, socket, isSpectator]);

    // --- Drag Logic (Custom) ---
    const handleMouseDown = (e, index) => {
        if (isSpectator) return;
        if (gameState.state !== 'playing' && gameState.state !== 'betting') return;

        // Hitbox Refinement: "Smaller a bit to match size"
        // We act as if the card has a 10px transparent border that ignores clicks
        const rect = e.currentTarget.getBoundingClientRect();
        const clickX = e.clientX - rect.left; // 0 to w
        const clickY = e.clientY - rect.top; // 0 to h

        // Card is roughly 100x140 visual. If we want it "smaller", we clip the edges.
        // Using percentages to be safe against scaling
        const w = rect.width;
        const h = rect.height;
        const padding = 10; // 10px shrinking

        if (clickX < padding || clickX > w - padding || clickY < padding || clickY > h - padding) {
            return;
        }

        e.preventDefault();

        if (!playerAreaRef.current) return;
        const areaRect = playerAreaRef.current.getBoundingClientRect();

        const mouseX = e.clientX - areaRect.left;
        const mouseY = e.clientY - areaRect.top;

        const currentPos = cardPositions[index] || { x: 0, y: 0 };

        setDraggingCard({
            index,
            offsetX: mouseX - currentPos.x,
            offsetY: mouseY - currentPos.y
        });

        setCardPositions(prev => ({
            ...prev,
            [index]: { ...prev[index], zIndex: 999, rotation: 0 }
        }));
    };

    useEffect(() => {
        const handleMouseMove = (e) => {
            if (isSpectator) return;
            if (!draggingCard || !playerAreaRef.current) return;

            e.preventDefault();
            const areaRect = playerAreaRef.current.getBoundingClientRect();
            const x = e.clientX - areaRect.left - draggingCard.offsetX;
            const y = e.clientY - areaRect.top - draggingCard.offsetY;

            setCardPositions(prev => ({
                ...prev,
                [draggingCard.index]: {
                    ...prev[draggingCard.index],
                    x,
                    y
                }
            }));

            setCardPositions(prev => ({
                ...prev,
                [draggingCard.index]: {
                    ...prev[draggingCard.index],
                    x,
                    y
                }
            }));

            // Sync with opponent (Global Scale) - Mouse cursor
            const globalX = (e.clientX / window.innerWidth) * 100;
            const globalY = (e.clientY / window.innerHeight) * 100;
            // Only emit mouse move, not card drag, as positions are handled by card_positions state
            socket.emit('mouse_move', { gameId: gameState.id, x: globalX, y: globalY });
        };

        const handleMouseUp = (e) => {
            if (!draggingCard) return;

            // Check Drop Zone
            if (dropZoneRef.current && gameState.state === 'playing') {
                const zoneRect = dropZoneRef.current.getBoundingClientRect();
                const mouseX = e.clientX;
                const mouseY = e.clientY;

                if (
                    mouseX >= zoneRect.left &&
                    mouseX <= zoneRect.right &&
                    mouseY >= zoneRect.top &&
                    mouseY <= zoneRect.bottom
                ) {
                    const hasPlayed = myPlayer?.hasPlayed || localHasPlayed;
                    if (!hasPlayed) {
                        const type = myHand[draggingCard.index];
                        socket.emit('play_card', { gameId: gameState.id, cardIndex: type });

                        // Optimistic Update
                        setLocalHasPlayed(true); // Show card in slot immediately
                        const newHand = [...myHand];
                        newHand.splice(draggingCard.index, 1);
                        setMyHand(newHand);

                        // IMPORTANT: Shift positions of subsequent cards to match new indices
                        // This prevents other cards from "jumping" into the empty slot
                        setCardPositions(prev => {
                            const next = { ...prev };
                            // Shift every position after the removed index down by 1
                            // e.g. If we remove index 1, old pos 2 becomes new pos 1.
                            // We iterate from the removed index up to the end of the previous size
                            for (let i = draggingCard.index; i < Object.keys(next).length - 1; i++) {
                                next[i] = next[i + 1];
                            }
                            // Delete the last key (now redundant/moved)
                            const lastKey = Object.keys(next).length - 1; // logical last index after shift
                            // Actually the object might have more keys, we should just delete the highest integer key
                            // Simpler: Just delete the key that corresponds to the old length-1
                            delete next[newHand.length];

                            return next;
                        });
                    } // End if (!hasPlayed)
                }
            }

            setDraggingCard(null);
            setCardPositions(prev => ({
                ...prev,
                [draggingCard.index]: { ...prev[draggingCard.index], zIndex: draggingCard.index }
            }));
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [draggingCard, gameState.state, myHand, isSpectator]);

    // Shuffle Button


    const getOpponentCardFace = () => {
        if (!roundResult) return null;
        // Use p1Card/p2Card directly - they are always correct
        // amIP1 means I am player at index 0, so opponent's card is p2Card
        const card = amIP1 ? roundResult.p2Card : roundResult.p1Card;
        console.log('[DEBUG getOpponentCardFace]', { amIP1, p1Card: roundResult.p1Card, p2Card: roundResult.p2Card, result: card });
        return card;
    };

    const getMyCardFace = () => {
        if (!roundResult) return null;
        return amIP1 ? roundResult.p1Card : roundResult.p2Card;
    };

    const formatMoney = (amount) => {
        // Backend sends: payout * 100000 (e.g., 1 heart × 100000 = $100,000)
        // For slave win: 5 hearts × 100000 = $500,000
        console.log('[DEBUG formatMoney] Input:', amount);
        if (!amount || amount === 0) return '$0';
        // Just display the number nicely
        if (amount >= 1000000) {
            return `$${(amount / 1000000).toFixed(1)}M`;
        }
        if (amount >= 1000) {
            return `$${Math.round(amount / 1000)}k`;
        }
        return `$${amount}`;
    };

    return (
        <div className="game-table">
            {/* Suspense Countdown Overlay */}
            {revealPhase === 'countdown' && (
                <div className="countdown-overlay">
                    {countDown}
                </div>
            )}

            {/* Opponent Area - Free Form with Positions */}
            <div className="opponent-area">
                {opponent && Array.from({ length: opponent.handSize }).map((_, i) => {
                    const pos = opponentCardPositions[i] || { x: 100 + (i * 120), y: 50, rotation: 0, zIndex: i };
                    return (
                        <div
                            key={i}
                            className="card back"
                            style={{
                                left: pos.x,
                                top: pos.y,
                                transform: `rotate(${pos.rotation}deg)`,
                                zIndex: pos.zIndex
                            }}
                        >

                            <img
                                src={isSpectator && opponent.hand && opponent.hand[i] ? `/cards/${opponent.hand[i]}.jpg` : "/cards/back.jpg"}
                                alt="back"
                                style={{ width: '100%', height: '100%', pointerEvents: 'none' }}
                            />
                        </div>
                    );
                })}
            </div>

            {/* Play Area (Battle Mat) */}
            <div className="play-area" style={{ border: 'none', position: 'relative' }}>

                {/* Horizontal Layout: Drop Zone - Dashboard - Radio */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '30px', transform: 'scale(0.9)' }}>

                    <div ref={dropZoneRef} className="battle-mat">
                        {/* Opponent Slot */}
                        <div className="slot opponent">
                            {/* If opponent has played, render the flip container centered in slot */}
                            {((gameState.state === 'resolved' && roundResult) || opponent?.hasPlayed) && (
                                <div className="played-container">
                                    <div className={`card-flip-container ${revealPhase === 'revealed' || revealPhase === 'result' ? 'flipped' : ''}`}>
                                        <div className="card-face-back">
                                            <img src="/cards/back.jpg" alt="back" style={{ width: '100%', height: '100%' }} />
                                        </div>
                                        <div className="card-face-front">
                                            {getOpponentCardFace() && <img src={`/cards/${getOpponentCardFace()}.jpg`} alt={getOpponentCardFace()} style={{ width: '100%', height: '100%' }} />}
                                        </div>
                                    </div>
                                </div>
                            )}
                            {!opponent?.hasPlayed && <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)' }}>OPPONENT</span>}
                        </div>

                        {/* VS Label */}
                        <div style={{ fontSize: '24px', color: 'rgba(255,255,255,0.2)', fontWeight: 'bold' }}>VS</div>

                        {/* My Slot */}
                        <div className="slot player">
                            {(myPlayer?.hasPlayed || localHasPlayed) && (
                                <div className="played-container">
                                    <div className={`card-flip-container ${revealPhase === 'revealed' || revealPhase === 'result' ? 'flipped' : ''}`}>
                                        <div className="card-face-back">
                                            <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', color: 'white', fontWeight: 'bold', textShadow: '2px 2px black', zIndex: 10 }}>READY</div>
                                            <img src="/cards/back.jpg" alt="back" style={{ width: '100%', height: '100%' }} />
                                        </div>
                                        <div className="card-face-front">
                                            {roundResult && <img src={`/cards/${getMyCardFace()}.jpg`} alt="My Card" style={{ width: '100%', height: '100%' }} />}
                                        </div>
                                    </div>
                                </div>
                            )}
                            {!(myPlayer?.hasPlayed || localHasPlayed) && <span style={{ fontSize: '10px', color: 'rgba(255,200,50,0.5)' }}>DROP HERE</span>}
                        </div>
                    </div>

                    <Dashboard socket={socket} gameState={gameState} myPlayerId={myPlayerId} />

                    <Radio socket={socket} gameId={gameState.id} initialRadioState={gameState.radio} readOnly={isSpectator} />
                </div>

                {/* Overlays */}
                {gameState.state === 'betting' && !isSpectator && (
                    <div className="modal-overlay" style={{ background: 'transparent', pointerEvents: 'auto' }}>
                        <div className="modal-content">
                            <h3>Place Bet</h3>
                            <input
                                type="range"
                                min="1"
                                max={myPlayer?.hearts}
                                value={betInput}
                                onChange={(e) => setBetInput(parseInt(e.target.value))}
                                style={{ width: '100%' }}
                            />
                            <div style={{ color: 'gold', fontSize: '20px' }}>{betInput}</div>
                            <button className="pixel-btn" onClick={() => socket.emit('place_bet', { gameId: gameState.id, amount: betInput })}>ACCEPT</button>
                        </div>
                    </div>
                )}

                {/* Round Result Modal */}
                {revealPhase === 'result' && roundResult && !roundResult.gameOver && (() => {
                    // Calculate if I won this round
                    const iWon = (roundResult.winner === 'p1_wins' && amIP1) || (roundResult.winner === 'p2_wins' && !amIP1);
                    const iLost = (roundResult.winner === 'p1_wins' && !amIP1) || (roundResult.winner === 'p2_wins' && amIP1);
                    const isTie = roundResult.winner === 'tie';

                    return (
                        <div className="modal-overlay">
                            <div className="modal-content" style={{
                                border: iLost ? '4px solid #ff4444' : '4px solid gold',
                                boxShadow: iLost ? '0 0 20px #ff0000' : '0 0 20px gold'
                            }}>
                                <h2>{isTie ? "TIE" : (iWon ? "YOU WIN!" : "YOU LOSE!")}</h2>
                                <p style={{ color: isTie ? '#aaa' : (iWon ? '#0f0' : '#f00'), fontSize: '18px' }}>
                                    {isTie ? "Play again with remaining cards" : (iWon ? "Nice move!" : "Better luck next time")}
                                </p>
                                <p style={{ color: 'gold', fontSize: '24px', margin: '10px 0' }}>
                                    {isTie ? "± $0" : (iWon ? `+ ${formatMoney(roundResult.payout)}` : `- ${roundResult.payout / 100000} ♥`)}
                                </p>
                            </div>
                        </div>
                    );
                })()}

                {/* Detailed Game Over Modal - Shows after game_over event */}
                {gameOverData && (() => {
                    const iWon = gameOverData.winner === myPlayerId;
                    const isDraw = gameOverData.winner === 'draw';
                    const myStats = amIP1 ? gameOverData.finalStats?.p1 : gameOverData.finalStats?.p2;
                    const oppStats = amIP1 ? gameOverData.finalStats?.p2 : gameOverData.finalStats?.p1;
                    const history = gameOverData.history || [];

                    return (
                        <div className="modal-overlay">
                            <div className="modal-content" style={{
                                minWidth: '500px',
                                maxHeight: '80vh',
                                overflowY: 'auto',
                                border: isDraw ? '4px solid #888' : (iWon ? '4px solid gold' : '4px solid #ff4444')
                            }}>
                                <h1 style={{ color: isDraw ? '#888' : (iWon ? '#0f0' : '#f00'), fontSize: '32px' }}>
                                    {isDraw ? "DRAW" : (iWon ? "🏆 VICTORY 🏆" : "💀 DEFEAT 💀")}
                                </h1>

                                <p style={{ color: '#aaa', fontSize: '12px' }}>
                                    {gameOverData.reason === 'bankruptcy' ? 'Opponent went bankrupt!' : `All ${gameOverData.config?.maxRounds || 8} rounds completed`}
                                </p>

                                {/* Final Stats Comparison */}
                                <div className="pixel-box" style={{ margin: '15px 0', padding: '15px' }}>
                                    <h3 style={{ marginBottom: '10px', color: 'gold' }}>FINAL STANDINGS</h3>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', textAlign: 'center' }}>
                                        <div style={{ borderRight: '1px solid #444', paddingRight: '10px' }}>
                                            <div style={{ color: iWon ? '#0f0' : '#f00', fontSize: '14px' }}>YOU</div>
                                            <div style={{ fontSize: '20px' }}>♥ {myStats?.hearts || myPlayer?.hearts}</div>
                                            <div style={{ color: '#85bb65', fontSize: '16px' }}>{formatMoney(myStats?.money || myPlayer?.money || 0)}</div>
                                        </div>
                                        <div>
                                            <div style={{ color: iWon ? '#f00' : '#0f0', fontSize: '14px' }}>OPPONENT</div>
                                            <div style={{ fontSize: '20px' }}>♥ {oppStats?.hearts || opponent?.hearts}</div>
                                            <div style={{ color: '#85bb65', fontSize: '16px' }}>{formatMoney(oppStats?.money || opponent?.money || 0)}</div>
                                        </div>
                                    </div>
                                </div>

                                {/* Round History */}
                                {history.length > 0 && (
                                    <div className="pixel-box" style={{ margin: '15px 0', padding: '10px', maxHeight: '200px', overflowY: 'auto' }}>
                                        <h3 style={{ marginBottom: '10px', color: '#888' }}>ROUND HISTORY</h3>
                                        <table style={{ width: '100%', fontSize: '10px', borderCollapse: 'collapse' }}>
                                            <thead>
                                                <tr style={{ borderBottom: '1px solid #444' }}>
                                                    <th>RND</th>
                                                    <th>YOUR CARD</th>
                                                    <th>OPP CARD</th>
                                                    <th>BET</th>
                                                    <th>RESULT</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {history.map((h, i) => {
                                                    const myCard = amIP1 ? h.p1Card : h.p2Card;
                                                    const oppCard = amIP1 ? h.p2Card : h.p1Card;
                                                    const myBet = amIP1 ? h.p1Bet : h.p2Bet;
                                                    const iWonRound = (h.winner === 'p1_wins' && amIP1) || (h.winner === 'p2_wins' && !amIP1);
                                                    const roundTie = h.winner === 'tie';

                                                    return (
                                                        <tr key={i} style={{ borderBottom: '1px solid #333' }}>
                                                            <td style={{ padding: '5px' }}>{h.round}</td>
                                                            <td style={{ textTransform: 'uppercase' }}>{myCard}</td>
                                                            <td style={{ textTransform: 'uppercase' }}>{oppCard}</td>
                                                            <td>♥{myBet}</td>
                                                            <td style={{ color: roundTie ? '#888' : (iWonRound ? '#0f0' : '#f00') }}>
                                                                {roundTie ? 'TIE' : (iWonRound ? `+${formatMoney(h.moneyGain)}` : `-♥${h.heartsLost}`)}
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                )}

                                {!playAgainRequested && !isSpectator ? (
                                    <button
                                        className="pixel-btn"
                                        style={{ width: '100%', fontSize: '18px', marginTop: '10px' }}
                                        onClick={() => {
                                            setPlayAgainRequested(true);
                                            socket.emit('request_play_again', { gameId: gameState.id });
                                        }}
                                    >
                                        PLAY AGAIN
                                    </button>
                                ) : (
                                    <div style={{ color: '#aaa', animation: 'blink 1s infinite', marginTop: '10px' }}>
                                        {isSpectator ? "WAITING FOR PLAYERS TO RESTART..." : `WAITING FOR OPPONENT... (${playAgainStatus?.requestCount || 1}/${playAgainStatus?.totalPlayers || 2})`}
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })()}
            </div>

            {/* My Player Area (Free Form) */}
            <div className="player-area" ref={playerAreaRef}>


                {myHand.map((cardType, index) => {
                    const pos = cardPositions[index] || { x: 0, y: 0, rotation: 0, zIndex: 0 };
                    return (
                        <div
                            key={index}
                            className={`card ${cardType}`}
                            style={{
                                left: pos.x,
                                top: pos.y,
                                transform: `rotate(${pos.rotation}deg)`,
                                zIndex: pos.zIndex,
                                cursor: 'none'
                            }}
                            onMouseDown={(e) => handleMouseDown(e, index)}
                        >
                            <img
                                src={`/cards/${cardType}.jpg`}
                                alt={cardType}
                                style={{ width: '100%', height: '100%', pointerEvents: 'none' }}
                                onError={(e) => { e.target.style.display = 'none'; e.target.parentElement.classList.add('fallback'); }}
                            />
                            {/* Fallback text if image fails/missing */}
                            <div className="card-face fallback-text" style={{ display: 'none' }}>
                                <h3>{cardType.toUpperCase()}</h3>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Status */}
            <div className="status-bar">
                Role: {isSpectator ? "SPECTATOR" : (gameState.roles.emperor === myPlayerId ? "EMPEROR" : "SLAVE")} | Hearts: {myPlayer?.hearts} | Bet: {gameState.bet}
            </div>

            {Object.entries(cursors).map(([id, pos]) => (
                <OpponentCursor key={id} x={pos.x} y={pos.y} label={pos.label} />
            ))}
        </div>
    );
}
