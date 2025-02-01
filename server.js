const WebSocket = require('ws');
const http = require('http');
const express = require('express');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Store active games and players
const games = new Map();
let nextGameId = 1;

wss.on('connection', (ws) => {
    let playerId = Math.random().toString(36).substring(7);
    let gameId = null;

    ws.on('message', (message) => {
        const data = JSON.parse(message);
        
        switch(data.type) {
            case 'host':
                gameId = nextGameId++;
                games.set(gameId, {
                    host: ws,
                    players: new Map([[playerId, ws]]),
                    positions: new Map([[playerId, data.position]])
                });
                ws.send(JSON.stringify({
                    type: 'gameCreated',
                    gameId: gameId,
                    playerId: playerId
                }));
                break;

            case 'join':
                const game = games.get(data.gameId);
                if (game) {
                    gameId = data.gameId;
                    game.players.set(playerId, ws);
                    game.positions.set(playerId, data.position);
                    
                    // Notify host of new player
                    game.host.send(JSON.stringify({
                        type: 'playerJoined',
                        playerId: playerId,
                        position: data.position
                    }));

                    // Send existing players to new player
                    const players = Array.from(game.positions.entries())
                        .filter(([id]) => id !== playerId)
                        .map(([id, pos]) => ({id, position: pos}));
                    
                    ws.send(JSON.stringify({
                        type: 'gameJoined',
                        gameId: gameId,
                        playerId: playerId,
                        players: players
                    }));
                }
                break;

            case 'update':
                const currentGame = games.get(gameId);
                if (currentGame) {
                    currentGame.positions.set(playerId, data.position);
                    
                    // Broadcast position to all other players
                    currentGame.players.forEach((playerWs, id) => {
                        if (id !== playerId) {
                            playerWs.send(JSON.stringify({
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
                    // Broadcast shot to all other players
                    shootGame.players.forEach((playerWs, id) => {
                        if (id !== playerId) {
                            playerWs.send(JSON.stringify({
                                type: 'playerShot',
                                playerId: playerId,
                                position: data.position,
                                direction: data.direction
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
            game.players.forEach((playerWs) => {
                playerWs.send(JSON.stringify({
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
