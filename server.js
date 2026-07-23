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

  // CRITICAL FIX: Explicit cleanup function to prevent memory leaks
  function leaveCurrentRoom() {
    if (socket.roomCode && rooms[socket.roomCode]) {
      // Notify the opponent and destroy the orphaned room state
      io.to(socket.roomCode).emit('opponentLeft');
      delete rooms[socket.roomCode]; 
    }
    if (socket.roomCode) {
      socket.leave(socket.roomCode);
      socket.roomCode = null;
    }
  }

  socket.on('createRoom', () => {
    leaveCurrentRoom(); // Purge old room if user spams "Create Room"

    const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    rooms[roomCode] = {
      players: {},
      // NEW: Added spin property to ball
      ball: { x: COURT_WIDTH / 2, y: NET_Y, vx: 0, vy: 0, speed: 5, spin: 0, inPlay: false },
      scores: { 1: 0, 2: 0 }, 
      sets: { 1: 0, 2: 0 },   
      state: 'waiting',       // waiting, serving, playing, scored, setover
      serverTurn: 1,
      pointsPlayed: 0,
      lastHitBy: null,
      winner: null
    };
    assignToRoom(socket, roomCode);
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
    
    leaveCurrentRoom(); // Purge old state before joining new room
    assignToRoom(socket, roomCode);
  });

  function assignToRoom(socket, roomCode) {
    const room = rooms[roomCode];
    const playerNum = Object.keys(room.players).length === 0 ? 1 : 2;
    
    // NEW: Players now track their current vx/vy to allow for spin calculations
    room.players[socket.id] = {
      id: socket.id,
      num: playerNum,
      x: COURT_WIDTH / 2,
      y: playerNum === 1 ? COURT_HEIGHT - 40 : 40,
      vx: 0,
      vy: 0,
      swinging: false
    };

    socket.join(roomCode);
    socket.roomCode = roomCode;
    socket.emit('roomJoined', { roomCode, playerNum });

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

    const speed = 9.5; 
    
    // Reset velocities every move tick, recalculate based on input
    player.vx = 0;
    player.vy = 0;

    if (data.up) player.vy -= speed;
    if (data.down) player.vy += speed;
    if (data.left) player.vx -= speed;
    if (data.right) player.vx += speed;

    // Apply movement
    player.x += player.vx;
    player.y += player.vy;

    // Boundary constraints
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

    // Handle initial serve
    if (room.state === 'serving') {
      if (player.num === room.serverTurn) {
        room.state = 'playing'; 
        player.swinging = true;
        setTimeout(() => { if (player) player.swinging = false; }, 150);
        
        const ball = room.ball;
        ball.speed = 9; 
        ball.vy = player.num === 1 ? -ball.speed : ball.speed;
        ball.vx = player.x > COURT_WIDTH / 2 ? -3 : 3;
        ball.spin = 0; // No spin on serves
        room.lastHitBy = player.num;
        
        io.to(socket.roomCode).emit('hitFeedback', { x: ball.x, y: ball.y, quality: "Serve!" });
      }
      return; 
    }

    player.swinging = true;
    setTimeout(() => { if (player) player.swinging = false; }, 150);

    const ball = room.ball;
    const dx = ball.x - player.x;
    const dy = ball.y - player.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 75) {
      const accuracy = 1 - (dist / 75); 
      let speedMultiplier = 5; 
      let hitQuality = "Weak/Late";

      if (accuracy > 0.70) {
        speedMultiplier = 12; 
        hitQuality = "Perfect Smash";
      } else if (accuracy > 0.40) {
        speedMultiplier = 8.5;
        hitQuality = "Good";
      }

      ball.speed = speedMultiplier;
      ball.vy = player.num === 1 ? -ball.speed : ball.speed;
      
      // FEATURE: Aiming (Based on where ball hits racket)
      let baseAimVx = (dx / 25) * (ball.speed * 0.7);
      
      // FEATURE: Spin (Based on player's momentum at time of swing)
      // 35% of player's speed is transferred as spin momentum
      let spinAdded = (player.vx || 0) * 0.35; 
      
      ball.vx = baseAimVx + spinAdded;
      
      // Affects the ball's trajectory mid-air every frame
      ball.spin = spinAdded * 0.05; 
      
      room.lastHitBy = player.num;

      // Add flair to hit feedback if they applied severe spin
      let feedbackText = hitQuality;
      if (Math.abs(spinAdded) > 1.5) feedbackText += " + SPIN!";

      io.to(socket.roomCode).emit('hitFeedback', { x: ball.x, y: ball.y, quality: feedbackText });
    }
  });

  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);
    leaveCurrentRoom(); 
  });
});

