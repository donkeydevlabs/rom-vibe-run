const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const startScreen = document.getElementById('start-screen');
const audio1 = document.getElementById('audio1');
const audio2 = document.getElementById('audio2');

let gameRunning = false;
let cameraY = 0;
// Reduced gravity and terminal velocity for slower fall
const GRAVITY = 0.2; 
const TERMINAL_VELOCITY = 8;
const GAME_DURATION = 90000; // 1 minute 30 seconds

let startTime = 0;

// Resize canvas
function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

class Player {
    constructor(name, x, color) {
        this.name = name;
        this.x = x;
        this.y = 0;
        this.radius = 20;
        this.color = color;
        this.vx = 0;
        this.vy = 0;
        this.mass = 1;
        this.friction = 0.98; // Air resistance/friction
        this.stuckTime = 0; // Time spent stuck on an obstacle
        this.currentObstacle = null; // Obstacle currently colliding with
    }

    update() {
        this.vy += GRAVITY;
        if (this.vy > TERMINAL_VELOCITY) this.vy = TERMINAL_VELOCITY;
        
        this.x += this.vx;
        this.y += this.vy;
        
        // Apply friction to horizontal movement
        this.vx *= this.friction;

        // Wall collisions
        if (this.x - this.radius < 0) {
            this.x = this.radius;
            this.vx *= -0.5;
        }
        if (this.x + this.radius > canvas.width) {
            this.x = canvas.width - this.radius;
            this.vx *= -0.5;
        }
    }

    draw(ctx) {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.fill();
        ctx.closePath();

        // Name
        ctx.fillStyle = 'white';
        ctx.font = '12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(this.name, this.x, this.y - this.radius - 5);
    }
}

class Obstacle {
    constructor(y) {
        this.width = Math.random() * 300 + 100; // Wider obstacles
        this.height = 30;
        this.x = Math.random() * (canvas.width - this.width);
        
        // Ensure gaps are passable (Player diameter is 40, so use 60 for safety)
        const minGap = 60;
        
        // If gap on left is too small, snap to 0
        if (this.x < minGap) this.x = 0;
        
        // If gap on right is too small, snap to right edge
        if (canvas.width - (this.x + this.width) < minGap) {
            this.x = canvas.width - this.width;
        }

        this.y = y;
        this.color = '#555';
        // Random angle between -30 and 30 degrees (in radians)
        // Ensure it's not too flat so they slide, but not too steep
        this.angle = (Math.random() * 60 - 30) * (Math.PI / 180); 
    }

    draw(ctx) {
        ctx.save();
        ctx.translate(this.x + this.width / 2, this.y + this.height / 2);
        ctx.rotate(this.angle);
        ctx.fillStyle = this.color;
        ctx.fillRect(-this.width / 2, -this.height / 2, this.width, this.height);
        ctx.restore();
    }
}

let player1, player2;
let obstacles = [];
let lastObstacleY = 200;

function initGame() {
    const p1Color = `hsl(${Math.random() * 360}, 70%, 50%)`;
    const p2Color = `hsl(${Math.random() * 360}, 70%, 50%)`;
    
    player1 = new Player('Romim', canvas.width / 3, p1Color);
    player2 = new Player('Player2', (canvas.width / 3) * 2, p2Color);
    
    obstacles = [];
    lastObstacleY = 200;
    cameraY = 0;
    startTime = Date.now();
    
    // Generate initial obstacles
    for (let i = 0; i < 50; i++) {
        generateObstacle();
    }
    
    gameRunning = true;
    startScreen.style.display = 'none';
    
    // Start audio (muted initially or volume managed in loop)
    audio1.volume = 0;
    audio2.volume = 0;
    audio1.play().catch(e => console.log("Audio play failed", e));
    audio2.play().catch(e => console.log("Audio play failed", e));
    
    loop();
}

function generateObstacle() {
    lastObstacleY += Math.random() * 200 + 150; // Spacing
    obstacles.push(new Obstacle(lastObstacleY));
}

function checkCollision(player, obstacle) {
    // 1. Rotate player position into obstacle's local space
    const cx = obstacle.x + obstacle.width / 2;
    const cy = obstacle.y + obstacle.height / 2;
    
    const dx = player.x - cx;
    const dy = player.y - cy;
    
    const localX = dx * Math.cos(-obstacle.angle) - dy * Math.sin(-obstacle.angle);
    const localY = dx * Math.sin(-obstacle.angle) + dy * Math.cos(-obstacle.angle);
    
    // 2. AABB check in local space
    // Obstacle local bounds: [-w/2, -h/2] to [w/2, h/2]
    const halfW = obstacle.width / 2;
    const halfH = obstacle.height / 2;
    
    // Closest point on rectangle to circle center
    let closestX = localX;
    let closestY = localY;
    
    if (closestX < -halfW) closestX = -halfW;
    else if (closestX > halfW) closestX = halfW;
    
    if (closestY < -halfH) closestY = -halfH;
    else if (closestY > halfH) closestY = halfH;
    
    const distX = localX - closestX;
    const distY = localY - closestY;
    const distanceSquared = distX * distX + distY * distY;
    
    if (distanceSquared < player.radius * player.radius) {
        // Collision detected
        const distance = Math.sqrt(distanceSquared);
        
        // Normal in local space
        let nx = distX / distance;
        let ny = distY / distance;
        
        if (distance === 0) {
            // Center is inside rectangle, push out along shortest axis
            // For simplicity, let's just push up (local Y)
            nx = 0;
            ny = -1;
        }
        
        // Rotate normal back to world space
        const worldNx = nx * Math.cos(obstacle.angle) - ny * Math.sin(obstacle.angle);
        const worldNy = nx * Math.sin(obstacle.angle) + ny * Math.cos(obstacle.angle);
        
        // Push player out
        const overlap = player.radius - distance;
        player.x += worldNx * overlap;
        player.y += worldNy * overlap;
        
        // Reflect velocity (bounce) or Slide
        // v' = v - (1 + restitution) * (v . n) * n
        // For sliding, we want to kill the velocity along the normal, but keep tangential
        // And maybe add a bit of bounce
        
        const dot = player.vx * worldNx + player.vy * worldNy;
        
        // Slide logic: remove normal component of velocity
        player.vx -= dot * worldNx;
        player.vy -= dot * worldNy;
        
        // Boost tangential velocity to slide faster (overcome obstacle)
        // Tangent vector pointing down
        let tx = -worldNy;
        let ty = worldNx;
        if (ty < 0) {
            tx = -tx;
            ty = -ty;
        }
        
        const boost = 0.2; // Reduced boost further
        player.vx += tx * boost;
        player.vy += ty * boost;
        
        // Mark player as colliding with this obstacle
        player.currentObstacle = obstacle;

        return true;
    }
    return false;
}

