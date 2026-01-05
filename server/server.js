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
  
  rooms.set(roomId, {
    id: roomId,
    host: hostSocketId,
    players: [{
      id: hostSocketId,
      name: hostName,
      hand: [],
      isSafe: false,
      isHost: true
    }],
    gameStarted: false,
    currentTurn: 0,
    centerPile: [],
    leadSuit: null,
    roundNumber: 0,
    gameOver: false,
    loser: null
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
  
  room.players.push({
    id: socketId,
    name: playerName,
    hand: [],
    isSafe: false,
    isHost: false
  });
  
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

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);
  
  // Create room
  socket.on('create_room', (playerName) => {
    const roomId = createRoom(socket.id, playerName);
    socket.join(roomId);
    
    const room = rooms.get(roomId);
    socket.emit('room_created', { roomId, room: getClientSafeRoom(room, socket.id) });
  });
  
  // Join room
  socket.on('join_room', ({ roomId, playerName }) => {
    const result = joinRoom(roomId, socket.id, playerName);
    
    if (result.success) {
      socket.join(roomId);
      socket.emit('room_joined', { roomId, room: getClientSafeRoom(result.room, socket.id) });
      
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
    
    if (!room || room.host !== socket.id) {
      socket.emit('error', { message: 'Only host can start the game' });
      return;
    }
    
    const result = startGame(roomId);
    
    if (result.success) {
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
  
  // Disconnect
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    
    // Find and remove player from any room
    rooms.forEach((room, roomId) => {
      const playerIndex = room.players.findIndex(p => p.id === socket.id);
      
      if (playerIndex !== -1) {
        room.players.splice(playerIndex, 1);
        
        // If room is empty, delete it
        if (room.players.length === 0) {
          rooms.delete(roomId);
        } else {
          // If host left, assign new host
          if (room.host === socket.id && room.players.length > 0) {
            room.host = room.players[0].id;
            room.players[0].isHost = true;
          }
          
          // Notify remaining players
          io.to(roomId).emit('player_left', {
            room: getClientSafeRoom(room, null)
          });
        }
      }
    });
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
});