function resetPositionsAndServe(room) {
  room.pointsPlayed = room.scores[1] + room.scores[2];
  room.serverTurn = (room.pointsPlayed % 2 === 0) ? 1 : 2;
  room.state = 'serving';
  
  room.ball.vx = 0;
  room.ball.vy = 0;
  room.ball.spin = 0;
  room.lastHitBy = null;
  
  const isDeuceSide = room.pointsPlayed % 2 === 0;
  
  for (const id in room.players) {
    const p = room.players[id];
    p.vx = 0;
    p.vy = 0;
    if (p.num === 1) {
        p.y = COURT_HEIGHT - 40; 
        p.x = isDeuceSide ? COURT_WIDTH / 2 + 100 : COURT_WIDTH / 2 - 100;
    } else {
        p.y = 40; 
        p.x = isDeuceSide ? COURT_WIDTH / 2 - 100 : COURT_WIDTH / 2 + 100;
    }
  }
}

setInterval(() => {
  for (const code in rooms) {
    const room = rooms[code];
    
    if (room.state === 'serving') {
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

    if (room.state !== 'playing') continue;

    const ball = room.ball;
    
    // FEATURE: Apply mid-air curve/spin physics
    if (ball.spin) {
      ball.vx += ball.spin;
    }

    ball.x += ball.vx;
    ball.y += ball.vy;

    // Bounce off side walls (reverses spin direction too)
    if (ball.x <= BALL_RADIUS || ball.x >= COURT_WIDTH - BALL_RADIUS) {
      ball.vx *= -1;
      ball.spin *= -1; 
    }

    if (ball.y < 0) {
      handlePoint(room, code, 1);
    } else if (ball.y > COURT_HEIGHT) {
      handlePoint(room, code, 2);
    }

    if (room.state === 'playing') {
      io.to(code).emit('gameState', {
        players: room.players, ball: room.ball, scores: room.scores, sets: room.sets, state: room.state, serverTurn: room.serverTurn
      });
    }
  }
}, 1000 / 60);

function handlePoint(room, code, scorer) {
  room.scores[scorer]++;
  room.state = 'scored'; 
  
  io.to(code).emit('gameState', {
    players: room.players, ball: room.ball, scores: room.scores, sets: room.sets, state: room.state
  });
  io.to(code).emit('pointScored', { scorer });

  setTimeout(() => {
    if (rooms[code]) {
      checkWin(rooms[code], code, scorer);
    }
  }, 2000);
}

function checkWin(room, code, scorer) {
  const p1 = room.scores[1];
  const p2 = room.scores[2];

  if ((p1 >= 6 || p2 >= 6) && Math.abs(p1 - p2) >= 2) {
    room.sets[scorer]++;       
    room.state = 'setover';
    
    io.to(code).emit('setComplete', { 
      setWinner: scorer, finalScores: { ...room.scores }, sets: room.sets 
    });

    setTimeout(() => {
      if (rooms[code]) {
        rooms[code].scores = { 1: 0, 2: 0 };
        resetPositionsAndServe(rooms[code]);
        io.to(code).emit('nextSetStart', rooms[code]);
      }
    }, 3000);
  } else {
    resetPositionsAndServe(room);
    io.to(code).emit('gameState', {
      players: room.players, ball: room.ball, scores: room.scores, sets: room.sets, state: room.state, serverTurn: room.serverTurn
    });
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Tennis server running on port ${PORT}`));