function updateAudio() {
    if (player1.y > player2.y) {
        // Player 1 is leading (y is positive downwards)
        audio1.volume = 1;
        audio2.volume = 0;
    } else {
        // Player 2 is leading
        audio1.volume = 0;
        audio2.volume = 1;
    }
}

function loop() {
    if (!gameRunning) return;

    // Clear
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Reset collision state
    player1.currentObstacle = null;
    player2.currentObstacle = null;

    // Update Players
    player1.update();
    player2.update();

    // Camera Logic
    // Follow the one with highest Y (lowest on screen visually if we didn't translate, but Y increases down)
    // So "leading" means highest Y value.
    const leaderY = Math.max(player1.y, player2.y);
    const targetCameraY = leaderY - canvas.height / 3; // Keep leader at 1/3 from top
    cameraY = targetCameraY; // Direct follow, can add lerp for smoothness

    // Update Obstacles & Collisions
    obstacles.forEach(obs => {
        checkCollision(player1, obs);
        checkCollision(player2, obs);
    });

    // Enforce boundaries after collisions
    [player1, player2].forEach(p => {
        if (p.x - p.radius < 0) {
            p.x = p.radius;
            p.vx = 0; // Stop horizontal movement if hitting wall
        }
        if (p.x + p.radius > canvas.width) {
            p.x = canvas.width - p.radius;
            p.vx = 0;
        }

        // Check if stuck
        // If speed is very low and colliding with an obstacle
        const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
        if (p.currentObstacle && speed < 0.5) {
            p.stuckTime += 16; // Approx 1 frame at 60fps
            if (p.stuckTime > 1000) {
                // Remove the obstacle
                const index = obstacles.indexOf(p.currentObstacle);
                if (index > -1) {
                    obstacles.splice(index, 1);
                }
                p.stuckTime = 0;
            }
        } else {
            p.stuckTime = 0;
        }
    });

    // Player vs Player Collision
    checkPlayerCollision(player1, player2);

    // Generate more obstacles if needed
    if (lastObstacleY < cameraY + canvas.height * 2) {
        generateObstacle();
    }


    // Draw World
    ctx.save();
    ctx.translate(0, -cameraY);

    obstacles.forEach(obs => {
        // Optimization: only draw if on screen
        if (obs.y + obs.height + 100 > cameraY && obs.y - 100 < cameraY + canvas.height) {
            obs.draw(ctx);
        }
    });

    player1.draw(ctx);
    player2.draw(ctx);

    ctx.restore();

    // Audio
    updateAudio();

    // Check End Condition (Time based)
    if (Date.now() - startTime > GAME_DURATION) {
        // End Game
        gameRunning = false;
        startScreen.style.display = 'block';
        startScreen.innerHTML = `<h1>Fim de Jogo!</h1><p>${player1.y > player2.y ? player1.name : player2.name} Venceu!</p><p>Clique para reiniciar</p>`;
        audio1.pause();
        audio2.pause();
        audio1.currentTime = 0;
        audio2.currentTime = 0;
    } else {
        requestAnimationFrame(loop);
    }
}



function checkPlayerCollision(p1, p2) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const minDistance = p1.radius + p2.radius;

    if (distance < minDistance) {
        // Collision detected
        
        // 1. Resolve Overlap (Positional Correction)
        // Push them apart along the collision normal
        const overlap = minDistance - distance;
        const nx = dx / distance;
        const ny = dy / distance;
        
        // Move each player half the overlap distance away from each other
        const separationX = nx * overlap * 0.5;
        const separationY = ny * overlap * 0.5;
        
        p1.x -= separationX;
        p1.y -= separationY;
        p2.x += separationX;
        p2.y += separationY;
        
        // 2. Resolve Velocity (Elastic Collision)
        // Relative velocity
        const dvx = p2.vx - p1.vx;
        const dvy = p2.vy - p1.vy;
        
        // Velocity along normal
        const velAlongNormal = dvx * nx + dvy * ny;
        
        // Do not resolve if velocities are separating
        if (velAlongNormal > 0) return;
        
        // Restitution (bounciness)
        const restitution = 0.8;
        
        // Impulse scalar
        let j = -(1 + restitution) * velAlongNormal;
        j /= (1 / p1.mass + 1 / p2.mass);
        
        // Apply impulse
        const impulseX = j * nx;
        const impulseY = j * ny;
        
        p1.vx -= impulseX / p1.mass;
        p1.vy -= impulseY / p1.mass;
        p2.vx += impulseX / p2.mass;
        p2.vy += impulseY / p2.mass;
    }
}


startScreen.addEventListener('click', () => {
    initGame();
});
