const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};
const COURT_WIDTH = 500;
const COURT_HEIGHT = 700;
const NET_Y = 350;
const PLAYER_RADIUS = 25;
const BALL_RADIUS = 8;

io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  socket.on('createRoom', () => {
    const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    rooms[roomCode] = {
      players: {},
      ball: { x: COURT_WIDTH / 2, y: NET_Y, vx: 0, vy: 0, speed: 5, inPlay: false },
      scores: { 1: 0, 2: 0 }, // Current game points
      sets: { 1: 0, 2: 0 },   // Total Sets won
      state: 'waiting',       // waiting, serving, playing, setover, gameover
      serverTurn: 1,
      pointsPlayed: 0,
      lastHitBy: null,
      winner: null
    };
    
    joinRoom(socket, roomCode);
  });

  socket.on('joinRoom', (roomCode) => {
    roomCode = roomCode.toUpperCase();
    if (!rooms[roomCode]) {
      socket.emit('errorMsg', 'Room not found! Check the code and try again.');
      return;
    }
    if (Object.keys(rooms[roomCode].players).length >= 2) {
      socket.emit('errorMsg', 'This room is already full!');
      return;
    }
    joinRoom(socket, roomCode);
  });

  function joinRoom(socket, roomCode) {
    const room = rooms[roomCode];
    const playerNum = Object.keys(room.players).length === 0 ? 1 : 2;
    
    room.players[socket.id] = {
      id: socket.id,
      num: playerNum,
      x: COURT_WIDTH / 2,
      y: playerNum === 1 ? COURT_HEIGHT - 60 : 60,
      swinging: false
    };

    socket.join(roomCode);
    socket.roomCode = roomCode;
    socket.emit('roomJoined', { roomCode, playerNum });

    // When both players are in, START THE PHYSICS LOOP!
    if (Object.keys(room.players).length === 2) {
      resetPositionsAndServe(room);
      io.to(roomCode).emit('gameStart', room);
    } else {
      io.to(roomCode).emit('waitingForOpponent');
    }
  }

  socket.on('move', (data) => {
    const room = rooms[socket.roomCode];
    if (!room || room.state !== 'playing') return;
    const player = room.players[socket.id];
    if (!player) return;

    const speed = 6;
    if (data.up) player.y -= speed;
    if (data.down) player.y += speed;
    if (data.left) player.x -= speed;
    if (data.right) player.x += speed;

    // Boundary enforcement (can't cross the net or leave court)
    player.x = Math.max(PLAYER_RADIUS, Math.min(COURT_WIDTH - PLAYER_RADIUS, player.x));
    if (player.num === 1) {
      player.y = Math.max(NET_Y + PLAYER_RADIUS, Math.min(COURT_HEIGHT - PLAYER_RADIUS, player.y));
    } else {
      player.y = Math.max(PLAYER_RADIUS, Math.min(NET_Y - PLAYER_RADIUS, player.y));
    }
  });

  socket.on('swing', () => {
    const room = rooms[socket.roomCode];
    if (!room || (room.state !== 'playing' && room.state !== 'serving')) return;
    const player = room.players[socket.id];
    if (!player) return;

    if (room.state === 'serving') {
      if (player.num === room.serverTurn) {
        room.state = 'playing';
        player.swinging = true;
        setTimeout(() => { if (player) player.swinging = false; }, 150);
        
        const ball = room.ball;
        ball.speed = 9; // Fast serve
        ball.vy = player.num === 1 ? -ball.speed : ball.speed;
        // Angle it cross-court!
        ball.vx = player.x > COURT_WIDTH / 2 ? -3 : 3;
        room.lastHitBy = player.num;
        
        io.to(socket.roomCode).emit('hitFeedback', { x: ball.x, y: ball.y, quality: "Serve!" });
      }
      return; // Skip normal hit physics during the toss phase
    }

    player.swinging = true;
    setTimeout(() => { if (player) player.swinging = false; }, 150);

    // Hit Physics & Distance Calculation (Spandan, this is just simple Euclidean dist!)
    const ball = room.ball;
    const dx = ball.x - player.x;
    const dy = ball.y - player.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Sweet spot logic
    if (dist < 50) {
      const accuracy = 1 - (dist / 50); 
      let speedMultiplier = 6;
      let hitQuality = "Weak";

      if (accuracy > 0.65) {
        speedMultiplier = 11;
        hitQuality = "Perfect!";
      } else if (accuracy > 0.35) {
        speedMultiplier = 8.5;
        hitQuality = "Good";
      }

      ball.speed = speedMultiplier;
      ball.vy = player.num === 1 ? -ball.speed : ball.speed;
      ball.vx = (dx / 25) * (ball.speed * 0.7);
      room.lastHitBy = player.num;

      io.to(socket.roomCode).emit('hitFeedback', { x: ball.x, y: ball.y, quality: hitQuality });
    }
  });

  socket.on('disconnect', () => {
    if (socket.roomCode && rooms[socket.roomCode]) {
      io.to(socket.roomCode).emit('opponentLeft');
      delete rooms[socket.roomCode];
    }
  });
});

