const { isGameId, gameRoom, normalizeConfig, isCardType, normalizeRadioAction } = require('./validation');

class GameManager {
    constructor(io) {
        this.io = io;
        this.games = Object.create(null);
    }

    getGame(gameId) {
        return isGameId(gameId) ? this.games[gameId] : undefined;
    }

    hasPlayer(socket, gameId) {
        return !!this.getGame(gameId)?.players.some(p => p.id === socket.id);
    }

    createGame(gameId, config) {
        const finalConfig = normalizeConfig(config);
        if (!isGameId(gameId) || !finalConfig || this.getGame(gameId)) return null;

        this.games[gameId] = {
            id: gameId,
            config: finalConfig,
            players: [], // { socketId, role, hearts, currentCard }
            spectators: [], // Array of spectator socket IDs
            round: 1,
            state: 'waiting',
            bet: 0,
            roles: {
                emperor: null,
                slave: null
            },
            history: [],
            timer: 180,
            timerInterval: null,
            pendingTimeouts: new Set(),
            radio: { trackIndex: 0, isPlaying: false, volume: 1 }
        };
        return this.games[gameId];
    }

    handleJoin(socket, gameId, config) {
        if (!isGameId(gameId)) {
            socket.emit('error', { message: 'Room IDs must contain 1–64 letters, numbers, underscores or hyphens.' });
            return;
        }
        const joinedGame = Object.values(this.games).find(g =>
            g.players.some(p => p.id === socket.id) || g.spectators.includes(socket.id));
        if (joinedGame) {
            if (joinedGame.id === gameId && this.hasPlayer(socket, gameId)) {
                socket.emit('game_update', this.getPublicState(gameId));
            } else {
                socket.emit('error', { message: 'Leave your current room before joining another.' });
            }
            return;
        }
        let game = this.getGame(gameId);
        if (!game) {
            game = this.createGame(gameId, config);
            if (!game) {
                socket.emit('error', { message: 'Invalid game settings.' });
                return;
            }
        }

        if (game.players.length >= 2) {
            socket.emit('error', { message: 'Game full' });
            return;
        }

        const player = {
            id: socket.id,
            hearts: game.config.initialHearts, // Use config setting
            money: 0,   // Score
            hand: [],
            playedCard: null,
            hasBet: false,
            betAmount: 0
        };

        game.players.push(player);
        socket.join(gameRoom(gameId));

        console.log(`Player ${socket.id} joined game ${gameId}`);

        if (game.players.length === 2) {
            this.startGame(gameId);
        } else {
            this.broadcastState(gameId);
        }
    }

    handleSpectatorJoin(socket, gameId) {
        const game = this.getGame(gameId);
        if (!game) {
            socket.emit('error', { message: 'Game not found. Create a game first.' });
            return;
        }

        const joinedGame = Object.values(this.games).find(g =>
            g.players.some(p => p.id === socket.id) || g.spectators.includes(socket.id));
        if (joinedGame) {
            if (joinedGame === game && game.spectators.includes(socket.id)) {
                socket.emit('spectator_join', this.getSpectatorState(gameId));
            } else {
                socket.emit('error', { message: 'Leave your current room before spectating.' });
            }
            return;
        }
        game.spectators.push(socket.id);
        socket.join(gameRoom(gameId));

        console.log(`Spectator ${socket.id} joined game ${gameId}`);

        socket.emit('spectator_join', this.getSpectatorState(gameId));
    }

    getSpectatorState(gameId) {
        const game = this.getGame(gameId);
        if (!game) return null;

        return {
            id: game.id,
            config: game.config,
            round: game.round,
            state: game.state,
            isSpectator: true,
            players: game.players.map(p => ({
                id: p.id,
                hearts: p.hearts,
                money: p.money,
                hand: game.config.revealSpectatorHands ? [...p.hand] : p.hand.map(() => 'back'),
                playedCard: game.config.revealSpectatorHands || game.state === 'resolved' || game.state === 'finished'
                    ? p.playedCard : null,
                hasPlayed: !!p.playedCard,
                hasBet: p.hasBet,
                betAmount: p.hasBet ? p.betAmount : null,
                handSize: p.hand.length
            })),
            roles: game.roles,
            bet: game.bet,
            radio: game.radio
        };
    }

