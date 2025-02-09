import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

class Game {
    constructor() {
        // Initialize core properties first
        this.activeChunks = new Set();
        this.chunkSize = 100;
        this.lastChunkZ = 0;
        this.autoMoveSpeed = 0.1;
        this.distanceTraveled = 0;
        this.gameStarted = false;
        this.isHost = false;
        this.pendingGameId = null;
        this.ws = null; // Initialize WebSocket as null

        // Create UI elements
        this.menu = document.getElementById('menu');
        this.joinPrompt = document.getElementById('joinPrompt');
        this.gameIdDisplay = document.getElementById('gameId');

        // Create start button
        this.startButton = document.createElement('button');
        this.startButton.textContent = 'Start Game';
        this.startButton.className = 'button';
        this.startButton.style.display = 'none';
        this.startButton.style.position = 'fixed';
        this.startButton.style.top = '20px';
        this.startButton.style.left = '50%';
        this.startButton.style.transform = 'translateX(-50%)';
        this.startButton.style.zIndex = '1000';
        document.body.appendChild(this.startButton);

        // Add event listeners
        document.getElementById('hostButton').addEventListener('click', () => this.hostGame());
        document.getElementById('joinButton').addEventListener('click', () => {
            this.menu.style.display = 'none';
            this.joinPrompt.style.display = 'block';
        });
        document.getElementById('confirmJoin').addEventListener('click', () => {
            const gameId = parseInt(document.getElementById('gameIdInput').value);
            this.joinGame(gameId);
        });

        // Add start button click handler
        this.startButton.addEventListener('click', () => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({ type: 'startGame' }));
                this.startButton.style.display = 'none';
            }
        });

        // Setup WebSocket
        this.setupWebSocket();

        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        document.body.appendChild(this.renderer.domElement);

        // Create crosshair point
        const crosshairGeometry = new THREE.SphereGeometry(0.01, 8, 8);
        const crosshairMaterial = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.8
        });
        this.crosshairPoint = new THREE.Mesh(crosshairGeometry, crosshairMaterial);
        this.scene.add(this.crosshairPoint);

        // Load textures
        this.textureLoader = new THREE.TextureLoader();
        
        // Setup scene
        this.setupEnvironment();
        this.createCharacter();
        this.setupLighting();
        this.createObstacles();

        // Camera settings
        this.cameraRotation = new THREE.Vector2(0, 0);
        this.mouseSensitivity = 0.002;
        this.cameraDistance = 5;
        this.cameraHeight = 2;
        this.cameraPitch = 0;
        this.cameraYaw = 0;

        // Physics settings
        this.velocity = new THREE.Vector3();
        this.gravity = -0.015;
        this.jumpForce = 0.008;
        this.isJumping = false;
        this.isGrounded = true;
        this.canJump = true;
        this.jumpStartTime = 0;
        this.maxJumpTime = 300; // 0.3 seconds
        this.spacebarPressed = false;
        
        // Game state
        this.moveLeft = false;
        this.moveRight = false;
        this.canShoot = true;

        // Spawn points
        this.spawnPoints = [
            new THREE.Vector3(5, 1, 5),    // Front right
            new THREE.Vector3(-5, 1, 5),   // Front left
            new THREE.Vector3(5, 1, -5),   // Back right
            new THREE.Vector3(-5, 1, -5),  // Back left
        ];

        // Bullets
        this.bullets = [];

        // Multiplayer properties
        this.playerId = null;
        this.otherPlayers = new Map();
        this.gameId = null;
        this.playerColor = null;

        // Show menu on start
        this.menu.style.display = 'block';

        // Bind event listeners
        window.addEventListener('resize', () => this.onWindowResize(), false);
        document.addEventListener('keydown', (event) => this.onKeyDown(event));
        document.addEventListener('keyup', (event) => this.onKeyUp(event));
        document.addEventListener('mousemove', (event) => this.onMouseMove(event));
        document.addEventListener('mousedown', (event) => this.onMouseDown(event));

        // Request pointer lock on click
        this.renderer.domElement.addEventListener('click', () => {
            this.renderer.domElement.requestPointerLock();
        });

        // Animation
        this.animate();
    }

    onMouseMove(event) {
        if (document.pointerLockElement === this.renderer.domElement) {
            this.cameraYaw -= event.movementX * this.mouseSensitivity;
            this.cameraPitch -= event.movementY * this.mouseSensitivity;
            
            // Clamp the pitch to prevent over-rotation
            this.cameraPitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.cameraPitch));

            // Update character rotation to match camera
            this.character.rotation.y = this.cameraYaw;
        }
    }

    onMouseDown(event) {
        if (event.button === 0 && this.canShoot) { // Left click
            this.shoot();
        }
    }

    shoot() {
        if (!this.canShoot || !this.character || !this.crosshairPoint) return;
        
        // Create bullet with better materials
        const bulletGeometry = new THREE.SphereGeometry(0.05, 8, 8);
        const bulletMaterial = new THREE.MeshPhongMaterial({
            color: this.playerColor || 0xff0000,
            emissive: this.playerColor || 0xff0000,
            emissiveIntensity: 0.5,
            shininess: 100
        });
        const bullet = new THREE.Mesh(bulletGeometry, bulletMaterial);
        
        // Set bullet position to crosshair point
        bullet.position.copy(this.crosshairPoint.position);
        
        // Calculate direction from camera to crosshair
        const direction = new THREE.Vector3();
        direction.copy(this.crosshairPoint.position).sub(this.camera.position).normalize();
        
        // Set velocity
        bullet.velocity = direction.multiplyScalar(0.8);
        bullet.alive = true;
        bullet.lifeTime = 100;
        
        this.scene.add(bullet);
        this.bullets.push(bullet);
        
        // Send bullet data to server
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: 'shoot',
                position: {
                    x: bullet.position.x,
                    y: bullet.position.y,
                    z: bullet.position.z
                },
                direction: {
                    x: direction.x,
                    y: direction.y,
                    z: direction.z
                }
            }));
        }
        
        // Add cooldown
        this.canShoot = false;
        setTimeout(() => {
            this.canShoot = true;
        }, 250);
    }

    updateCrosshair() {
        if (!this.camera) return;

        // Get camera direction
        const cameraDirection = new THREE.Vector3(0, 0, -1);
        cameraDirection.applyQuaternion(this.camera.quaternion);

        // Position the crosshair 2 units in front of the camera
        this.crosshairPoint.position.copy(this.camera.position);
        this.crosshairPoint.position.add(cameraDirection.multiplyScalar(2));
    }

    setupEnvironment() {
        // Add ambient light
        const ambientLight = new THREE.AmbientLight(0x404040, 0.5);
        this.scene.add(ambientLight);

        // Add directional light (sun-like)
        const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
        directionalLight.position.set(100, 100, 0);
        directionalLight.castShadow = true;
        directionalLight.shadow.mapSize.width = 2048;
        directionalLight.shadow.mapSize.height = 2048;
        directionalLight.shadow.camera.near = 0.5;
        directionalLight.shadow.camera.far = 500;
        this.scene.add(directionalLight);

        // Add hemisphere light for better ambient lighting
        const hemisphereLight = new THREE.HemisphereLight(0xffffbb, 0x080820, 0.5);
        this.scene.add(hemisphereLight);

        // Enable shadows
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        // Add fog for depth
        this.scene.fog = new THREE.Fog(0x87ceeb, 0, 100);
        this.scene.background = new THREE.Color(0x87ceeb);

        // Create skybox
        const skyGeometry = new THREE.SphereGeometry(500, 32, 32);
        const skyMaterial = new THREE.MeshBasicMaterial({
            color: 0x87ceeb,
            side: THREE.BackSide,
            fog: false
        });
        const sky = new THREE.Mesh(skyGeometry, skyMaterial);
        this.scene.add(sky);
    }

    createCharacter() {
        // Create character with better materials
        const geometry = new THREE.BoxGeometry(0.5, 1, 0.5);
        const material = new THREE.MeshPhongMaterial({
            color: this.playerColor || 0xff0000,
            shininess: 30,
            specular: 0x444444
        });
        this.character = new THREE.Mesh(geometry, material);
        this.character.castShadow = true;
        this.character.receiveShadow = true;
        this.scene.add(this.character);

        // Add character details (eyes, etc.)
        const eyeGeometry = new THREE.SphereGeometry(0.05, 16, 16);
        const eyeMaterial = new THREE.MeshPhongMaterial({
            color: 0xffffff,
            shininess: 100,
            specular: 0xffffff
        });
        
        // Left eye
        const leftEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
        leftEye.position.set(0.15, 0.25, -0.25);
        this.character.add(leftEye);
        
        // Right eye
        const rightEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
        rightEye.position.set(-0.15, 0.25, -0.25);
        this.character.add(rightEye);
    }

    createChunk(x, z) {
        const geometry = new THREE.PlaneGeometry(this.chunkSize, this.chunkSize, 20, 20);
        const material = new THREE.MeshStandardMaterial({
            color: 0x3a8024,
            roughness: 0.8,
            metalness: 0.2,
            wireframe: false
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(x, 0, z);
        mesh.receiveShadow = true;

        // Add terrain variation
        const vertices = geometry.attributes.position.array;
        for (let i = 0; i < vertices.length; i += 3) {
            vertices[i + 1] = Math.sin(vertices[i] / 5) * Math.cos(vertices[i + 2] / 5) * 0.5;
        }
        geometry.computeVertexNormals();

        // Add collision box
        const box = new THREE.Box3().setFromObject(mesh);
        mesh.box = box;

        return mesh;
    }

    updateWorld() {
        // Calculate current chunk
        const currentChunkZ = Math.floor(this.character.position.z / this.chunkSize);
        
        // Generate new chunks ahead
        for (let i = 0; i <= 2; i++) {
            this.generateChunk(currentChunkZ + i);
        }
        
        // Remove chunks that are too far behind
        for (const chunk of this.activeChunks) {
            if (chunk < currentChunkZ - 1) {
                this.activeChunks.delete(chunk);
                // Remove objects in this chunk (simplified version)
                this.scene.children = this.scene.children.filter(child => {
                    if (child.position && child.position.z < chunk * this.chunkSize + this.chunkSize) {
                        return false;
                    }
                    return true;
                });
            }
        }
    }

    generateChunk(chunkZ) {
        if (this.activeChunks.has(chunkZ)) return;
        
        const groundTexture = this.textureLoader.load('https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/terrain/grasslight-big.jpg');
        groundTexture.wrapS = groundTexture.wrapT = THREE.RepeatWrapping;
        groundTexture.repeat.set(25, 25);
        groundTexture.encoding = THREE.sRGBEncoding;

        const groundGeometry = new THREE.PlaneGeometry(100, this.chunkSize);
        const groundMaterial = new THREE.MeshStandardMaterial({ 
            map: groundTexture,
            roughness: 0.8,
            metalness: 0.2
        });
        
        const ground = new THREE.Mesh(groundGeometry, groundMaterial);
        ground.rotation.x = -Math.PI / 2;
        ground.position.z = chunkZ * this.chunkSize + this.chunkSize / 2;
        ground.receiveShadow = true;
        this.scene.add(ground);
        
        // Add random obstacles
        for (let i = 0; i < 10; i++) {
            const obstacleGeometry = new THREE.BoxGeometry(
                Math.random() * 2 + 1,
                Math.random() * 3 + 1,
                Math.random() * 2 + 1
            );
            const obstacleMaterial = new THREE.MeshPhongMaterial({ color: 0x8B4513 });
            const obstacle = new THREE.Mesh(obstacleGeometry, obstacleMaterial);
            
            obstacle.position.x = Math.random() * 80 - 40;
            obstacle.position.y = obstacle.geometry.parameters.height / 2;
            obstacle.position.z = chunkZ * this.chunkSize + Math.random() * this.chunkSize;
            
            obstacle.castShadow = true;
            obstacle.receiveShadow = true;
            this.scene.add(obstacle);
        }
        
        this.activeChunks.add(chunkZ);
    }

    setupLighting() {
        // Ambient light
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
        this.scene.add(ambientLight);

        // Directional light (sun)
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(50, 50, 0);
        directionalLight.castShadow = true;
        directionalLight.shadow.mapSize.width = 2048;
        directionalLight.shadow.mapSize.height = 2048;
        directionalLight.shadow.camera.near = 0.5;
        directionalLight.shadow.camera.far = 500;
        directionalLight.shadow.camera.left = -50;
        directionalLight.shadow.camera.right = 50;
        directionalLight.shadow.camera.top = 50;
        directionalLight.shadow.camera.bottom = -50;
        this.scene.add(directionalLight);

        // Add some point lights for atmosphere
        const colors = [0xff0000, 0x00ff00, 0x0000ff];
        const positions = [
            new THREE.Vector3(-10, 5, -10),
            new THREE.Vector3(10, 5, 10),
            new THREE.Vector3(-10, 5, 10)
        ];

        positions.forEach((pos, i) => {
            const light = new THREE.PointLight(colors[i], 0.5, 20);
            light.position.copy(pos);
            this.scene.add(light);
        });
    }

    createObstacles() {
        // Create some boxes as obstacles
        const boxGeometry = new THREE.BoxGeometry(2, 4, 2);
        const boxMaterial = new THREE.MeshPhongMaterial({ 
            color: 0x808080,
            specular: 0x111111,
            shininess: 30
        });

        const positions = [
            [-10, 2, -10],
            [10, 2, 10],
            [-10, 2, 10],
            [10, 2, -10],
            [0, 2, -15],
            [15, 2, 0],
            [-15, 2, 0]
        ];

        positions.forEach(([x, y, z]) => {
            const box = new THREE.Mesh(boxGeometry, boxMaterial);
            box.position.set(x, y, z);
            box.castShadow = true;
            box.receiveShadow = true;
            this.scene.add(box);
        });
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    onKeyDown(event) {
        switch (event.code) {
            case 'KeyW': this.moveForward = true; break;
            case 'KeyS': this.moveBackward = true; break;
            case 'KeyA': this.moveLeft = true; break;
            case 'KeyD': this.moveRight = true; break;
            case 'Space': 
                if (!this.spacebarPressed && this.isGrounded && this.canJump) {
                    this.isJumping = true;
                    this.isGrounded = false;
                    this.jumpStartTime = Date.now();
                }
                this.spacebarPressed = true;
                break;
        }
    }

    onKeyUp(event) {
        switch (event.code) {
            case 'KeyW': this.moveForward = false; break;
            case 'KeyS': this.moveBackward = false; break;
            case 'KeyA': this.moveLeft = false; break;
            case 'KeyD': this.moveRight = false; break;
            case 'Space':
                this.isJumping = false;
                this.spacebarPressed = false;
                break;
        }
    }

    setupWebSocket() {
        this.ws = new WebSocket(`ws://${window.location.hostname}:${window.location.port}`);

        this.ws.onopen = () => {
            console.log('WebSocket connected');
            // If there's a pending game to join, join it now
            if (this.pendingGameId !== null) {
                this.sendJoinRequest(this.pendingGameId);
                this.pendingGameId = null;
            }
        };

        this.ws.onclose = () => {
            console.log('WebSocket disconnected');
            // Attempt to reconnect after a delay
            setTimeout(() => this.setupWebSocket(), 1000);
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };

        this.ws.onmessage = (event) => {
            const message = JSON.parse(event.data);
            
            switch(message.type) {
                case 'gameCreated':
                    this.gameId = message.gameId;
                    this.playerId = message.playerId;
                    this.playerColor = message.color;
                    this.isHost = message.isHost;
                    
                    // Show game ID
                    this.gameIdDisplay.textContent = `Game ID: ${this.gameId}`;
                    this.gameIdDisplay.style.display = 'block';
                    
                    // Show start button only for host
                    if (this.isHost) {
                        this.startButton.style.display = 'block';
                    }

                    // Update character color
                    if (this.character && this.character.material) {
                        this.character.material.color.setHex(this.playerColor);
                    }
                    break;

                case 'gameJoined':
                    this.gameId = message.gameId;
                    this.playerId = message.playerId;
                    this.playerColor = message.color;
                    
                    // Show game ID
                    this.gameIdDisplay.textContent = `Game ID: ${this.gameId}`;
                    this.gameIdDisplay.style.display = 'block';

                    // Update character color
                    if (this.character && this.character.material) {
                        this.character.material.color.setHex(this.playerColor);
                    }
                    
                    // Create other players
                    message.players.forEach(player => {
                        this.createOtherPlayer(player.id, player.position, player.color);
                    });
                    break;

                case 'gameStarted':
                    this.gameStarted = true;
                    break;

                case 'gameState':
                    if (message.gameStarted !== undefined) {
                        this.gameStarted = message.gameStarted;
                    }
                    // Update other players
                    message.players.forEach(player => {
                        if (player.id !== this.playerId) {
                            const existingPlayer = this.otherPlayers.get(player.id);
                            if (existingPlayer) {
                                existingPlayer.mesh.position.set(
                                    player.position.x,
                                    player.position.y,
                                    player.position.z
                                );
                            } else {
                                this.createOtherPlayer(player.id, player.position, player.color);
                            }
                        }
                    });
                    break;

                case 'playerJoined':
                    this.createOtherPlayer(message.playerId, message.position, message.color);
                    break;

                case 'playerLeft':
                    this.removeOtherPlayer(message.playerId);
                    break;

                case 'playerMoved':
                    this.updateOtherPlayer(message.playerId, message.position);
                    break;

                case 'playerShot':
                    this.handleOtherPlayerShot(message.playerId, message.position, message.direction, message.color);
                    break;
            }
        };
    }

    joinGame(gameId) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.sendJoinRequest(gameId);
        } else {
            // Store the game ID and wait for connection
            this.pendingGameId = gameId;
            // Setup WebSocket if it doesn't exist or is closed
            if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
                this.setupWebSocket();
            }
        }
    }

    sendJoinRequest(gameId) {
        this.ws.send(JSON.stringify({
            type: 'join',
            gameId: gameId,
            position: this.character ? {
                x: this.character.position.x,
                y: this.character.position.y,
                z: this.character.position.z
            } : { x: 0, y: 0, z: 0 }
        }));

        // Hide join prompt
        this.joinPrompt.style.display = 'none';
    }

    hostGame() {
        this.setupWebSocket();
        this.menu.style.display = 'none';
        
        this.ws.onopen = () => {
            this.ws.send(JSON.stringify({
                type: 'host',
                position: {
                    x: this.character.position.x,
                    y: this.character.position.y,
                    z: this.character.position.z
                }
            }));
        };
    }

    createOtherPlayer(playerId, position, color) {
        const geometry = new THREE.BoxGeometry(0.5, 1, 0.5);
        const material = new THREE.MeshPhongMaterial({ color: color || 0xff0000 });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(position.x, position.y, position.z);
        this.scene.add(mesh);
        this.otherPlayers.set(playerId, { mesh });
    }

    removeOtherPlayer(playerId) {
        const playerData = this.otherPlayers.get(playerId);
        if (playerData) {
            this.scene.remove(playerData.mesh);
            this.otherPlayers.delete(playerId);
        }
    }

    updateOtherPlayer(playerId, position) {
        const playerData = this.otherPlayers.get(playerId);
        if (playerData) {
            playerData.mesh.position.set(position.x, position.y, position.z);
        }
    }

    handleOtherPlayerShot(playerId, position, direction, color) {
        // Ensure position and direction are valid
        if (!position || !direction) {
            console.error('Invalid position or direction in handleOtherPlayerShot');
            return;
        }

        const bulletGeometry = new THREE.SphereGeometry(0.2);
        const bulletMaterial = new THREE.MeshPhongMaterial({ color: color || 0xff0000 });
        const bullet = new THREE.Mesh(bulletGeometry, bulletMaterial);
        
        // Set position and direction using the provided vectors
        bullet.position.set(
            position.x || 0,
            position.y || 0,
            position.z || 0
        );
        
        const bulletDirection = new THREE.Vector3(
            direction.x || 0,
            direction.y || 0,
            direction.z || 0
        );
        
        bullet.velocity = bulletDirection.multiplyScalar(0.8);
        bullet.alive = true;
        
        this.bullets.push(bullet);
        this.scene.add(bullet);
        
        setTimeout(() => {
            bullet.alive = false;
            this.scene.remove(bullet);
            const index = this.bullets.indexOf(bullet);
            if (index > -1) {
                this.bullets.splice(index, 1);
            }
        }, 2000);
    }

    updateBullets() {
        for (let bullet of this.bullets) {
            if (bullet.alive) {
                // Update bullet position
                bullet.position.add(bullet.velocity);
            }
        }
    }

    updateCharacter() {
        const speed = 0.1;
        const direction = new THREE.Vector3();

        if (this.moveForward) {
            direction.z -= speed;
        }
        if (this.moveBackward) {
            direction.z += speed;
        }
        if (this.moveLeft) {
            direction.x -= speed;
        }
        if (this.moveRight) {
            direction.x += speed;
        }

        // Apply movement relative to character's rotation
        direction.applyQuaternion(this.character.quaternion);
        this.character.position.add(direction);

        // Handle jumping
        if (this.isJumping) {
            const jumpDuration = Date.now() - this.jumpStartTime;
            if (jumpDuration < this.maxJumpTime) {
                this.velocity.y += this.jumpForce;
            } else {
                this.isJumping = false;
            }
        }

        // Apply gravity
        if (!this.isJumping) {
            this.velocity.y += this.gravity;
        }

        // Apply vertical movement
        this.character.position.y += this.velocity.y;

        // Ground collision check
        if (this.character.position.y < 0.75) {
            this.character.position.y = 0.75;
            this.velocity.y = 0;
            this.isGrounded = true;
            this.isJumping = false;
        }

        // Calculate camera position
        const idealOffset = new THREE.Vector3(
            0,
            this.cameraHeight,
            this.cameraDistance
        );
        
        // First rotate around Y axis (left/right)
        idealOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.cameraYaw);
        
        // Then rotate for pitch (up/down) around the rotated X axis
        const rightVector = new THREE.Vector3(
            Math.sin(this.cameraYaw + Math.PI / 2),
            0,
            Math.cos(this.cameraYaw + Math.PI / 2)
        );
        idealOffset.applyAxisAngle(rightVector, this.cameraPitch);
        
        // Add to character position
        idealOffset.add(this.character.position);
        this.camera.position.copy(idealOffset);

        // Calculate crosshair look position
        const lookAtPos = this.character.position.clone();
        lookAtPos.y += this.cameraHeight;
        
        // Calculate forward and right vectors for crosshair position
        const forward = new THREE.Vector3(0, 0, -4);
        forward.applyQuaternion(this.character.quaternion);
        
        const right = new THREE.Vector3(0.12, 0, 0); 
        right.applyQuaternion(this.character.quaternion);
        
        // Add both vectors to move crosshair forward and right
        lookAtPos.add(forward).add(right);
        
        // Make camera look at crosshair position
        this.camera.lookAt(lookAtPos);

        // Send position update to server
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: 'update',
                position: {
                    x: this.character.position.x,
                    y: this.character.position.y,
                    z: this.character.position.z
                }
            }));
        }
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        
        if (this.character && this.gameStarted) {
            // Apply automatic forward movement only after game has started
            this.character.position.z -= this.autoMoveSpeed;
            this.camera.position.z = this.character.position.z - this.cameraDistance;
            
            // Update procedural world generation
            this.updateWorld();
            
            // Handle side movement
            if (this.moveLeft) {
                this.character.position.x -= this.autoMoveSpeed;
            }
            if (this.moveRight) {
                this.character.position.x += this.autoMoveSpeed;
            }
            
            // Update camera position
            const cameraOffset = new THREE.Vector3(
                0,
                this.cameraHeight,
                this.cameraDistance
            );
            
            // First rotate around Y axis (left/right)
            cameraOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.cameraYaw);
            
            // Then rotate for pitch (up/down) around the rotated X axis
            const rightVector = new THREE.Vector3(
                Math.sin(this.cameraYaw + Math.PI / 2),
                0,
                Math.cos(this.cameraYaw + Math.PI / 2)
            );
            cameraOffset.applyAxisAngle(rightVector, this.cameraPitch);
            
            // Add to character position
            cameraOffset.add(this.character.position);
            this.camera.position.copy(cameraOffset);

            // Calculate crosshair look position
            const lookAtPos = this.character.position.clone();
            lookAtPos.y += this.cameraHeight;
            
            // Calculate forward and right vectors for crosshair position
            const forward = new THREE.Vector3(0, 0, -4);
            forward.applyQuaternion(this.character.quaternion);
            
            const right = new THREE.Vector3(0.12, 0, 0); 
            right.applyQuaternion(this.character.quaternion);
            
            // Add both vectors to move crosshair forward and right
            lookAtPos.add(forward).add(right);
            
            // Make camera look at crosshair position
            this.camera.lookAt(lookAtPos);

            // Send position update to server
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({
                    type: 'update',
                    position: {
                        x: this.character.position.x,
                        y: this.character.position.y,
                        z: this.character.position.z
                    }
                }));
            }
        }
        
        this.updateCrosshair();
        this.updateCharacter();
        this.updateBullets();
        this.renderer.render(this.scene, this.camera);
    }
}

// Initialize game
const game = new Game();
