const socket = io();

// UI Elements
const menu = document.getElementById('menu');
const waiting = document.getElementById('waiting');
const gameArena = document.getElementById('gameArena');
const createBtn = document.getElementById('createBtn');
const joinBtn = document.getElementById('joinBtn');
const restartBtn = document.getElementById('restartBtn');
const roomInput = document.getElementById('roomInput');
const displayCode = document.getElementById('displayCode');
const gameRoomCode = document.getElementById('gameRoomCode');
const errorText = document.getElementById('errorText');
const score1 = document.getElementById('score1');
const score2 = document.getElementById('score2');
const overlay = document.getElementById('overlay');
const winnerText = document.getElementById('winnerText');

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let myPlayerNum = 0;
let gameState = null;
let hitEffects = [];
const keys = { w: false, a: false, s: false, d: false };

// Button Listeners
createBtn.addEventListener('click', () => {
  errorText.innerText = '';
  socket.emit('createRoom');
});

joinBtn.addEventListener('click', () => {
  const code = roomInput.value.trim();
  if (code.length < 2) {
    errorText.innerText = 'Please enter a valid room code.';
    return;
  }
  errorText.innerText = '';
  socket.emit('joinRoom', code);
});

// Socket Events
socket.on('roomJoined', (data) => {
  myPlayerNum = data.playerNum;
  menu.classList.add('hidden');
  displayCode.innerText = data.roomCode;
  gameRoomCode.innerText = data.roomCode;
  waiting.classList.remove('hidden');
});

socket.on('waitingForOpponent', () => {
  waiting.classList.remove('hidden');
});

socket.on('gameStart', (state) => {
  waiting.classList.add('hidden');
  gameArena.classList.remove('hidden');
  overlay.classList.add('hidden');
  gameState = state;
  requestAnimationFrame(drawGame);
});

// Updated to show Points AND Sets
socket.on('gameState', (state) => {
  gameState = state;
  score1.innerText = `Pts: ${state.scores[1]} | Sets: ${state.sets[1]}`;
  score2.innerText = `Pts: ${state.scores[2]} | Sets: ${state.sets[2]}`;
});

// Handle Set Wins
socket.on('setComplete', (data) => {
  winnerText.innerText = `🎾 Set Won by Player ${data.setWinner} (${data.finalScores[1]} - ${data.finalScores[2]})!`;
  overlay.classList.remove('hidden');
  if (restartBtn) restartBtn.classList.add('hidden'); // Hide button, it autoskips
  
  // Instantly update UI scoreboard to show updated Sets
  score1.innerText = `Pts: 0 | Sets: ${data.sets[1]}`;
  score2.innerText = `Pts: 0 | Sets: ${data.sets[2]}`;
});

// Start next set automatically after 3 seconds
socket.on('nextSetStart', (state) => {
  gameState = state;
  overlay.classList.add('hidden');
  requestAnimationFrame(drawGame);
});

socket.on('hitFeedback', (data) => {
  hitEffects.push({ x: data.x, y: data.y, text: data.quality, alpha: 1.0, floatY: 0 });
});

socket.on('opponentLeft', () => {
  alert('Your friend disconnected! Returning to menu.');
  location.reload();
});

socket.on('errorMsg', (msg) => {
  errorText.innerText = msg;
});

// Input Handling
window.addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase();
  if (key in keys && !keys[key]) {
    keys[key] = true;
    sendMove();
  }
  if (e.code === 'Space') {
    e.preventDefault();
    socket.emit('swing');
  }
});

window.addEventListener('keyup', (e) => {
  const key = e.key.toLowerCase();
  if (key in keys) {
    keys[key] = false;
    sendMove();
  }
});

function sendMove() {
  let up = keys.w;
  let down = keys.s;
  let left = keys.a;
  let right = keys.d;

  // Invert controls for Player 2 so "W" always moves forward towards the net on their screen
  if (myPlayerNum === 2) {
    up = keys.s;
    down = keys.w;
    left = keys.d;
    right = keys.a;
  }

  socket.emit('move', { up, down, left, right });
}