function resetPositionsAndServe(room) {
  room.pointsPlayed = room.scores[1] + room.scores[2];
  // Alternate server every point to keep it engaging
  room.serverTurn = (room.pointsPlayed % 2 === 0) ? 1 : 2;
  room.state = 'serving';
  
  room.ball.vx = 0;
  room.ball.vy = 0;
  room.lastHitBy = null;
  
  // Math for Parity: Even total points = Deuce Side (Right). Odd = Ad Side (Left).
  const isDeuceSide = room.pointsPlayed % 2 === 0;
  
  for (const id in room.players) {
    const p = room.players[id];
    if (p.num === 1) {
        p.y = COURT_HEIGHT - 40; // baseline
        p.x = isDeuceSide ? COURT_WIDTH / 2 + 100 : COURT_WIDTH / 2 - 100;
    } else {
        p.y = 40; // baseline
        // From Player 2's perspective, their right is our left
        p.x = isDeuceSide ? COURT_WIDTH / 2 - 100 : COURT_WIDTH / 2 + 100;
    }
  }
}

// 60 FPS Server Physics Loop
setInterval(() => {
  for (const code in rooms) {
    const room = rooms[code];
    if (room.state !== 'playing' && room.state !== 'serving') continue;

    if (room.state === 'serving') {
      // Glue the ball to the serving player's racket
      const serverPlayer = Object.values(room.players).find(p => p.num === room.serverTurn);
      if (serverPlayer) {
        room.ball.x = serverPlayer.x;
        room.ball.y = serverPlayer.num === 1 ? serverPlayer.y - 25 : serverPlayer.y + 25;
      }
      io.to(code).emit('gameState', {
        players: room.players, ball: room.ball, scores: room.scores, sets: room.sets, state: room.state, serverTurn: room.serverTurn
      });
      continue;
    }

    const ball = room.ball;
    ball.x += ball.vx;
    ball.y += ball.vy;

    // Wall bounces
    if (ball.x <= BALL_RADIUS || ball.x >= COURT_WIDTH - BALL_RADIUS) {
      ball.vx *= -1;
    }

    // Scoring conditions
    if (ball.y < 0) {
      room.scores[1]++;
      checkWin(room, code, 1);
    } else if (ball.y > COURT_HEIGHT) {
      room.scores[2]++;
      checkWin(room, code, 2);
    }

    // Broadcast state if still playing
    if (room.state === 'playing') {
      io.to(code).emit('gameState', {
        players: room.players,
        ball: room.ball,
        scores: room.scores,
        sets: room.sets,
        state: room.state,
        serverTurn: room.serverTurn
      });
    }
  }
}, 1000 / 60);

// Updated Tennis Rules: First to 6, win by 2
function checkWin(room, code, scorer) {
  const p1 = room.scores[1];
  const p2 = room.scores[2];

  // Did someone hit 6+ points AND have a 2+ point lead? (e.g. 6-4, 7-5)
  if ((p1 >= 6 || p2 >= 6) && Math.abs(p1 - p2) >= 2) {
    room.sets[scorer]++;       
    room.state = 'setover';
    
    // Broadcast set win
    io.to(code).emit('setComplete', { 
      setWinner: scorer, 
      finalScores: { ...room.scores }, 
      sets: room.sets 
    });

    // Wait 3 seconds, then reset points to 0-0 and start next set
    setTimeout(() => {
      if (rooms[code]) {
        rooms[code].scores = { 1: 0, 2: 0 };
        resetPositionsAndServe(rooms[code]);
        io.to(code).emit('nextSetStart', rooms[code]);
      }
    }, 3000);
  } else {
    // Normal point won, reset for next serve immediately
    resetPositionsAndServe(room);
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Tennis server running on port ${PORT}`));