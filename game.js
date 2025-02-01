import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

class Game {
    constructor() {
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
        this.bullets = [];

        // Multiplayer properties
        this.ws = null;
        this.playerId = null;
        this.otherPlayers = new Map();
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
        if (!this.canShoot) return;

        // Create bullet with player's color
        const bulletGeometry = new THREE.SphereGeometry(0.2); 
        const bulletMaterial = new THREE.MeshPhongMaterial({ 
            color: this.playerColor || 0xff0000,
            shininess: 30
        });
        const bullet = new THREE.Mesh(bulletGeometry, bulletMaterial);

        // Set bullet spawn position
        bullet.position.copy(this.character.position);
        bullet.position.y += 0.8;

        // Get character's forward direction for straight trajectory
        const direction = new THREE.Vector3(0, 0, -1);
        direction.applyQuaternion(this.character.quaternion);
        
        // Add the same left offset as crosshair
        const right = new THREE.Vector3(-0.08, 0, 0);
        right.applyQuaternion(this.character.quaternion);
        direction.add(right.multiplyScalar(0.02));
        
        // Set bullet velocity for straight path
        bullet.velocity = direction.normalize().multiplyScalar(1.5);
        bullet.alive = true;
        
        this.bullets.push(bullet);
        this.scene.add(bullet);
        
        // Send shot information to server
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: 'shoot',
                position: {
                    x: bullet.position.x,
                    y: bullet.position.y,
                    z: bullet.position.z
                },
                direction: {
                    x: bullet.velocity.x,
                    y: bullet.velocity.y,
                    z: bullet.velocity.z
                }
            }));
        }
        
        setTimeout(() => {
            bullet.alive = false;
            this.scene.remove(bullet);
            const index = this.bullets.indexOf(bullet);
            if (index > -1) {
                this.bullets.splice(index, 1);
            }
        }, 2000);

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
        groundTexture.encoding = THREE.sRGBEncoding;

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

    connectToServer() {
        this.ws = new WebSocket('ws://localhost:3000');
        
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
            }
        };
    }

    hostGame() {
        this.connectToServer();
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
        this.connectToServer();
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

    updateBullets() {
        for (let bullet of this.bullets) {
            if (bullet.alive) {
                // Update bullet position
                bullet.position.add(bullet.velocity);
            }
        }
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        this.updateCharacter();
        this.updateBullets();
        this.renderer.render(this.scene, this.camera);
    }
}

// Initialize game
const game = new Game();