    broadcastState(gameId) {
        const game = this.getGame(gameId);
        if (!game) return;

        const publicState = this.getPublicState(gameId);
        this.io.to(gameRoom(gameId)).emit('game_update', publicState);

        if (game.spectators && game.spectators.length > 0) {
            const specState = this.getSpectatorState(gameId);
            game.spectators.forEach(sid => {
                this.io.to(sid).emit('spectator_update', specState);
            });
        }
    }

    startGame(gameId) {
        const game = this.getGame(gameId);
        if (!game || game.state !== 'waiting' || game.players.length !== 2) return;
        game.roles.emperor = game.players[0].id;
        game.roles.slave = game.players[1].id;

        game.state = 'betting';
        this.dealCards(gameId);

        this.io.to(gameRoom(gameId)).emit('game_start', {
            message: 'Game Started',
            roles: game.roles,
            config: game.config
        });
        this.broadcastState(gameId);
    }

    dealCards(gameId) {
        const game = this.getGame(gameId);
        game.players.forEach(p => {
            const isEmperor = p.id === game.roles.emperor;
            if (isEmperor) {
                p.hand = ['citizen', 'citizen', 'citizen', 'citizen', 'emperor'];
            } else {
                p.hand = ['citizen', 'citizen', 'citizen', 'citizen', 'slave'];
            }
            p.hand.sort(() => Math.random() - 0.5);
            p.playedCard = null;
            p.hasBet = false;
            p.betAmount = 0;

            this.io.to(p.id).emit('hand_update', { hand: p.hand });
        });
        game.bet = 0;
    }

    handleBet(socket, gameId, amount) {
        const game = this.getGame(gameId);
        if (!game || game.state !== 'betting') return;
        if (!Number.isSafeInteger(amount) || amount < 1) return;

        const player = game.players.find(p => p.id === socket.id);
        if (!player || player.hasBet) return;

        const validAmount = Math.max(1, Math.min(amount, player.hearts));

        player.betAmount = validAmount;
        player.hasBet = true;

        if (game.players.every(p => p.hasBet)) {
            const p1Bet = game.players[0].betAmount;
            const p2Bet = game.players[1].betAmount;

            const minHearts = Math.min(game.players[0].hearts, game.players[1].hearts);
            game.bet = Math.min(Math.max(p1Bet, p2Bet), minHearts);

            game.state = 'playing';
            this.startTimer(gameId); // Start 3 min timer
            this.io.to(gameRoom(gameId)).emit('phase_change', { phase: 'playing', bet: game.bet });
        }

        this.broadcastState(gameId);
    }

    handlePlayCard(socket, gameId, cardType) {
        const game = this.getGame(gameId);
        if (!game || game.state !== 'playing') return;
        if (!isCardType(cardType)) return;

        const player = game.players.find(p => p.id === socket.id);
        if (!player || player.playedCard) return;

        const index = player.hand.indexOf(cardType);
        if (index === -1) return;

        player.hand.splice(index, 1);
        player.playedCard = cardType;

        this.io.to(socket.id).emit('hand_update', { hand: player.hand });
        this.io.to(gameRoom(gameId)).emit('player_action', { playerId: socket.id, action: 'played_card' });

        if (game.players.every(p => p.playedCard)) {
            this.resolveRound(gameId);
        } else {
            // Update state so clients know who has played (to show "Ready" or "Waiting")
            this.broadcastState(gameId);
        }
    }

    handleRequestHand(socket, gameId) {
        const game = this.getGame(gameId);
        if (!game) return;
        const player = game.players.find(p => p.id === socket.id);
        if (player) {
            this.io.to(socket.id).emit('hand_update', { hand: player.hand });
        }
    }