// continuous movement loop sending to server
setInterval(() => {
  if (keys.w || keys.a || keys.s || keys.d) sendMove();
}, 1000 / 30);

// Rendering Loop
function drawGame() {
  if (!gameState || gameState.state === 'setover') return;

  // Clear court
  ctx.fillStyle = '#15803d';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Draw Court Lines
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.lineWidth = 3;
  
  // Outer boundary
  ctx.strokeRect(15, 15, canvas.width - 30, canvas.height - 30);
  
  // Center service line
  ctx.beginPath();
  ctx.moveTo(canvas.width / 2, 15);
  ctx.lineTo(canvas.width / 2, canvas.height - 15);
  ctx.stroke();

  // The Net
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(0, canvas.height / 2);
  ctx.lineTo(canvas.width, canvas.height / 2);
  ctx.stroke();

  // --- APPLY CAMERA FLIP FOR PLAYER 2 ---
  ctx.save();
  if (myPlayerNum === 2) {
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(Math.PI); // Rotate 180 degrees!
    ctx.translate(-canvas.width / 2, -canvas.height / 2);
  }

  // Draw Players
  for (const id in gameState.players) {
    const p = gameState.players[id];
    
    // Player body
    ctx.beginPath();
    ctx.arc(p.x, p.y, 25, 0, Math.PI * 2);
    ctx.fillStyle = p.num === 1 ? '#38bdf8' : '#f43f5e';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();

    // Racket swing animation
    ctx.save();
    ctx.translate(p.x, p.y);
    const swingAngle = p.swinging ? (p.num === 1 ? -0.8 : 0.8) : 0;
    ctx.rotate(swingAngle);
    ctx.fillStyle = '#facc15';
    ctx.fillRect(15, -5, 20, 10); 
    ctx.restore();
  }

  // Draw Ball
  const ball = gameState.ball;
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, 8, 0, Math.PI * 2);
  ctx.fillStyle = '#eab308'; // Bright yellow
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();

  // --- RESTORE ORIENTATION FOR TEXT ---
  // (We restore the canvas so our text doesn't render upside down!)
  ctx.restore();

  // Draw "YOU" Tag (Manually map the coordinates if flipped)
  for (const id in gameState.players) {
    const p = gameState.players[id];
    if (p.num === myPlayerNum) {
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      
      const textX = myPlayerNum === 2 ? canvas.width - p.x : p.x;
      const textY = myPlayerNum === 2 ? canvas.height - p.y : p.y;
      ctx.fillText('YOU', textX, textY - 32);
    }
  }

  // Draw Hit Timing Feedback Popups
  for (let i = hitEffects.length - 1; i >= 0; i--) {
    const fx = hitEffects[i];
    ctx.fillStyle = `rgba(251, 191, 36, ${fx.alpha})`;
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    
    // Map absolute effect coords to visually flipped coords
    const fxX = myPlayerNum === 2 ? canvas.width - fx.x : fx.x;
    const fxY = myPlayerNum === 2 ? canvas.height - fx.y : fx.y;
    
    ctx.fillText(fx.text, fxX, fxY - 15 - fx.floatY);
    fx.floatY += 1; // Makes the text always float visually UP on the screen
    fx.alpha -= 0.02;
    if (fx.alpha <= 0) hitEffects.splice(i, 1);
  }

  // Draw Serve Overlay if waiting for a serve
  if (gameState.state === 'serving') {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(0, canvas.height / 2 - 30, canvas.width, 60);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'center';
    const serveText = gameState.serverTurn === myPlayerNum ? "🎾 YOUR SERVE! Press SPACE to toss" : "Waiting for opponent to serve...";
    ctx.fillText(serveText, canvas.width / 2, canvas.height / 2 + 7);
  }

  requestAnimationFrame(drawGame);
}