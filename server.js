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

wss.on('connection', (ws) => {
    let playerId = Math.random().toString(36).substring(7);
    let gameId = null;

    ws.on('message', (message) => {
        const data = JSON.parse(message);
        
        switch(data.type) {
            case 'host':
                gameId = nextGameId++;
                const hostColor = playerColors[0];
                games.set(gameId, {
                    host: playerId,
                    players: new Map([[playerId, {
                        ws,
                        color: hostColor
                    }]]),
                    positions: new Map([[playerId, data.position]]),
                    nextColorIndex: 1
                });
                ws.send(JSON.stringify({
                    type: 'gameCreated',
                    gameId: gameId,
                    playerId: playerId,
                    color: hostColor
                }));
                break;

            case 'join':
                const game = games.get(data.gameId);
                if (game) {
                    gameId = data.gameId;
                    const playerColor = playerColors[game.nextColorIndex % playerColors.length];
                    game.nextColorIndex++;
                    
                    game.players.set(playerId, {
                        ws,
                        color: playerColor
                    });
                    game.positions.set(playerId, data.position);

                    // Send existing players to new player first
                    const existingPlayers = Array.from(game.players.entries())
                        .filter(([id]) => id !== playerId)
                        .map(([id, player]) => ({
                            id,
                            position: game.positions.get(id),
                            color: player.color
                        }));
                    
                    ws.send(JSON.stringify({
                        type: 'gameJoined',
                        gameId: gameId,
                        playerId: playerId,
                        color: playerColor,
                        players: existingPlayers
                    }));

                    // Then notify all existing players about the new player
                    game.players.forEach((player, id) => {
                        if (id !== playerId) {
                            player.ws.send(JSON.stringify({
                                type: 'playerJoined',
                                playerId: playerId,
                                position: data.position,
                                color: playerColor
                            }));
                        }
                    });
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
                    const shooterData = shootGame.players.get(playerId);
                    // Broadcast shot to all other players
                    shootGame.players.forEach((player, id) => {
                        if (id !== playerId) {
                            player.ws.send(JSON.stringify({
                                type: 'playerShot',
                                playerId: playerId,
                                position: data.position,
                                direction: data.direction,
                                color: shooterData.color
                            }));
                        }
                    });
                }
                break;
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
