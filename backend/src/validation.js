const CARD_TYPES = new Set(['citizen', 'emperor', 'slave']);
const RESERVED_IDS = new Set(['__proto__', 'constructor', 'prototype']);

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isGameId(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value)
        && !RESERVED_IDS.has(value);
}

function gameRoom(gameId) {
    return `game:${gameId}`;
}

function normalizeConfig(config = {}) {
    if (!isRecord(config)) return null;
    const result = {
        initialHearts: config.initialHearts ?? 20,
        maxRounds: config.maxRounds ?? 8,
        swapInterval: config.swapInterval ?? 2,
        revealSpectatorHands: config.revealSpectatorHands ?? false
    };
    for (const [key, min, max] of [
        ['initialHearts', 10, 100], ['maxRounds', 4, 24], ['swapInterval', 1, 10]
    ]) {
        if (!Number.isInteger(result[key]) || result[key] < min || result[key] > max) return null;
    }
    return typeof result.revealSpectatorHands === 'boolean' ? result : null;
}

function isCardType(value) {
    return CARD_TYPES.has(value);
}

function isFiniteNumber(value, min, max) {
    return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function normalizeRadioAction(action) {
    if (!isRecord(action)) return null;
    switch (action.type) {
        case 'pause':
        case 'resume':
            return { type: action.type };
        case 'play_track':
            return Number.isInteger(action.trackIndex) && action.trackIndex >= 0 && action.trackIndex < 4
                ? { type: action.type, trackIndex: action.trackIndex } : null;
        case 'set_volume':
            return isFiniteNumber(action.volume, 0, 2) ? { type: action.type, volume: action.volume } : null;
        case 'sync': {
            if (!Number.isInteger(action.trackIndex) || action.trackIndex < 0 || action.trackIndex >= 4
                || !isFiniteNumber(action.volume, 0, 2) || typeof action.isPlaying !== 'boolean'
                || (action.currentTime !== undefined && !isFiniteNumber(action.currentTime, 0, 86400))) return null;
            const result = { type: action.type, trackIndex: action.trackIndex, volume: action.volume, isPlaying: action.isPlaying };
            if (action.currentTime !== undefined) result.currentTime = action.currentTime;
            return result;
        }
        default:
            return null;
    }
}

module.exports = { isRecord, isGameId, gameRoom, normalizeConfig, isCardType, isFiniteNumber, normalizeRadioAction };