    handleHandReorder(socket, gameId, newHand) {
        const game = this.getGame(gameId);
        if (!game || !['betting', 'playing'].includes(game.state)) return;
        const player = game.players.find(p => p.id === socket.id);
        if (!player) return;

        if (!Array.isArray(newHand) || player.hand.length !== newHand.length || !newHand.every(isCardType)) return;
        // Reordering preserves the complete multiset, including duplicate citizens.
        const current = [...player.hand].sort();
        const proposed = [...newHand].sort();
        if (!current.every((card, index) => card === proposed[index])) return;
        player.hand = [...newHand];
    }

    resolveRound(gameId) {
        const game = this.getGame(gameId);
        if (!game || game.state !== 'playing' || game.players.length !== 2
            || !game.players.every(p => p.playedCard)) return;
        this.stopTimer(gameId); // Stop timer
        game.state = 'resolved';

        // Emit game_update FIRST so all players know opponent has played
        this.broadcastState(gameId);

        const p1 = game.players[0];
        const p2 = game.players[1];

        const result = this.calculateWinner(p1.playedCard, p2.playedCard);
        console.log(`[RESOLVE] P1(${p1.playedCard}) vs P2(${p2.playedCard}) -> ${result}. Hands: ${p1.hand.length}/${p2.hand.length}`);

        let winnerId = null;
        let heartsLost = 0;
        let moneyGain = 0;

        if (result === 'p1_wins') {
            winnerId = p1.id;
            // Loser loses THEIR OWN bet, not the max bet
            heartsLost = p2.betAmount;
            // 5x multiplier for slave beating emperor
            if (p1.playedCard === 'slave' && p2.playedCard === 'emperor') heartsLost *= 5;
        } else if (result === 'p2_wins') {
            winnerId = p2.id;
            // Loser loses THEIR OWN bet, not the max bet
            heartsLost = p1.betAmount;
            // 5x multiplier for slave beating emperor
            if (p2.playedCard === 'slave' && p1.playedCard === 'emperor') heartsLost *= 5;
        }

        if (result !== 'tie') {
            const winner = game.players.find(p => p.id === winnerId);
            const loser = game.players.find(p => p.id !== winnerId);

            // Winner gains money based on loser's bet
            moneyGain = heartsLost * 100000;
            winner.money += moneyGain;
            loser.hearts -= heartsLost;

            // Track round history
            game.history.push({
                round: game.round,
                p1Card: p1.playedCard,
                p2Card: p2.playedCard,
                p1Bet: p1.betAmount,
                p2Bet: p2.betAmount,
                winner: result,
                heartsLost: heartsLost,
                moneyGain: moneyGain,
                winnerId: winnerId
            });

            if (loser.hearts <= 0) {
                this.io.to(gameRoom(gameId)).emit('round_result', {
                    p1Card: p1.playedCard,
                    p2Card: p2.playedCard,
                    winner: result,
                    heartsLost: heartsLost,
                    payout: moneyGain,
                    p1Hearts: p1.hearts,
                    p2Hearts: p2.hearts,
                    p1Money: p1.money,
                    p2Money: p2.money,
                    p1Bet: p1.betAmount,
                    p2Bet: p2.betAmount,
                    playedCards: {
                        [p1.id]: p1.playedCard,
                        [p2.id]: p2.playedCard
                    },
                    gameOver: true
                });

                this.schedule(gameId, () => {
                    this.io.to(gameRoom(gameId)).emit('game_over', {
                        winner: winner.id,
                        reason: 'bankruptcy',
                        history: game.history,
                        finalStats: {
                            p1: { id: p1.id, hearts: p1.hearts, money: p1.money },
                            p2: { id: p2.id, hearts: p2.hearts, money: p2.money }
                        }
                    });
                    game.state = 'finished';
                }, 3000);
                return;
            }
        } else {
            // Track tie in history too
            game.history.push({
                round: game.round,
                p1Card: p1.playedCard,
                p2Card: p2.playedCard,
                p1Bet: p1.betAmount,
                p2Bet: p2.betAmount,
                winner: 'tie',
                heartsLost: 0,
                moneyGain: 0,
                winnerId: null
            });
        }

        this.io.to(gameRoom(gameId)).emit('round_result', {
            p1Card: p1.playedCard,
            p2Card: p2.playedCard,
            winner: result,
            heartsLost: heartsLost,
            payout: moneyGain,
            p1Hearts: p1.hearts,
            p2Hearts: p2.hearts,
            p1Money: p1.money,
            p2Money: p2.money,
            p1Bet: p1.betAmount,
            p2Bet: p2.betAmount,
            playedCards: {
                [p1.id]: p1.playedCard,
                [p2.id]: p2.playedCard
            }
        });


        // Handle tie vs win differently
        if (result === 'tie') {
            // On tie: DON'T return cards - players continue with remaining cards
            // A round only ends when someone wins
            this.schedule(gameId, () => {
                game.players.forEach(p => {
                    // Don't return the card - just clear played state
                    p.playedCard = null;
                });
                game.state = 'playing';
                this.startTimer(gameId);
                this.io.to(gameRoom(gameId)).emit('tie_replay', {
                    message: 'Tie! Play again with remaining cards.'
                });
                this.broadcastState(gameId);
            }, 9000); // 9s delay (Sync with ~8s frontend animation)
        } else {
            // On win/loss: Proceed to next round with new cards
            this.schedule(gameId, () => {
                this.nextRound(gameId);
            }, 9000); // 9s delay
        }
    }

