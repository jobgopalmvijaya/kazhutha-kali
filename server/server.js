const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    methods: ["GET", "POST"],
    credentials: true
  }
});

const PORT = process.env.PORT || 5000;

// Game rooms storage
const rooms = new Map();

// Session management storage
const playerSessions = new Map();
const sessionTimers = new Map();
const hostEndCooldowns = new Map();

// Constants
const SESSION_TIMEOUT = 10 * 60 * 1000; // 10 minutes
const CLEANUP_INTERVAL = 60 * 1000;      // 1 minute
const ROOM_IDLE_TIMEOUT = 30 * 60 * 1000; // 30 minutes
const END_GAME_COOLDOWN = 10 * 1000;     // 10 seconds

// Card suits and values
const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const VALUES = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

// Card ranking (for comparison)
const CARD_RANK = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
  'J': 11, 'Q': 12, 'K': 13, 'A': 14
};

// Generate a deck of 52 cards
function createDeck() {
  const deck = [];
  for (let suit of SUITS) {
    for (let value of VALUES) {
      deck.push({ suit, value, id: `${value}_${suit}` });
    }
  }
  return deck;
}

// Shuffle array using Fisher-Yates algorithm
function shuffleDeck(deck) {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// Deal cards to players
function dealCards(players, deck) {
  const shuffledDeck = shuffleDeck(deck);
  const playerCount = players.length;
  const hands = players.map(() => []);
  
  shuffledDeck.forEach((card, index) => {
    hands[index % playerCount].push(card);
  });
  
  return hands;
}

// Find player with Ace of Spades
function findPlayerWithAceOfSpades(players) {
  return players.findIndex(player => 
    player.hand.some(card => card.value === 'A' && card.suit === 'spades')
  );
}

// Check if a card can be played
function canPlayCard(card, leadSuit, playerHand) {
  // If no lead suit (first card), any card can be played
  if (!leadSuit) return true;
  
  // Check if player has cards of lead suit
  const hasLeadSuit = playerHand.some(c => c.suit === leadSuit);
  
  // If player has lead suit, they must play it
  if (hasLeadSuit) {
    return card.suit === leadSuit;
  }
  
  // If player doesn't have lead suit, they can play any card
  return true;
}

// Calculate trick winner or determine if "Pani" (Cut) happened
function calculateTrickResult(centerPile, leadSuit) {
  // Check if there's a cut (someone played a different suit)
  const hasCut = centerPile.some(play => play.card.suit !== leadSuit);
  
  if (hasCut) {
    // Find the cut play (first card of different suit)
    const cutIndex = centerPile.findIndex(play => play.card.suit !== leadSuit);
    
    // Find who played the highest card of the LEAD suit before the cut
    let highestLeadCard = null;
    let victimIndex = -1;
    
    for (let i = 0; i < cutIndex; i++) {
      const play = centerPile[i];
      if (play.card.suit === leadSuit) {
        if (!highestLeadCard || CARD_RANK[play.card.value] > CARD_RANK[highestLeadCard.card.value]) {
          highestLeadCard = play;
          victimIndex = i;
        }
      }
    }
    
    // The victim picks up all cards
    return {
      isPani: true,
      victimPlayerId: victimIndex >= 0 ? centerPile[victimIndex].playerId : centerPile[0].playerId,
      cards: centerPile.map(p => p.card)
    };
  } else {
    // Normal trick - highest card of lead suit wins
    let highestCard = centerPile[0];
    let winnerIndex = 0;
    let secondHighestCard = null;
    let secondHighestIndex = -1;
    
    for (let i = 1; i < centerPile.length; i++) {
      const play = centerPile[i];
      if (play.card.suit === leadSuit) {
        if (CARD_RANK[play.card.value] > CARD_RANK[highestCard.card.value]) {
          // New highest found - current highest becomes second highest
          secondHighestCard = highestCard;
          secondHighestIndex = winnerIndex;
          highestCard = play;
          winnerIndex = i;
        } else if (!secondHighestCard || CARD_RANK[play.card.value] > CARD_RANK[secondHighestCard.card.value]) {
          // New second highest found
          secondHighestCard = play;
          secondHighestIndex = i;
        }
      }
    }
    
    return {
      isPani: false,
      winnerPlayerId: highestCard.playerId,
      secondWinnerPlayerId: secondHighestIndex >= 0 ? centerPile[secondHighestIndex].playerId : null,
      cards: [] // Cards are discarded
    };
  }
}

// Create a new room
function createRoom(hostSocketId, hostName) {
  const roomId = uuidv4().substring(0, 8);
  const sessionId = uuidv4();
  
  rooms.set(roomId, {
    id: roomId,
    host: sessionId,
    players: [{
      id: hostSocketId,
      sessionId: sessionId,
      name: hostName,
      hand: [],
      isSafe: false,
      isHost: true,
      isConnected: true,
      lastActivity: Date.now(),
      disconnectedAt: null
    }],
    gameStarted: false,
    currentTurn: 0,
    centerPile: [],
    leadSuit: null,
    roundNumber: 0,
    gameOver: false,
    loser: null,
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
    state: 'waiting',
    endedBy: null,
    endReason: null,
    gameEndedAt: null,
    scheduledDeletion: null
  });
  
  return roomId;
}

// Join existing room
function joinRoom(roomId, socketId, playerName) {
  const room = rooms.get(roomId);
  
  if (!room) {
    return { success: false, message: 'Room not found' };
  }
  
  if (room.gameStarted) {
    return { success: false, message: 'Game already started. Room is locked.' };
  }
  
  if (room.players.length >= 6) {
    return { success: false, message: 'Room is full (max 6 players)' };
  }
  
  // Check if player is already in the room (prevent duplicates)
  const existingPlayer = room.players.find(p => p.id === socketId);
  if (existingPlayer) {
    console.log(`Player ${socketId} already in room ${roomId}, skipping duplicate join`);
    return { success: true, room, alreadyInRoom: true };
  }
  
  const sessionId = uuidv4();
  room.players.push({
    id: socketId,
    sessionId: sessionId,
    name: playerName,
    hand: [],
    isSafe: false,
    isHost: false,
    isConnected: true,
    lastActivity: Date.now(),
    disconnectedAt: null
  });
  
  updateRoomActivity(roomId);
  
  return { success: true, room };
}

// Start the game
function startGame(roomId) {
  const room = rooms.get(roomId);
  
  if (!room || room.players.length < 2) {
    return { success: false, message: 'Need at least 2 players to start' };
  }
  
  // Create and shuffle deck
  const deck = createDeck();
  const hands = dealCards(room.players, deck);
  
  // Assign hands to players
  room.players.forEach((player, index) => {
    player.hand = hands[index];
  });
  
  // Find who has Ace of Spades
  const firstPlayerIndex = findPlayerWithAceOfSpades(room.players);
  
  room.gameStarted = true;
  room.currentTurn = firstPlayerIndex >= 0 ? firstPlayerIndex : 0;
  room.roundNumber = 1;
  
  return { success: true, room };
}

// Play a card
function playCard(roomId, playerId, card) {
  const room = rooms.get(roomId);
  
  if (!room || !room.gameStarted) {
    return { success: false, message: 'Game not started' };
  }
  
  const playerIndex = room.players.findIndex(p => p.id === playerId);
  
  if (playerIndex === -1) {
    return { success: false, message: 'Player not found' };
  }
  
  if (playerIndex !== room.currentTurn) {
    return { success: false, message: 'Not your turn' };
  }
  
  const player = room.players[playerIndex];
  
  if (player.isSafe) {
    return { success: false, message: 'You are already safe' };
  }
  
  // Find card in player's hand
  const cardIndex = player.hand.findIndex(c => c.id === card.id);
  
  if (cardIndex === -1) {
    return { success: false, message: 'Card not in hand' };
  }
  
  // Validate card can be played
  if (!canPlayCard(card, room.leadSuit, player.hand)) {
    return { success: false, message: 'Must follow suit if possible' };
  }
  
  // ✅ AUTHENTIC KERALA RULE: First card of the game MUST be Ace of Spades
  if (room.roundNumber === 0 && room.centerPile.length === 0) {
    if (card.value !== 'A' || card.suit !== 'spades') {
      return { 
        success: false, 
        message: 'First card of the game must be Ace of Spades! ♠A' 
      };
    }
    console.log('♠️ Game starts with Ace of Spades - traditional Kerala style!');
  }
  
  // Remove card from player's hand
  player.hand.splice(cardIndex, 1);
  
  // Set lead suit if this is the first card
  if (room.centerPile.length === 0) {
    room.leadSuit = card.suit;
  }
  
  // Add card to center pile
  room.centerPile.push({
    playerId: playerId,
    playerName: player.name,
    card: card
  });
  
  // Check if player emptied their hand
  if (player.hand.length === 0) {
    player.isSafe = true;
  }
  
  // Get active players (not safe)
  const activePlayers = room.players.filter(p => !p.isSafe);
  
  // ✅ CRITICAL FIX: Check for cut immediately after each card played
  // In authentic Kerala Kazhutha Kali, the round STOPS as soon as someone cuts!
  const hasCut = room.centerPile.length > 1 && 
                  room.centerPile.some(play => play.card.suit !== room.leadSuit);
  
  let shouldProcessTrick = false;
  let trickResult = null;
  
  if (hasCut) {
    // ✅ Cut detected! Process trick immediately - don't wait for other players
    console.log('🔥 PANI (Cut) detected! Round stops immediately.');
    shouldProcessTrick = true;
    trickResult = calculateTrickResult(room.centerPile, room.leadSuit);
  } else {
    // No cut yet, check if all active players have played
    const allActivePlayed = activePlayers.every(p => 
      room.centerPile.some(pile => pile.playerId === p.id)
    );
    
    if (allActivePlayed) {
      // All players followed suit, process normal trick
      console.log('✅ All players followed suit. Processing normal trick.');
      shouldProcessTrick = true;
      trickResult = calculateTrickResult(room.centerPile, room.leadSuit);
    }
  }
  
  if (shouldProcessTrick) {
    // Process the trick
    if (trickResult.isPani) {
      // Pani happened - victim picks up cards
      const victimPlayer = room.players.find(p => p.id === trickResult.victimPlayerId);
      if (victimPlayer) {
        victimPlayer.hand.push(...trickResult.cards);
        victimPlayer.isSafe = false; // They're definitely not safe now
        
        console.log(`💥 ${victimPlayer.name} picks up ${trickResult.cards.length} cards (Pani!)`);
        
        // Victim starts next round
        const victimIndex = room.players.findIndex(p => p.id === trickResult.victimPlayerId);
        room.currentTurn = victimIndex;
      }
    } else {
      // Normal trick - winner starts next round
      const winnerIndex = room.players.findIndex(p => p.id === trickResult.winnerPlayerId);
      const winner = room.players[winnerIndex];
      console.log(`🏆 ${winner.name} wins the trick!`);
      
      // ✅ KERALA RULE: "Transfer of Power" - If winner is safe, second highest starts
      if (winner.isSafe) {
        // Winner just went safe with their last card
        // Power transfers to player with second highest card
        if (trickResult.secondWinnerPlayerId) {
          const secondWinnerIndex = room.players.findIndex(p => p.id === trickResult.secondWinnerPlayerId);
          const secondWinner = room.players[secondWinnerIndex];
          console.log(`👑 ${winner.name} is Safe! Power transfers to ${secondWinner.name} (second highest card)`);
          room.currentTurn = secondWinnerIndex;
        } else {
          // No second winner (only 1 card played?) - find next active player
          let nextTurn = (winnerIndex + 1) % room.players.length;
          while (room.players[nextTurn].isSafe && nextTurn !== winnerIndex) {
            nextTurn = (nextTurn + 1) % room.players.length;
          }
          room.currentTurn = nextTurn;
          console.log(`👑 ${winner.name} is Safe! Next active player starts.`);
        }
      } else {
        // Winner still has cards, they start next round
        room.currentTurn = winnerIndex;
      }
    }
    
    // Clear center pile and lead suit
    room.centerPile = [];
    room.leadSuit = null;
    room.roundNumber++;
    
    // Check if game is over (only one player left)
    const playersWithCards = room.players.filter(p => !p.isSafe);
    if (playersWithCards.length === 1) {
      room.gameOver = true;
      room.loser = playersWithCards[0];
      console.log(`🫏 ${playersWithCards[0].name} is the Kazhutha (Donkey)!`);
    }
    
    return { success: true, room, trickResult };
  } else {
    // No cut, not all players played yet - advance turn to next active player
    let nextTurn = (room.currentTurn + 1) % room.players.length;
    
    // Skip safe players
    while (room.players[nextTurn].isSafe) {
      nextTurn = (nextTurn + 1) % room.players.length;
    }
    
    room.currentTurn = nextTurn;
    
    return { success: true, room, trickResult: null };
  }
}

// =====================================================================
// SESSION MANAGEMENT & UTILITY FUNCTIONS
// =====================================================================

// Update room activity timestamp
function updateRoomActivity(roomId) {
  const room = rooms.get(roomId);
  if (room) {
    room.lastActivityAt = Date.now();
  }
}

// Handle player disconnect
function handlePlayerDisconnect(socketId) {
  rooms.forEach((room, roomId) => {
    const player = room.players.find(p => p.id === socketId);
    
    if (player) {
      player.isConnected = false;
      player.disconnectedAt = Date.now();
      
      playerSessions.set(player.sessionId, {
        roomId: roomId,
        playerIndex: room.players.indexOf(player),
        disconnectedAt: Date.now(),
        expiresAt: Date.now() + SESSION_TIMEOUT
      });
      
      const timer = setTimeout(() => {
        removeExpiredPlayer(player.sessionId, roomId);
      }, SESSION_TIMEOUT);
      
      sessionTimers.set(player.sessionId, timer);
      
      io.to(roomId).emit('player_disconnected', {
        playerId: player.sessionId,
        playerName: player.name,
        canReconnect: true,
        timeoutMinutes: 10
      });
    }
  });
}

// Remove expired player
function removeExpiredPlayer(sessionId, roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  
  const playerIndex = room.players.findIndex(p => p.sessionId === sessionId);
  if (playerIndex !== -1) {
    const player = room.players[playerIndex];
    room.players.splice(playerIndex, 1);
    
    playerSessions.delete(sessionId);
    sessionTimers.delete(sessionId);
    
    if (room.players.length === 0) {
      cleanupRoom(roomId);
    } else {
      if (room.host === sessionId && room.players.length > 0) {
        room.host = room.players[0].sessionId;
        room.players[0].isHost = true;
      }
      
      io.to(roomId).emit('player_removed', {
        playerId: sessionId,
        reason: 'session_expired'
      });
    }
  }
}

// Cleanup expired sessions
function cleanupExpiredSessions() {
  const now = Date.now();
  playerSessions.forEach((session, sessionId) => {
    if (now > session.expiresAt) {
      removeExpiredPlayer(sessionId, session.roomId);
    }
  });
}

// Cleanup inactive rooms
function cleanupInactiveRooms() {
  const now = Date.now();
  rooms.forEach((room, roomId) => {
    const idleTime = now - room.lastActivityAt;
    const allDisconnected = room.players.every(p => !p.isConnected);
    
    if (
      (room.state === 'ended' && idleTime > 5 * 60 * 1000) ||
      (allDisconnected && idleTime > 10 * 60 * 1000) ||
      (room.state === 'waiting' && now - room.createdAt > 2 * 60 * 60 * 1000)
    ) {
      cleanupRoom(roomId);
    }
  });
}

// Cleanup room completely
function cleanupRoom(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  
  room.players.forEach(player => {
    if (playerSessions.has(player.sessionId)) {
      playerSessions.delete(player.sessionId);
    }
    if (sessionTimers.has(player.sessionId)) {
      clearTimeout(sessionTimers.get(player.sessionId));
      sessionTimers.delete(player.sessionId);
    }
  });
  
  if (room.scheduledDeletion) {
    clearTimeout(room.scheduledDeletion);
  }
  
  rooms.delete(roomId);
  console.log(`Room ${roomId} cleaned up`);
}

// End game by host
function endGameByHost(roomId, hostSocketId, reason) {
  const room = rooms.get(roomId);
  
  if (!room) {
    return { success: false, message: 'Room not found' };
  }
  
  const hostPlayer = room.players.find(p => p.id === hostSocketId);
  if (!hostPlayer || !hostPlayer.isHost) {
    return { success: false, message: 'Only host can end the game' };
  }
  
  if (room.gameOver && room.state === 'ended') {
    return { success: false, message: 'Game already ended' };
  }
  
  room.gameOver = true;
  room.state = 'ended';
  room.endedBy = 'host';
  room.endReason = reason || 'Host ended the game';
  room.gameEndedAt = Date.now();
  
  if (room.scheduledDeletion) {
    clearTimeout(room.scheduledDeletion);
  }
  
  return { 
    success: true, 
    room, 
    hostName: hostPlayer.name 
  };
}

// =====================================================================
// SOCKET.IO CONNECTION HANDLING
// =====================================================================

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);
  
  // Create room
  socket.on('create_room', (playerName) => {
    const roomId = createRoom(socket.id, playerName);
    socket.join(roomId);
    
    const room = rooms.get(roomId);
    const hostPlayer = room.players[0];
    socket.emit('room_created', { 
      roomId, 
      room: getClientSafeRoom(room, socket.id),
      sessionId: hostPlayer.sessionId
    });
  });
  
  // Join room
  socket.on('join_room', ({ roomId, playerName }) => {
    const result = joinRoom(roomId, socket.id, playerName);
    
    if (result.success) {
      socket.join(roomId);
      const joiningPlayer = result.room.players.find(p => p.id === socket.id);
      socket.emit('room_joined', { 
        roomId, 
        room: getClientSafeRoom(result.room, socket.id),
        sessionId: joiningPlayer.sessionId
      });
      
      // Notify all players in room
      io.to(roomId).emit('player_joined', {
        room: getClientSafeRoom(result.room, socket.id)
      });
    } else {
      socket.emit('join_error', { message: result.message });
    }
  });
  
  // Start game
  socket.on('start_game', (roomId) => {
    const room = rooms.get(roomId);
    
    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }
    
    const hostPlayer = room.players.find(p => p.id === socket.id);
    if (!hostPlayer || !hostPlayer.isHost) {
      socket.emit('error', { message: 'Only host can start the game' });
      return;
    }
    
    const result = startGame(roomId);
    
    if (result.success) {
      room.state = 'active';
      updateRoomActivity(roomId);
      
      // Send each player their hand privately
      room.players.forEach(player => {
        io.to(player.id).emit('game_started', {
          room: getClientSafeRoom(result.room, player.id)
        });
      });
    } else {
      socket.emit('error', { message: result.message });
    }
  });
  
  // Play card
  socket.on('play_card', ({ roomId, card }) => {
    const result = playCard(roomId, socket.id, card);
    
    if (result.success) {
      updateRoomActivity(roomId);
      
      // Broadcast updated game state to all players
      const room = result.room;
      room.players.forEach(player => {
        io.to(player.id).emit('game_updated', {
          room: getClientSafeRoom(room, player.id),
          trickResult: result.trickResult
        });
      });
    } else {
      socket.emit('error', { message: result.message });
    }
  });
  
  // Get room state
  socket.on('get_room_state', (roomId) => {
    const room = rooms.get(roomId);
    if (room) {
      socket.emit('room_state', { room: getClientSafeRoom(room, socket.id) });
    } else {
      socket.emit('error', { message: 'Room not found' });
    }
  });
  
  // Reconnect player
  socket.on('reconnect_player', ({ sessionId, roomId }) => {
    const session = playerSessions.get(sessionId);
    
    if (!session || session.roomId !== roomId) {
      socket.emit('reconnection_failed', { reason: 'session_not_found' });
      return;
    }
    
    if (Date.now() > session.expiresAt) {
      playerSessions.delete(sessionId);
      socket.emit('reconnection_failed', { reason: 'session_expired' });
      return;
    }
    
    const room = rooms.get(roomId);
    if (!room) {
      playerSessions.delete(sessionId);
      socket.emit('reconnection_failed', { reason: 'room_not_found' });
      return;
    }
    
    const player = room.players.find(p => p.sessionId === sessionId);
    if (!player) {
      playerSessions.delete(sessionId);
      socket.emit('reconnection_failed', { reason: 'player_not_found' });
      return;
    }
    
    if (sessionTimers.has(sessionId)) {
      clearTimeout(sessionTimers.get(sessionId));
      sessionTimers.delete(sessionId);
    }
    
    player.id = socket.id;
    player.isConnected = true;
    player.disconnectedAt = null;
    player.lastActivity = Date.now();
    
    playerSessions.delete(sessionId);
    
    socket.join(roomId);
    
    socket.emit('reconnection_successful', {
      room: getClientSafeRoom(room, socket.id),
      message: 'Reconnected successfully!'
    });
    
    socket.to(roomId).emit('player_reconnected', {
      playerId: sessionId,
      playerName: player.name
    });
    
    updateRoomActivity(roomId);
  });
  
  // Host end game
  socket.on('host_end_game', ({ roomId, reason }) => {
    const now = Date.now();
    const lastEnd = hostEndCooldowns.get(socket.id);
    
    if (lastEnd && now - lastEnd < END_GAME_COOLDOWN) {
      socket.emit('game_end_error', { 
        message: 'Please wait before ending another game',
        cooldownRemaining: Math.ceil((END_GAME_COOLDOWN - (now - lastEnd)) / 1000)
      });
      return;
    }
    
    const result = endGameByHost(roomId, socket.id, reason);
    
    if (result.success) {
      hostEndCooldowns.set(socket.id, now);
      
      io.to(roomId).emit('game_ended_by_host', {
        reason: reason || 'Host ended the game',
        endedBy: result.hostName,
        endedAt: Date.now()
      });
      
      setTimeout(() => {
        cleanupRoom(roomId);
      }, 30000);
      
      socket.emit('game_end_success', { message: 'Game ended successfully' });
    } else {
      socket.emit('game_end_error', { message: result.message });
    }
  });
  
  // Disconnect
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    handlePlayerDisconnect(socket.id);
  });
});

