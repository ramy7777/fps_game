import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

class Game {
    constructor() {
        // Initialize properties
        this.bullets = [];
        this.otherPlayers = new Map();
        this.healthBars = new Map();

        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        document.body.appendChild(this.renderer.domElement);

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
        this.moveForward = false;
        this.moveBackward = false;
        this.moveLeft = false;
        this.moveRight = false;
        this.canShoot = true;

        // Multiplayer properties
        this.ws = null;
        this.playerId = null;
        this.gameId = null;
        this.playerColor = null;

        // UI Elements
        this.menu = document.getElementById('menu');
        this.joinPrompt = document.getElementById('joinPrompt');
        this.gameIdDisplay = document.getElementById('gameId');
        
        // Show menu on start
        this.menu.style.display = 'block';

        // Bind event listeners
        document.getElementById('hostButton').addEventListener('click', () => this.hostGame());
        document.getElementById('joinButton').addEventListener('click', () => {
            this.menu.style.display = 'none';
            this.joinPrompt.style.display = 'block';
        });
        document.getElementById('confirmJoin').addEventListener('click', () => {
            const gameId = parseInt(document.getElementById('gameIdInput').value);
            this.joinGame(gameId);
        });

        // Animation
        this.animate();

        // Event listeners
        window.addEventListener('resize', () => this.onWindowResize(), false);
        document.addEventListener('keydown', (event) => this.onKeyDown(event));
        document.addEventListener('keyup', (event) => this.onKeyUp(event));
        document.addEventListener('mousemove', (event) => this.onMouseMove(event));
        document.addEventListener('mousedown', (event) => this.onMouseDown(event));

        // Request pointer lock on click
        this.renderer.domElement.addEventListener('click', () => {
            this.renderer.domElement.requestPointerLock();
        });

        // Add health bar styles
        const style = document.createElement('style');
        style.textContent = `
            .health-bar-container {
                position: fixed;
                width: 100px;
                height: 10px;
                background-color: #ff0000;
                border: 2px solid #000;
                pointer-events: none;
            }
            .health-bar {
                width: 100%;
                height: 100%;
                background-color: #00ff00;
                transition: width 0.3s ease;
            }
        `;
        document.head.appendChild(style);

        // Create crosshair
        this.createCrosshair();
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
        if (!this.canShoot || !this.character) return;
        
        // Create smaller bullet for better precision
        const bulletGeometry = new THREE.SphereGeometry(0.05);
        const bulletMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
        const bullet = new THREE.Mesh(bulletGeometry, bulletMaterial);
        
        // Get the camera's position and direction
        const cameraDirection = new THREE.Vector3(0, 0, -1);
        cameraDirection.applyQuaternion(this.camera.quaternion);
        
        // Set bullet starting position slightly in front of the camera
        bullet.position.copy(this.camera.position).add(cameraDirection.multiplyScalar(1));
        
        // Calculate bullet direction
        const direction = new THREE.Vector3();
        direction.copy(cameraDirection).normalize();
        
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
                position: bullet.position.toArray(),
                velocity: bullet.velocity.toArray(),
                gameId: this.gameId
            }));
        }
        
        // Add cooldown
        this.canShoot = false;
        setTimeout(() => {
            this.canShoot = true;
        }, 250);
    }

    setupEnvironment() {
        // Skybox
        const skyboxGeometry = new THREE.BoxGeometry(1000, 1000, 1000);
        const skyboxMaterials = [
            new THREE.MeshBasicMaterial({ color: 0x87CEEB, side: THREE.BackSide }), // right
            new THREE.MeshBasicMaterial({ color: 0x87CEEB, side: THREE.BackSide }), // left
            new THREE.MeshBasicMaterial({ color: 0x4169E1, side: THREE.BackSide }), // top
            new THREE.MeshBasicMaterial({ color: 0x87CEEB, side: THREE.BackSide }), // bottom
            new THREE.MeshBasicMaterial({ color: 0x87CEEB, side: THREE.BackSide }), // front
            new THREE.MeshBasicMaterial({ color: 0x87CEEB, side: THREE.BackSide })  // back
        ];
        const skybox = new THREE.Mesh(skyboxGeometry, skyboxMaterials);
        this.scene.add(skybox);

        // Ground
        const groundTexture = this.textureLoader.load('https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/terrain/grasslight-big.jpg');
        groundTexture.wrapS = groundTexture.wrapT = THREE.RepeatWrapping;
        groundTexture.repeat.set(25, 25);
        groundTexture.colorSpace = THREE.SRGBColorSpace;

        const groundGeometry = new THREE.PlaneGeometry(100, 100);
        const groundMaterial = new THREE.MeshStandardMaterial({ 
            map: groundTexture,
            roughness: 0.8,
            metalness: 0.2
        });
        const ground = new THREE.Mesh(groundGeometry, groundMaterial);
        ground.rotation.x = -Math.PI / 2;
        ground.receiveShadow = true;
        this.scene.add(ground);
    }

    createCharacter() {
        // Character body
        const bodyGeometry = new THREE.BoxGeometry(1, 1.5, 1);
        const bodyMaterial = new THREE.MeshPhongMaterial({ 
            color: 0x3366ff,
            specular: 0x111111,
            shininess: 30
        });
        this.character = new THREE.Mesh(bodyGeometry, bodyMaterial);
        this.character.position.y = 0.75;
        this.character.castShadow = true;
        this.character.receiveShadow = true;

        // Add gun model
        const gunGeometry = new THREE.BoxGeometry(0.1, 0.1, 0.4);
        const gunMaterial = new THREE.MeshPhongMaterial({ color: 0x222222 });
        const gun = new THREE.Mesh(gunGeometry, gunMaterial);
        gun.position.set(0.3, 0.2, -0.3);
        this.character.add(gun);

        this.scene.add(this.character);
        
        // Create health bar for local player
        this.createHealthBar(this.playerId, 100);
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
        this.ws = new WebSocket(`ws://${window.location.host}`);
        this.reconnectAttempts = 0;

        this.ws.onopen = () => {
            console.log('WebSocket connected');
            this.reconnectAttempts = 0;
            // Start heartbeat
            this.pingInterval = setInterval(() => {
                if (this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send(JSON.stringify({ type: 'ping' }));
                }
            }, 25000);
        };

        this.ws.onclose = (event) => {
            console.log(`WebSocket closed: ${event.code} ${event.reason}`);
            clearInterval(this.pingInterval);
            this.handleReconnection();
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };

        this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            
            switch(data.type) {
                case 'gameCreated':
                    this.gameId = data.gameId;
                    this.playerId = data.playerId;
                    this.playerColor = data.color;
                    // Update character color
                    if (this.character && this.character.material) {
                        this.character.material.color.setHex(this.playerColor);
                    }
                    this.gameIdDisplay.textContent = `Game ID: ${this.gameId}`;
                    this.gameIdDisplay.style.display = 'block';
                    break;

                case 'gameJoined':
                    this.gameId = data.gameId;
                    this.playerId = data.playerId;
                    this.playerColor = data.color;
                    // Update character color
                    if (this.character && this.character.material) {
                        this.character.material.color.setHex(this.playerColor);
                    }
                    
                    // Clear any existing players first
                    Array.from(this.otherPlayers.keys()).forEach(id => {
                        this.removeOtherPlayer(id);
                    });
                    
                    // Create other players with their correct colors
                    data.players.forEach(player => {
                        this.createOtherPlayer(player.id, player.position, player.color);
                    });
                    break;

                case 'gameState':
                    // Update all player states including colors
                    data.players.forEach(player => {
                        if (player.id !== this.playerId) {
                            const existingPlayer = this.otherPlayers.get(player.id);
                            if (existingPlayer) {
                                existingPlayer.mesh.position.set(player.position.x, player.position.y, player.position.z);
                                existingPlayer.mesh.material.color.setHex(player.color);
                            } else {
                                this.createOtherPlayer(player.id, player.position, player.color);
                            }
                        }
                    });
                    break;

                case 'playerJoined':
                    this.createOtherPlayer(data.playerId, data.position, data.color);
                    break;

                case 'playerLeft':
                    this.removeOtherPlayer(data.playerId);
                    break;

                case 'playerMoved':
                    this.updateOtherPlayer(data.playerId, data.position);
                    break;

                case 'playerShot':
                    this.handleOtherPlayerShot(data.playerId, data.position, data.direction, data.color);
                    break;

                case 'playerEliminated':
                    if (data.playerId === this.playerId) {
                        this.showDeathScreen();
                        this.canShoot = false;
                        this.character.material.transparent = true;
                        this.character.material.opacity = 0.5;
                    } else {
                        const player = this.otherPlayers.get(data.playerId);
                        if (player) {
                            player.mesh.material.transparent = true;
                            player.mesh.material.opacity = 0.3;
                        }
                    }
                    break;
                case 'shoot':
                    this.handleShoot(data);
                    break;
                case 'position':
                    this.handlePositionUpdate(data);
                    break;
                case 'hit':
                    this.handleHit(data);
                    break;
            }
        };
    }

    handleReconnection() {
        if (this.reconnectAttempts < 5) {
            const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
            console.log(`Reconnecting in ${delay}ms...`);
            setTimeout(() => {
                this.reconnectAttempts++;
                this.setupWebSocket();
            }, delay);
        }
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

    joinGame(gameId) {
        this.setupWebSocket();
        this.joinPrompt.style.display = 'none';
        
        this.ws.onopen = () => {
            this.ws.send(JSON.stringify({
                type: 'join',
                gameId: gameId,
                position: {
                    x: this.character.position.x,
                    y: this.character.position.y,
                    z: this.character.position.z
                }
            }));
        };
    }

    createOtherPlayer(playerId, position, color) {
        // Remove any existing player with this ID first
        this.removeOtherPlayer(playerId);
        
        const geometry = new THREE.BoxGeometry(1, 2, 1);
        const material = new THREE.MeshPhongMaterial({ 
            color: color || 0xff0000,
            shininess: 30
        });
        const player = new THREE.Mesh(geometry, material);
        
        player.position.set(position.x, position.y, position.z);
        this.scene.add(player);
        this.otherPlayers.set(playerId, {
            mesh: player,
            color: color
        });
        
        // Create health bar for other player
        this.createHealthBar(playerId, 100);
    }

    removeOtherPlayer(playerId) {
        // Remove health bar
        this.removeHealthBar(playerId);
        
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
        const bulletGeometry = new THREE.SphereGeometry(0.2);
        const bulletMaterial = new THREE.MeshPhongMaterial({ 
            color: color || 0xff0000,
            shininess: 30
        });
        const bullet = new THREE.Mesh(bulletGeometry, bulletMaterial);
        
        bullet.position.set(position.x, position.y, position.z);
        bullet.velocity = new THREE.Vector3(direction.x, direction.y, direction.z);
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
        
        for (let id of this.otherPlayers.keys()) {
            const player = this.otherPlayers.get(id).mesh;
            const distance = player.position.distanceTo(bullet.position);
            if (distance < 1.5) {
                bullet.alive = false;
                this.scene.remove(bullet);
            }
        }
    }

    showDeathScreen() {
        // Implement death screen UI here
    }

    createHealthBar(playerId, initialHealth = 100) {
        const container = document.createElement('div');
        container.className = 'health-bar-container';
        container.id = `health-${playerId}`;
        
        const bar = document.createElement('div');
        bar.className = 'health-bar';
        container.appendChild(bar);
        
        document.body.appendChild(container);
        this.healthBars.set(playerId, container);
        this.updateHealthBar(playerId, initialHealth);
    }

    updateHealthBar(playerId, health) {
        const container = this.healthBars.get(playerId);
        if (container) {
            const bar = container.querySelector('.health-bar');
            bar.style.width = `${Math.max(0, Math.min(100, health))}%`;
        }
    }

    removeHealthBar(playerId) {
        const container = this.healthBars.get(playerId);
        if (container) {
            container.remove();
            this.healthBars.delete(playerId);
        }
    }

    updateHealthBarPositions() {
        // Update position for local player
        if (this.character) {
            const pos = this.character.position.clone();
            pos.y += 2; // Position above player's head
            const screenPosition = pos.project(this.camera);
            
            const container = this.healthBars.get(this.playerId);
            if (container) {
                const x = (screenPosition.x + 1) * window.innerWidth / 2 - 50;
                const y = (-screenPosition.y + 1) * window.innerHeight / 2;
                container.style.transform = `translate(${x}px, ${y}px)`;
            }
        }

        // Update positions for other players
        this.otherPlayers.forEach((playerData, id) => {
            const container = this.healthBars.get(id);
            if (container && playerData.mesh) {
                const pos = playerData.mesh.position.clone();
                pos.y += 2; // Position above player's head
                const screenPosition = pos.project(this.camera);
                
                const x = (screenPosition.x + 1) * window.innerWidth / 2 - 50;
                const y = (-screenPosition.y + 1) * window.innerHeight / 2;
                container.style.transform = `translate(${x}px, ${y}px)`;
            }
        });
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
        const idealOffset = new THREE.Vector3(0, this.cameraHeight, this.cameraDistance);
        
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
        lookAtPos.y += 1.2;
        
        // Calculate forward vector for crosshair position
        const forward = new THREE.Vector3(0, 0, -4);
        forward.applyQuaternion(this.character.quaternion);
        
        // Add forward vector to move crosshair forward
        lookAtPos.add(forward);
        
        // Make camera look at crosshair position
        this.camera.lookAt(lookAtPos);

        // Send position and rotation update to server
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: 'position',
                position: this.character.position,
                rotation: this.character.rotation.y,
                gameId: this.gameId
            }));
        }
    }

    updateBullets() {
        const bulletsToRemove = [];
        for (let i = 0; i < this.bullets.length; i++) {
            const bullet = this.bullets[i];
            if (bullet.alive) {
                // Update bullet position
                bullet.position.add(bullet.velocity);
                
                // Check for collisions with other players
                this.otherPlayers.forEach((playerData, playerId) => {
                    if (this.checkBulletCollision(bullet, playerData.mesh)) {
                        // Just remove the bullet on collision, no damage
                        bulletsToRemove.push(i);
                    }
                });
            }
        }
        bulletsToRemove.forEach(index => {
            const bullet = this.bullets[index];
            bullet.alive = false;
            this.scene.remove(bullet);
            this.bullets.splice(index, 1);
        });
    }

    checkBulletCollision(bullet, player) {
        const distance = player.position.distanceTo(bullet.position);
        return distance < 1.5;
    }

    handlePositionUpdate(data) {
        const playerData = this.otherPlayers.get(data.playerId);
        if (playerData) {
            playerData.mesh.position.copy(data.position);
            if (data.rotation !== undefined) {
                playerData.mesh.rotation.y = data.rotation;
            }
        }
    }

    handleShoot(data) {
        if (data.playerId === this.playerId) return; // Don't create bullet for local player
        
        const bulletGeometry = new THREE.SphereGeometry(0.1);
        const bulletMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
        const bullet = new THREE.Mesh(bulletGeometry, bulletMaterial);
        
        bullet.position.fromArray(data.position);
        bullet.velocity = new THREE.Vector3().fromArray(data.velocity);
        bullet.alive = true;
        bullet.lifeTime = 100;
        
        this.scene.add(bullet);
        this.bullets.push(bullet);
    }

    handleHit(data) {
        if (data.targetId === this.playerId) {
            // Local player was hit
            this.showDeathScreen(data.shooterId);
            // Disable shooting temporarily
            this.canShoot = false;
            setTimeout(() => {
                this.canShoot = true;
            }, 1000); // 1 second cooldown
        } else {
            // Another player was hit
            const playerData = this.otherPlayers.get(data.targetId);
            if (playerData && playerData.mesh) {
                // Flash the hit player red
                const originalColor = playerData.mesh.material.color.clone();
                playerData.mesh.material.color.setHex(0xff0000);
                setTimeout(() => {
                    playerData.mesh.material.color.copy(originalColor);
                }, 100);
            }
        }
    }

    createCrosshair() {
        // Create crosshair geometry
        const crosshairSize = 0.015;
        const crosshairThickness = 0.002;
        
        // Horizontal line
        const horizontalGeometry = new THREE.BoxGeometry(crosshairSize, crosshairThickness, crosshairThickness);
        const crosshairMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
        const horizontalLine = new THREE.Mesh(horizontalGeometry, crosshairMaterial);
        
        // Vertical line
        const verticalGeometry = new THREE.BoxGeometry(crosshairThickness, crosshairSize, crosshairThickness);
        const verticalLine = new THREE.Mesh(verticalGeometry, crosshairMaterial);
        
        // Create crosshair container
        this.crosshair = new THREE.Group();
        this.crosshair.add(horizontalLine);
        this.crosshair.add(verticalLine);
        
        // Add to scene
        this.scene.add(this.crosshair);
    }

    updateCrosshair() {
        if (!this.crosshair) return;
        
        // Position crosshair 3 units in front of camera
        const crosshairDistance = 3;
        const vector = new THREE.Vector3(0, 0, -crosshairDistance);
        vector.applyQuaternion(this.camera.quaternion);
        this.crosshair.position.copy(this.camera.position).add(vector);
        
        // Make crosshair face camera
        this.crosshair.quaternion.copy(this.camera.quaternion);
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        this.updateCharacter();
        this.updateBullets();
        this.updateCrosshair();
        
        // Update health bar positions
        this.updateHealthBarPositions();
        
        this.renderer.render(this.scene, this.camera);
    }
}

// Initialize game
const game = new Game();
document.querySelector('script[type="module"]').__game = game;