    calculateWinner(c1, c2) {
        if (c1 === c2) return 'tie';
        if (c1 === 'emperor') return (c2 === 'slave') ? 'p2_wins' : 'p1_wins';
        if (c1 === 'citizen') return (c2 === 'emperor') ? 'p2_wins' : (c2 === 'slave') ? 'p1_wins' : 'tie';
        if (c1 === 'slave') return (c2 === 'emperor') ? 'p1_wins' : 'p2_wins';
        return 'tie';
    }

    nextRound(gameId) {
        const game = this.getGame(gameId);
        if (!game || game.players.length !== 2) return;
        game.round++;

        if (game.round > game.config.maxRounds) {
            game.state = 'finished';
            // Determine winner by Money
            const p1 = game.players[0];
            const p2 = game.players[1];
            let winnerId = null;
            let reason = 'rounds_limit';

            if (p1.money > p2.money) winnerId = p1.id;
            else if (p2.money > p1.money) winnerId = p2.id;
            else {
                // If money tied, it's a draw
                winnerId = 'draw';
            }

            this.io.to(gameRoom(gameId)).emit('game_over', {
                winner: winnerId,
                reason: reason,
                history: game.history,
                finalStats: {
                    p1: { id: p1.id, hearts: p1.hearts, money: p1.money },
                    p2: { id: p2.id, hearts: p2.hearts, money: p2.money }
                },
                config: game.config
            });
            return;
        }

        const interval = parseInt(game.config.swapInterval);
        const blockIndex = Math.floor((game.round - 1) / interval);
        const p1IsEmperor = (blockIndex % 2 === 0);

        game.roles.emperor = p1IsEmperor ? game.players[0].id : game.players[1].id;
        game.roles.slave = p1IsEmperor ? game.players[1].id : game.players[0].id;

        // Emit new_round FIRST so frontend can reset card positions
        this.io.to(gameRoom(gameId)).emit('new_round', {
            round: game.round,
            roles: game.roles
        });

        this.dealCards(gameId); // This emits hand_update after new_round reset
        game.state = 'betting';

        this.broadcastState(gameId);
    }

    getPublicState(gameId) {
        const game = this.getGame(gameId);
        return {
            id: game.id,
            config: game.config,
            round: game.round,
            state: game.state,
            players: game.players.map(p => ({
                id: p.id,
                hearts: p.hearts,
                money: p.money,
                hasPlayed: !!p.playedCard,
                hasBet: p.hasBet,
                betAmount: p.hasBet ? p.betAmount : null,
                handSize: p.hand.length
            })),
            roles: game.roles,
            bet: game.bet,
            radio: game.radio // Sync radio state
        };
    }

