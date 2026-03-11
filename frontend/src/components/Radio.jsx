import React, { useState, useEffect, useRef } from 'react';

// Audio tracks
const playlist = [
    { title: "Station 1", src: "/audio/vid1.mp3" },
    { title: "Station 2", src: "/audio/vid2.mp3" },
    { title: "Station 3", src: "/audio/vid3.mp3" },
    { title: "Station 4", src: "/audio/vid4.mp3" }
];

export default function Radio({ socket, gameId, initialRadioState, readOnly }) {
    const [isPlaying, setIsPlaying] = useState(false);
    const [trackIndex, setTrackIndex] = useState(0);
    const [volume, setVolume] = useState(0.5);
    const [playbackSpeed, setPlaybackSpeed] = useState(1);
    const [autoplayBlocked, setAutoplayBlocked] = useState(false);

    // Web Audio API refs
    const audioContextRef = useRef(null);
    const sourceNodeRef = useRef(null);
    const gainNodeRef = useRef(null);
    const filterNodeRef = useRef(null);
    const audioRef = useRef(new Audio(playlist[0].src));

    // Initialize Web Audio API with radio effect filter
    const setupAudioContext = () => {
        if (audioContextRef.current) {
            // Resume if suspended
            if (audioContextRef.current.state === 'suspended') {
                audioContextRef.current.resume();
            }
            return;
        }

        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        audioContextRef.current = ctx;

        const audio = audioRef.current;
        audio.crossOrigin = "anonymous";

        // Create source from audio element
        const source = ctx.createMediaElementSource(audio);
        sourceNodeRef.current = source;

        // Create gain node for volume amplification (0-2x)
        const gain = ctx.createGain();
        gain.gain.value = volume;
        gainNodeRef.current = gain;

        // Connect: source -> gain -> destination (no filter)
        source.connect(gain);
        gain.connect(ctx.destination);
    };

    useEffect(() => {
        const audio = audioRef.current;
        audio.crossOrigin = "anonymous";

        audio.onended = () => {
            handleNext();
        };

        audio.onplay = () => {
            setupAudioContext();
        };

        return () => {
            audio.pause();
            audio.onended = null;
            audio.onplay = null;
            if (audioContextRef.current) {
                audioContextRef.current.close();
                audioContextRef.current = null;
            }
        };
    }, []);

    // Sync volume when changed - audio element only accepts 0-1, gain node handles 0-2
    useEffect(() => {
        // Audio element volume is capped at 1, gain node does the amplification
        audioRef.current.volume = Math.min(volume, 1);
        if (gainNodeRef.current) {
            gainNodeRef.current.gain.value = volume;
        }
    }, [volume]);

    // Sync playback speed when changed
    useEffect(() => {
        audioRef.current.playbackRate = playbackSpeed;
    }, [playbackSpeed]);

    // Sync with Server State on Mount/Update
    useEffect(() => {
        if (initialRadioState) {
            setTrackIndex(initialRadioState.trackIndex);
            if (initialRadioState.playbackSpeed) {
                setPlaybackSpeed(initialRadioState.playbackSpeed);
            }
            if (initialRadioState.trackIndex !== trackIndex) {
                audioRef.current.src = playlist[initialRadioState.trackIndex].src;
            }
            if (initialRadioState.isPlaying !== isPlaying) {
                setIsPlaying(initialRadioState.isPlaying);
                if (initialRadioState.isPlaying) {
                    audioRef.current.play().catch(() => { });
                }
            }
        }
    }, [initialRadioState]);

    // Socket listeners for sync
    useEffect(() => {
        socket.on('radio_update', (action) => {
            if (audioContextRef.current?.state === 'suspended') {
                audioContextRef.current.resume();
            }

            if (action.type === 'play_track') {
                setTrackIndex(action.trackIndex);
                setIsPlaying(true);
                audioRef.current.src = playlist[action.trackIndex].src;
                audioRef.current.play().catch(e => console.log("Autoplay blocked"));
            } else if (action.type === 'pause') {
                setIsPlaying(false);
                audioRef.current.pause();
            } else if (action.type === 'resume') {
                setIsPlaying(true);
                audioRef.current.play().catch(() => { });
            } else if (action.type === 'set_volume') {
                // Sync volume from other player
                setVolume(action.volume);
                audioRef.current.volume = Math.min(action.volume, 1);
                if (gainNodeRef.current) {
                    gainNodeRef.current.gain.value = action.volume;
                }
            } else if (action.type === 'sync') {
                // Full sync - seek to exact position
                if (action.trackIndex !== trackIndex) {
                    audioRef.current.src = playlist[action.trackIndex].src;
                    setTrackIndex(action.trackIndex);
                }
                if (action.currentTime !== undefined) {
                    audioRef.current.currentTime = action.currentTime;
                }
                if (action.volume !== undefined) {
                    setVolume(action.volume);
                    audioRef.current.volume = Math.min(action.volume, 1);
                    if (gainNodeRef.current) {
                        gainNodeRef.current.gain.value = action.volume;
                    }
                }
                if (action.isPlaying) {
                    setIsPlaying(true);
                    audioRef.current.play().catch(() => { });
                } else {
                    setIsPlaying(false);
                    audioRef.current.pause();
                }
            }
        });

        return () => {
            socket.off('radio_update');
        };
    }, [socket, trackIndex]);

    const handlePlayPause = () => {
        if (isPlaying) {
            socket.emit('radio_action', { gameId, action: { type: 'pause' } });
            setIsPlaying(false);
            audioRef.current.pause();
        } else {
            // Ensure AudioContext is created and resumed on user interaction
            setupAudioContext();

            socket.emit('radio_action', {
                gameId,
                action: {
                    type: 'sync',
                    trackIndex,
                    currentTime: audioRef.current.currentTime,
                    volume: volume,
                    isPlaying: true
                }
            });

            audioRef.current.play()
                .then(() => {
                    setIsPlaying(true);
                    setAutoplayBlocked(false);
                })
                .catch((e) => {
                    console.log("Autoplay blocked:", e);
                    setAutoplayBlocked(true);
                    setIsPlaying(false);
                });
        }
    };

    const handleNext = () => {
        setupAudioContext();
        const nextIndex = (trackIndex + 1) % playlist.length;
        setTrackIndex(nextIndex);
        audioRef.current.src = playlist[nextIndex].src;
        audioRef.current.play()
            .then(() => {
                setIsPlaying(true);
                setAutoplayBlocked(false);
            })
            .catch((e) => {
                console.log("Autoplay blocked:", e);
                setAutoplayBlocked(true);
            });
        socket.emit('radio_action', { gameId, action: { type: 'play_track', trackIndex: nextIndex } });
    };

    const handlePrev = () => {
        setupAudioContext();
        const prevIndex = (trackIndex - 1 + playlist.length) % playlist.length;
        setTrackIndex(prevIndex);
        audioRef.current.src = playlist[prevIndex].src;
        audioRef.current.play().catch((e) => console.log("Autoplay blocked:", e));
        setIsPlaying(true);
        socket.emit('radio_action', { gameId, action: { type: 'play_track', trackIndex: prevIndex } });
    };

    const handleVolumeChange = (newVolume) => {
        setVolume(newVolume);
        audioRef.current.volume = Math.min(newVolume, 1);
        if (gainNodeRef.current) {
            gainNodeRef.current.gain.value = newVolume;
        }
        socket.emit('radio_action', { gameId, action: { type: 'set_volume', volume: newVolume } });
    };

    return (
        <div className="radio-container pixel-box">
            <div className="radio-display">
                <span className="scrolling-text">{playlist[trackIndex].title}</span>
            </div>
            {autoplayBlocked && (
                <div style={{ color: '#ff6', fontSize: '8px', textAlign: 'center', marginBottom: '5px' }}>
                    🔇 Click play to enable audio
                </div>
            )}
            {!readOnly && (
                <>
                    <div className="radio-controls">
                        <button className="pixel-btn small" onClick={handlePrev}>|&lt;</button>
                        <button className="pixel-btn small" onClick={handlePlayPause} style={autoplayBlocked ? { animation: 'blink 0.5s infinite' } : {}}>
                            {isPlaying ? '||' : '>'}
                        </button>
                        <button className="pixel-btn small" onClick={handleNext}>&gt;|</button>
                    </div>
                    {/* Volume/Strength Control (0 to 2X) */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '5px', fontSize: '8px' }}>
                        <span>VOL</span>
                        <input
                            type="range"
                            min="0" max="2" step="0.1"
                            value={volume}
                            onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                            style={{ width: '50px' }}
                        />
                        <span>{volume}x</span>
                    </div>
                </>
            )}
        </div>
    );
}

