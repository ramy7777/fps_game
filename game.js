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

        // Create bullet
        const bulletGeometry = new THREE.SphereGeometry(0.1);
        const bulletMaterial = new THREE.MeshPhongMaterial({ 
            color: 0xff0000,
            shininess: 30
        });
        const bullet = new THREE.Mesh(bulletGeometry, bulletMaterial);

        // Calculate spawn position from character position
        const spawnDistance = 4; // Distance in front of character
        const characterHeadHeight = 1.5; // Height of character's head

        // Get character's forward direction
        const direction = new THREE.Vector3(0, 0, -1);
        direction.applyQuaternion(this.character.quaternion);
        
        // Set bullet position from character
        bullet.position.copy(this.character.position);
        bullet.position.y += characterHeadHeight; // Set to head height
        bullet.position.add(direction.multiplyScalar(spawnDistance));
        
        // Reset direction for velocity
        direction.set(0, 0, -1);
        direction.applyQuaternion(this.character.quaternion);
        
        // Set bullet velocity to go straight forward
        bullet.velocity = direction.normalize().multiplyScalar(1.5);
        
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
        lookAtPos.y += 1.5; // Set to character head height
        const forward = new THREE.Vector3(0, 0, -4);
        forward.applyQuaternion(this.character.quaternion);
        lookAtPos.add(forward);
        
        // Make camera look at crosshair position
        this.camera.lookAt(lookAtPos);
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

// Initialize the game
const game = new Game();