    handleDisconnect(socket) {
        // Find game player is in
        Object.keys(this.games).forEach(gameId => {
            const game = this.getGame(gameId);

            // Check if it's a spectator
            const spectatorIndex = game.spectators.indexOf(socket.id);
            if (spectatorIndex !== -1) {
                console.log(`Spectator ${socket.id} disconnected from ${gameId}`);
                game.spectators.splice(spectatorIndex, 1);
                return; // Don't delete the game if spectator leaves
            }

            // Check if it's a player
            const playerIndex = game.players.findIndex(p => p.id === socket.id);
            if (playerIndex !== -1) {
                console.log(`Player ${socket.id} disconnected from ${gameId}`);
                this.clearTimers(game);
                game.players.splice(playerIndex, 1);
                this.io.to(gameRoom(gameId)).emit('error', { message: 'Opponent Disconnected. Please Refresh.' });
                this.io.in(gameRoom(gameId)).socketsLeave(gameRoom(gameId));
                delete this.games[gameId];
            }
        });
    }

    // --- Timer Logic ---
    startTimer(gameId, duration = 180) {
        const game = this.getGame(gameId);
        if (!game || game.state !== 'playing' || game.players.length !== 2) return;
        if (game.timerInterval) clearInterval(game.timerInterval);

        game.timer = duration;
        game.timerInterval = setInterval(() => {
            if (this.getGame(gameId) !== game) {
                clearInterval(game.timerInterval);
                return;
            }

            game.timer--;

            // Broadcast timer tick every second or just rely on client?
            // Client countdown is smoother, but server validation is key.
            // Let's emit a sync every 10s or when important?
            // For now, let's emit 'timer_update' every second?
            // Actually, for a simple game, emitting 'timer_update' {remaining} every second is fine.
            this.io.to(gameRoom(gameId)).emit('timer_update', { remaining: game.timer });

            if (game.timer <= 0) {
                clearInterval(game.timerInterval);
                this.handleTimeout(gameId);
            }
        }, 1000);
    }

    handleTimeout(gameId) {
        const game = this.getGame(gameId);
        if (!game || game.state !== 'playing') return;

        const p1 = game.players[0];
        const p2 = game.players[1];

        // Case 1: No cards played -> Add 1 Minute
        if (!p1.playedCard && !p2.playedCard) {
            this.io.to(gameRoom(gameId)).emit('message', { text: 'No plays - Time Extended +1min' });
            this.startTimer(gameId, 60);
            return;
        }

        // Case 2: One played -> The other Loses
        let winnerId = null;
        let winCode = '';

        if (p1.playedCard && !p2.playedCard) {
            winnerId = p1.id;
            winCode = 'p1_wins';
        } else if (p2.playedCard && !p1.playedCard) {
            winnerId = p2.id;
            winCode = 'p2_wins';
        } else {
            // Fallback if state weird
            return;
        }

        this.stopTimer(gameId);
        game.state = 'resolved';
        const winner = game.players.find(p => p.id === winnerId);
        const loser = game.players.find(p => p.id !== winnerId);

        const payout = game.bet * 100000;
        winner.money += payout;
        loser.hearts -= game.bet;

        this.io.to(gameRoom(gameId)).emit('round_result', {
            p1Card: p1.playedCard,
            p2Card: p2.playedCard,
            winner: winCode,
            payout: payout,
            p1Hearts: p1.hearts,
            p2Hearts: p2.hearts,
            p1Money: p1.money,
            p2Money: p2.money,
            playedCards: {
                [p1.id]: p1.playedCard,
                [p2.id]: p2.playedCard
            },
            gameOver: loser.hearts <= 0,
            reason: 'timeout'
        });

        if (loser.hearts <= 0) {
            this.schedule(gameId, () => {
                this.io.to(gameRoom(gameId)).emit('game_over', {
                    winner: winner.id,
                    reason: 'bankruptcy'
                });
                game.state = 'finished';
            }, 3000);
        } else {
            this.schedule(gameId, () => {
                this.nextRound(gameId);
            }, 9000);
        }
    }