// Helper function to create client-safe room data
// Hides other players' hands
function getClientSafeRoom(room, playerId) {
  return {
    id: room.id,
    host: room.host,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      handCount: p.hand.length,
      hand: p.id === playerId ? p.hand : [], // Only send hand to the player who owns it
      isSafe: p.isSafe,
      isHost: p.isHost
    })),
    gameStarted: room.gameStarted,
    currentTurn: room.currentTurn,
    currentTurnPlayer: room.players[room.currentTurn],
    centerPile: room.centerPile,
    leadSuit: room.leadSuit,
    roundNumber: room.roundNumber,
    gameOver: room.gameOver,
    loser: room.loser
  };
}

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Session timeout: ${SESSION_TIMEOUT / 1000 / 60} minutes`);
  console.log(`Cleanup interval: ${CLEANUP_INTERVAL / 1000} seconds`);
});

// =====================================================================
// CLEANUP & MONITORING
// =====================================================================

// Cleanup intervals
setInterval(() => {
  cleanupExpiredSessions();
  cleanupInactiveRooms();
  
  // Clean up old cooldowns
  const now = Date.now();
  hostEndCooldowns.forEach((time, hostId) => {
    if (now - time > END_GAME_COOLDOWN) {
      hostEndCooldowns.delete(hostId);
    }
  });
}, CLEANUP_INTERVAL);

// Memory monitoring (every 5 minutes)
setInterval(() => {
  const usage = process.memoryUsage();
  const stats = {
    timestamp: new Date().toISOString(),
    heapUsed: Math.round(usage.heapUsed / 1024 / 1024) + ' MB',
    heapTotal: Math.round(usage.heapTotal / 1024 / 1024) + ' MB',
    rooms: rooms.size,
    sessions: playerSessions.size,
    activeGames: Array.from(rooms.values()).filter(r => r.gameStarted && !r.gameOver).length,
    waitingRooms: Array.from(rooms.values()).filter(r => !r.gameStarted).length,
    endedGames: Array.from(rooms.values()).filter(r => r.gameOver).length,
    totalPlayers: Array.from(rooms.values())
      .reduce((sum, r) => sum + r.players.length, 0),
    connectedPlayers: Array.from(rooms.values())
      .reduce((sum, r) => sum + r.players.filter(p => p.isConnected).length, 0)
  };
  
  console.log('📊 Server Stats:', stats);
  
  // Alert if memory too high
  if (usage.heapUsed / 1024 / 1024 > 500) {
    console.error('⚠️  HIGH MEMORY USAGE! Running aggressive cleanup...');
    cleanupInactiveRooms();
  }
}, 5 * 60 * 1000);

console.log('✅ Cleanup and monitoring initialized');
