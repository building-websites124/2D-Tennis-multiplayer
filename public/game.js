const socket = io();

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
let pointMessage = null; 
let ballTrail = [];      
const keys = { w: false, a: false, s: false, d: false };

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

socket.on('roomJoined', (data) => {
  myPlayerNum = data.playerNum;
  menu.classList.add('hidden');
  displayCode.innerText = data.roomCode;
  gameRoomCode.innerText = data.roomCode;
  waiting.classList.remove('hidden');

  score1.previousSibling.textContent = myPlayerNum === 1 ? 'Player 1 (You): ' : 'Player 1 (Opponent): ';
  score2.previousSibling.textContent = myPlayerNum === 2 ? 'Player 2 (You): ' : 'Player 2 (Opponent): ';
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

socket.on('gameState', (state) => {
  gameState = state;
  score1.innerText = `Pts: ${state.scores[1]} | Sets: ${state.sets[1]}`;
  score2.innerText = `Pts: ${state.scores[2]} | Sets: ${state.sets[2]}`;

  if (state.state === 'playing') {
    ballTrail.push({ x: state.ball.x, y: state.ball.y });
    if (ballTrail.length > 6) ballTrail.shift();
  } else {
    ballTrail = [];
  }
});

socket.on('pointScored', (data) => {
  pointMessage = `🎾 Point won by Player ${data.scorer}!`;
  setTimeout(() => { pointMessage = null; }, 1900); 
});

socket.on('setComplete', (data) => {
  winnerText.innerText = `🎾 Set Won by Player ${data.setWinner} (${data.finalScores[1]} - ${data.finalScores[2]})!`;
  overlay.classList.remove('hidden');
  if (restartBtn) restartBtn.classList.add('hidden');
  
  score1.innerText = `Pts: 0 | Sets: ${data.sets[1]}`;
  score2.innerText = `Pts: 0 | Sets: ${data.sets[2]}`;
});

socket.on('nextSetStart', (state) => {
  gameState = state;
  overlay.classList.add('hidden');
  requestAnimationFrame(drawGame);
});

socket.on('hitFeedback', (data) => {
  hitEffects.push({ x: data.x, y: data.y, text: data.quality, alpha: 1.0, floatY: 0 });
});

socket.on('opponentLeft', () => {
  alert('Your opponent disconnected! Returning to menu.');
  location.reload();
});

socket.on('errorMsg', (msg) => {
  errorText.innerText = msg;
});

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

  if (myPlayerNum === 2) {
    up = keys.s;
    down = keys.w;
    left = keys.d;
    right = keys.a;
  }

  socket.emit('move', { up, down, left, right });
}

setInterval(() => {
  if (keys.w || keys.a || keys.s || keys.d) sendMove();
}, 1000 / 30);

function drawGame() {
  if (!gameState || gameState.state === 'setover') return;

  // Outer boundary (Dark Green)
  ctx.fillStyle = '#115e59';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Inner Court (US Open Blue)
  ctx.fillStyle = '#1e40af';
  ctx.fillRect(40, 40, canvas.width - 80, canvas.height - 80);

  // Court Lines
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 4;

  // Doubles boundaries
  ctx.strokeRect(40, 40, canvas.width - 80, canvas.height - 80);

  // Singles boundaries
  ctx.beginPath();
  ctx.moveTo(90, 40);
  ctx.lineTo(90, canvas.height - 40);
  ctx.moveTo(canvas.width - 90, 40);
  ctx.lineTo(canvas.width - 90, canvas.height - 40);
  ctx.stroke();

  // Service lines (Horizontal)
  ctx.beginPath();
  ctx.moveTo(90, 190);
  ctx.lineTo(canvas.width - 90, 190);
  ctx.moveTo(90, canvas.height - 190);
  ctx.lineTo(canvas.width - 90, canvas.height - 190);
  ctx.stroke();

  // Center service line (Vertical)
  ctx.beginPath();
  ctx.moveTo(canvas.width / 2, 190);
  ctx.lineTo(canvas.width / 2, canvas.height - 190);
  ctx.stroke();

  // Baseline Center Marks
  ctx.beginPath();
  ctx.moveTo(canvas.width / 2, 40);
  ctx.lineTo(canvas.width / 2, 55);
  ctx.moveTo(canvas.width / 2, canvas.height - 40);
  ctx.lineTo(canvas.width / 2, canvas.height - 55);
  ctx.stroke();

  // The Net
  ctx.strokeStyle = '#d4d4d8';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(15, canvas.height / 2);
  ctx.lineTo(canvas.width - 15, canvas.height / 2);
  ctx.stroke();
  
  // Net Posts
  ctx.fillStyle = '#27272a';
  ctx.beginPath();
  ctx.arc(15, canvas.height / 2, 8, 0, Math.PI * 2);
  ctx.arc(canvas.width - 15, canvas.height / 2, 8, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  if (myPlayerNum === 2) {
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(Math.PI); 
    ctx.translate(-canvas.width / 2, -canvas.height / 2);
  }

  // Draw Players
  for (const id in gameState.players) {
    const p = gameState.players[id];
    
    // Player Body
    ctx.beginPath();
    ctx.arc(p.x, p.y, 25, 0, Math.PI * 2);
    ctx.fillStyle = p.num === 1 ? '#38bdf8' : '#f43f5e';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();

    // Player Racket
    ctx.save();
    ctx.translate(p.x, p.y);
    const swingAngle = p.swinging ? (p.num === 1 ? -0.8 : 0.8) : 0;
    ctx.rotate(swingAngle);
    ctx.fillStyle = '#facc15';
    ctx.fillRect(15, -5, 20, 10); 
    ctx.restore();
  }

  if (gameState.ball.speed > 8 && ballTrail.length > 1) {
    ctx.beginPath();
    ctx.moveTo(ballTrail[0].x, ballTrail[0].y);
    for (let i = 1; i < ballTrail.length; i++) {
      ctx.lineTo(ballTrail[i].x, ballTrail[i].y);
    }
    ctx.lineTo(gameState.ball.x, gameState.ball.y);
    // Dynamic trail color based on spin/speed
    ctx.strokeStyle = gameState.ball.spin !== 0 ? 'rgba(239, 68, 68, 0.5)' : 'rgba(234, 179, 8, 0.4)';
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  // Draw Ball shadow
  const ball = gameState.ball;
  ctx.beginPath();
  ctx.arc(ball.x + 4, ball.y + 4, 8, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.fill();

  // Draw Ball
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, 8, 0, Math.PI * 2);
  ctx.fillStyle = '#eab308';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();

  ctx.restore();

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

  for (let i = hitEffects.length - 1; i >= 0; i--) {
    const fx = hitEffects[i];
    ctx.fillStyle = fx.text.includes("SPIN") ? `rgba(239, 68, 68, ${fx.alpha})` : `rgba(251, 191, 36, ${fx.alpha})`;
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    
    const fxX = myPlayerNum === 2 ? canvas.width - fx.x : fx.x;
    const fxY = myPlayerNum === 2 ? canvas.height - fx.y : fx.y;
    
    ctx.fillText(fx.text, fxX, fxY - 15 - fx.floatY);
    fx.floatY += 1.5; 
    fx.alpha -= 0.025;
    if (fx.alpha <= 0) hitEffects.splice(i, 1);
  }

  if (pointMessage) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(0, canvas.height / 2 - 40, canvas.width, 80);
    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 26px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(pointMessage, canvas.width / 2, canvas.height / 2 + 10);
  }

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