    stopTimer(gameId) {
        const game = this.getGame(gameId);
        if (game && game.timerInterval) clearInterval(game.timerInterval);
        if (game) game.timerInterval = null;
    }

    schedule(gameId, callback, delay) {
        const game = this.getGame(gameId);
        if (!game) return;
        const timer = setTimeout(() => {
            game.pendingTimeouts.delete(timer);
            if (this.getGame(gameId) === game) callback();
        }, delay);
        game.pendingTimeouts.add(timer);
    }

    clearTimers(game) {
        if (game.timerInterval) clearInterval(game.timerInterval);
        game.timerInterval = null;
        for (const timer of game.pendingTimeouts) clearTimeout(timer);
        game.pendingTimeouts.clear();
    }

    // --- Radio Logic ---
    handleRadioAction(socket, gameId, action) {
        const game = this.getGame(gameId);
        action = normalizeRadioAction(action);
        if (!game || !this.hasPlayer(socket, gameId) || !action) return;

        // Update server state based on action type
        if (action.type === 'play_track') {
            game.radio.trackIndex = action.trackIndex;
            game.radio.isPlaying = true;
        } else if (action.type === 'pause') {
            game.radio.isPlaying = false;
        } else if (action.type === 'resume') {
            game.radio.isPlaying = true;
        } else if (action.type === 'set_volume') {
            game.radio.volume = action.volume;
        } else if (action.type === 'sync') {
            game.radio.trackIndex = action.trackIndex;
            game.radio.volume = action.volume;
            game.radio.isPlaying = action.isPlaying;
        }

        // Broadcast to ALL players in game for perfect sync
        this.io.to(gameRoom(gameId)).emit('radio_update', action);
    }

    handleRequestPlayAgain(socket, gameId) {
        const game = this.getGame(gameId);
        if (!game || game.state !== 'finished' || game.players.length !== 2 || !this.hasPlayer(socket, gameId)) return;

        if (!game.playAgainRequests) {
            game.playAgainRequests = new Set();
        }

        game.playAgainRequests.add(socket.id);

        // Notify waiting status
        this.io.to(gameRoom(gameId)).emit('play_again_status', {
            requestCount: game.playAgainRequests.size,
            totalPlayers: game.players.length
        });

        if (game.playAgainRequests.size === game.players.length) {
            this.resetGame(gameId);
        }
    }

    resetGame(gameId) {
        const game = this.getGame(gameId);
        if (!game || game.players.length !== 2) return;
        this.clearTimers(game);

        // Reset Game State
        game.round = 1;
        game.state = 'betting'; // Skip 'waiting', go straight to betting
        game.bet = 0;
        game.history = [];
        game.playAgainRequests = new Set();

        // Reset Players
        game.players.forEach(p => {
            p.hearts = game.config.initialHearts; // Use config setting
            p.money = 0;
            p.playedCard = null;
            p.hasBet = false;
            p.betAmount = 0;
        });

        // Randomize the starting roles for a rematch.
        const p1IsEmperor = Math.random() > 0.5;
        game.roles.emperor = p1IsEmperor ? game.players[0].id : game.players[1].id;
        game.roles.slave = p1IsEmperor ? game.players[1].id : game.players[0].id;

        // Reset Timer
        if (game.timerInterval) clearInterval(game.timerInterval);
        game.timer = 180;

        // Deal new cards
        this.dealCards(gameId);

        // Notify Reset
        this.io.to(gameRoom(gameId)).emit('game_reset', {
            message: 'Game Restarted',
            roles: game.roles,
            config: game.config
        });

        this.broadcastState(gameId);
    }
}

module.exports = { GameManager };
