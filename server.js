const WebSocket = require('ws');
const http = require('http');
const express = require('express');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Store active games and players
const games = new Map();
let nextGameId = 1;

// Available colors for players
const playerColors = [
    0xFF4444, // Red
    0x44FF44, // Green
    0x4444FF, // Blue
    0xFFFF44, // Yellow
    0xFF44FF, // Magenta
    0x44FFFF, // Cyan
    0xFF8844, // Orange
    0x8844FF  // Purple
];

function broadcastGameState(gameId) {
    const game = games.get(gameId);
    if (!game) return;

    const gameState = {
        type: 'gameState',
        gameStarted: game.gameStarted,
        players: Array.from(game.players.entries()).map(([id, data]) => ({
            id,
            position: game.positions.get(id),
            color: data.color,
            health: data.health,
            isAlive: data.isAlive
        }))
    };

    game.players.forEach((player) => {
        player.ws.send(JSON.stringify(gameState));
    });
}

function broadcastToGame(gameId, message) {
    const game = games.get(gameId);
    if (game) {
        game.players.forEach((player) => {
            player.ws.send(message);
        });
    }
}

// Add connection health monitoring
const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (!ws.isAlive) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => ws.isAlive = true);

    let playerId = Math.random().toString(36).substring(7);
    let gameId = null;

    // Modified message handler
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (!data.type) throw new Error('Missing message type');
            
            // Validate message structure
            switch(data.type) {
                case 'hit':
                    if (!data.targetId || typeof data.targetId !== 'string') {
                        throw new Error('Invalid hit message - missing targetId');
                    }
                    break;
            }
            
            switch(data.type) {
                case 'host':
                    gameId = nextGameId++;
                    const hostColor = playerColors[0];
                    games.set(gameId, {
                        hostId: playerId,
                        players: new Map([[playerId, {
                            ws,
                            color: hostColor,
                            health: 100,
                            isAlive: true
                        }]]),
                        positions: new Map([[playerId, data.position]]),
                        nextColorIndex: 1,
                        gameStarted: false
                    });
                    ws.send(JSON.stringify({
                        type: 'gameCreated',
                        gameId: gameId,
                        playerId: playerId,
                        color: hostColor,
                        isHost: true
                    }));
                    break;

                case 'join':
                    const game = games.get(data.gameId);
                    if (game) {
                        gameId = data.gameId;
                        const playerColor = playerColors[game.nextColorIndex % playerColors.length];
                        game.nextColorIndex++;
                        
                        // Add new player
                        game.players.set(playerId, {
                            ws,
                            color: playerColor,
                            health: 100,
                            isAlive: true
                        });
                        game.positions.set(playerId, data.position);

                        // Send game state to new player
                        const currentPlayers = Array.from(game.players.entries())
                            .filter(([id]) => id !== playerId)
                            .map(([id, player]) => ({
                                id,
                                position: game.positions.get(id),
                                color: player.color,
                                health: player.health,
                                isAlive: player.isAlive,
                                isHost: id === game.hostId
                            }));

                        ws.send(JSON.stringify({
                            type: 'gameJoined',
                            gameId: gameId,
                            playerId: playerId,
                            color: playerColor,
                            players: currentPlayers
                        }));

                        // Notify all existing players about the new player
                        game.players.forEach((player, id) => {
                            if (id !== playerId) {
                                player.ws.send(JSON.stringify({
                                    type: 'playerJoined',
                                    playerId: playerId,
                                    position: data.position,
                                    color: playerColor,
                                    health: 100,
                                    isAlive: true,
                                    isHost: false
                                }));
                            }
                        });

                        // Broadcast full game state to ensure synchronization
                        broadcastGameState(gameId);
                    }
                    break;

                case 'startGame':
                    const gameToStart = games.get(gameId);
                    if (gameToStart && gameToStart.hostId === playerId) {
                        gameToStart.gameStarted = true;
                        broadcastToGame(gameId, JSON.stringify({
                            type: 'gameStarted'
                        }));
                    }
                    break;

                case 'update':
                    const currentGame = games.get(gameId);
                    if (currentGame) {
                        currentGame.positions.set(playerId, data.position);
                        
                        // Broadcast position to all other players
                        currentGame.players.forEach((player, id) => {
                            if (id !== playerId) {
                                player.ws.send(JSON.stringify({
                                    type: 'playerMoved',
                                    playerId: playerId,
                                    position: data.position
                                }));
                            }
                        });
                    }
                    break;

                case 'shoot':
                    const shootGame = games.get(gameId);
                    if (shootGame) {
                        const shooter = shootGame.players.get(playerId);
                        // Broadcast shot to all other players with correct color
                        shootGame.players.forEach((player, id) => {
                            if (id !== playerId) {
                                player.ws.send(JSON.stringify({
                                    type: 'playerShot',
                                    playerId: playerId,
                                    position: data.position,
                                    direction: data.direction,
                                    color: shooter.color
                                }));
                            }
                        });
                    }
                    break;

                case 'hit':
                    // Broadcast hit to all players
                    const hitMessage = JSON.stringify({
                        type: 'playerEliminated',
                        targetId: data.targetId,
                        shooterId: playerId
                    });
                    broadcastToGame(gameId, hitMessage);
                    break;
            }
            
        } catch (error) {
            console.error('Message error:', error.message);
            ws.close(1008, 'Protocol violation');
        }
    });

    ws.on('close', () => {
        if (gameId && games.has(gameId)) {
            const game = games.get(gameId);
            game.players.delete(playerId);
            game.positions.delete(playerId);

            // Notify remaining players
            game.players.forEach((player) => {
                player.ws.send(JSON.stringify({
                    type: 'playerLeft',
                    playerId: playerId
                }));
            });

            // Clean up empty games
            if (game.players.size === 0) {
                games.delete(gameId);
            } else {
                // Broadcast updated game state
                broadcastGameState(gameId);
            }
        }
    });
});

// Serve static files
app.use(express.static('.'));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
