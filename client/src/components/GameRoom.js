import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { getSocket, saveSession, getSession, attemptReconnection, clearSession } from '../services/socket';
import Card from './Card';
import PlayerHand from './PlayerHand';
import EndGameModal from './EndGameModal';
import GameEndedOverlay from './GameEndedOverlay';
import './GameRoom.css';

function GameRoom() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const socket = getSocket();
  
  const [playerName, setPlayerName] = useState(location.state?.playerName || '');
  const [hasJoined, setHasJoined] = useState(false);
  const [room, setRoom] = useState(null);
  const [error, setError] = useState('');
  const [notification, setNotification] = useState('');
  const [myPlayerId, setMyPlayerId] = useState(socket.id || '');
  const [mySessionId, setMySessionId] = useState('');
  const isHostFromHome = location.state?.isHost || false;
  
  // New state for host end game
  const [showEndGameModal, setShowEndGameModal] = useState(false);
  const [endingGame, setEndingGame] = useState(false);
  const [gameEndedByHost, setGameEndedByHost] = useState(false);
  const [gameEndReason, setGameEndReason] = useState('');
  
  // Reconnection state
  const [reconnecting, setReconnecting] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  
  // Use ref to prevent multiple join attempts
  const hasAttemptedJoin = useRef(false);

  useEffect(() => {
    // Set my player ID
    setMyPlayerId(socket.id);
    
    socket.on('connect', () => {
      console.log('Connected with socket ID:', socket.id);
      setMyPlayerId(socket.id);
      
      // Only auto-join if NOT the host (host is already added via create_room)
      if (playerName && !hasAttemptedJoin.current && !isHostFromHome) {
        console.log('Auto-joining room:', roomId, 'as', playerName);
        hasAttemptedJoin.current = true;
        socket.emit('join_room', { roomId, playerName });
      }
    });

    socket.on('room_created', ({ roomId, room, sessionId }) => {
      console.log('Room created event received');
      setRoom(room);
      setHasJoined(true);
      setMySessionId(sessionId);
      hasAttemptedJoin.current = true; // Mark as joined
    });

    socket.on('room_joined', ({ room, sessionId }) => {
      console.log('Room joined event received');
      setRoom(room);
      setHasJoined(true);
      setMySessionId(sessionId);
    });

    socket.on('room_state', ({ room }) => {
      console.log('Room state received');
      setRoom(room);
      setHasJoined(true);
      hasAttemptedJoin.current = true;
    });

    socket.on('join_error', ({ message }) => {
      console.error('Join error:', message);
      setError(message);
      hasAttemptedJoin.current = false; // Reset so user can try again
    });

    socket.on('player_joined', ({ room }) => {
      console.log('Another player joined');
      setRoom(room);
      showNotification('A player joined the room');
    });

    socket.on('game_started', ({ room }) => {
      setRoom(room);
      showNotification('Game has started! 🎮');
    });

    socket.on('game_updated', ({ room, trickResult }) => {
      setRoom(room);
      
      if (trickResult) {
        if (trickResult.isPani) {
          const victim = room.players.find(p => p.id === trickResult.victimPlayerId);
          showNotification(`💥 PANI! ${victim?.name} picks up ${trickResult.cards.length} cards!`);
        } else {
          const winner = room.players.find(p => p.id === trickResult.winnerPlayerId);
          showNotification(`${winner?.name} won the trick!`);
        }
      }
    });

    socket.on('player_left', ({ room }) => {
      setRoom(room);
      showNotification('A player left the room');
    });

    socket.on('error', ({ message }) => {
      setError(message);
    });

    // New socket event listeners
    socket.on('player_disconnected', ({ playerName, canReconnect, timeoutMinutes }) => {
      showNotification(`${playerName} disconnected (can reconnect within ${timeoutMinutes} min)`);
    });

    socket.on('player_reconnected', ({ playerName }) => {
      showNotification(`${playerName} reconnected! 🔄`);
    });

    socket.on('player_removed', ({ playerId, reason }) => {
      if (reason === 'session_expired') {
        showNotification('A player was removed (session expired)');
      }
    });

    socket.on('game_ended_by_host', ({ reason, endedBy }) => {
      setGameEndedByHost(true);
      setGameEndReason(reason);
      showNotification(`Game ended by ${endedBy}`);
      clearSession();
    });

    socket.on('game_end_success', () => {
      setEndingGame(false);
      setShowEndGameModal(false);
    });

    socket.on('game_end_error', ({ message }) => {
      alert(message);
      setEndingGame(false);
    });

    socket.on('disconnect', () => {
      console.log('Disconnected from server');
      setReconnecting(true);
    });

    // Only auto-join if already connected, have player name, and NOT the host
    if (socket.connected && playerName && !hasAttemptedJoin.current && !isHostFromHome) {
      console.log('Socket already connected, joining room:', roomId);
      hasAttemptedJoin.current = true;
      socket.emit('join_room', { roomId, playerName });
    } else if (isHostFromHome) {
      // If host, request room state from server
      console.log('Host detected, requesting room state');
      hasAttemptedJoin.current = true;
      socket.emit('get_room_state', roomId);
    }

    return () => {
      // Don't disconnect - keep socket alive
      // Just remove listeners to prevent duplicates
      socket.off('room_created');
      socket.off('room_joined');
      socket.off('room_state');
      socket.off('join_error');
      socket.off('player_joined');
      socket.off('game_started');
      socket.off('game_updated');
      socket.off('player_left');
      socket.off('error');
      socket.off('player_disconnected');
      socket.off('player_reconnected');
      socket.off('player_removed');
      socket.off('game_ended_by_host');
      socket.off('game_end_success');
      socket.off('game_end_error');
      socket.off('disconnect');
    };
  }, []); // Empty dependencies - only run once on mount

  // Save session when we get sessionId
  useEffect(() => {
    if (mySessionId && roomId && playerName) {
      saveSession(mySessionId, roomId, playerName);
    }
  }, [mySessionId, roomId, playerName]);

  // Check for existing session on mount
  useEffect(() => {
    const existingSession = getSession();
    if (existingSession && existingSession.roomId === roomId && !hasJoined) {
      console.log('Found existing session, attempting reconnection...');
      setReconnecting(true);
      setPlayerName(existingSession.playerName);
      
      attemptReconnection(existingSession.sessionId, existingSession.roomId)
        .then((data) => {
          console.log('Reconnection successful!', data);
          setRoom(data.room);
          setHasJoined(true);
          setReconnecting(false);
          setMySessionId(existingSession.sessionId);
          showNotification('Reconnected successfully! 🔄');
        })
        .catch((error) => {
          console.log('Reconnection failed:', error);
          setReconnecting(false);
          clearSession();
          if (error.reason === 'session_expired') {
            setSessionExpired(true);
          }
        });
    }
  }, []);

  const showNotification = (message) => {
    setNotification(message);
    setTimeout(() => setNotification(''), 3000);
  };

  const handleJoinRoom = () => {
    if (!playerName.trim()) {
      setError('Please enter your name');
      return;
    }

    if (hasAttemptedJoin.current) {
      console.log('Already attempted to join, ignoring duplicate request');
      return;
    }

    console.log('Manually joining room:', roomId, 'as', playerName);
    hasAttemptedJoin.current = true;
    socket.emit('join_room', { roomId, playerName });
  };

  const handleStartGame = () => {
    socket.emit('start_game', roomId);
  };

  const handlePlayCard = (card) => {
    socket.emit('play_card', { roomId, card });
  };

  const copyRoomLink = () => {
    const link = window.location.href;
    navigator.clipboard.writeText(link);
    showNotification('Room link copied to clipboard!');
  };

  const handleEndGame = (reason) => {
    setEndingGame(true);
    socket.emit('host_end_game', { roomId, reason });
  };

  // Show reconnecting state
  if (reconnecting) {
    return (
      <div className="game-room-container">
        <div className="join-prompt fade-in">
          <div className="card-container text-center">
            <h2>Reconnecting...</h2>
            <p>Please wait while we restore your session</p>
            <div className="loading-spinner mt-3"></div>
          </div>
        </div>
      </div>
    );
  }

  // Show session expired state
  if (sessionExpired) {
    return (
      <div className="game-room-container">
        <div className="join-prompt fade-in">
          <div className="card-container text-center">
            <h2>Session Expired</h2>
            <p>Your session has expired after 10 minutes of inactivity</p>
            <button onClick={() => navigate('/')} className="btn-primary mt-3">
              Return to Home
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!hasJoined) {
    // If player name was provided from Home screen, show loading while auto-joining
    if (location.state?.playerName) {
      return (
        <div className="game-room-container">
          <div className="join-prompt fade-in">
            <div className="card-container text-center">
              <h2>Joining Room...</h2>
              <p className="room-id-display">Room ID: <strong>{roomId}</strong></p>
              <div className="loading-spinner mt-3">
                <p>Connecting as <strong>{playerName}</strong>...</p>
              </div>
            </div>
          </div>
        </div>
      );
    }

    // Otherwise show the join form
    return (
      <div className="game-room-container">
        <div className="join-prompt fade-in">
          <div className="card-container">
            <h2>Join Room</h2>
            <p className="room-id-display">Room ID: <strong>{roomId}</strong></p>
            
            <div className="input-group mt-3">
              <label>Your Name</label>
              <input
                type="text"
                placeholder="Enter your name"
                value={playerName}
                onChange={(e) => {
                  setPlayerName(e.target.value);
                  setError('');
                }}
                onKeyPress={(e) => {
                  if (e.key === 'Enter') handleJoinRoom();
                }}
                autoFocus
              />
            </div>

            {error && <p className="error-message">{error}</p>}

            <button 
              className="btn-primary btn-large mt-2"
              onClick={handleJoinRoom}
            >
              Join Game
            </button>

            <button 
              className="btn-secondary mt-2"
              onClick={() => navigate('/')}
            >
              Back to Home
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!room) {
    return (
      <div className="game-room-container">
        <div className="loading">Loading...</div>
      </div>
    );
  }

  const myPlayer = room.players.find(p => p.id === myPlayerId);
  const isMyTurn = room.currentTurn !== undefined && 
                   room.players[room.currentTurn]?.id === myPlayerId;
  const isHost = myPlayer?.isHost || false;
  
  // Debug logging
  console.log('My Socket ID:', myPlayerId);
  console.log('Room Host ID:', room.host);
  console.log('Am I Host?:', isHost);
  console.log('My Player:', myPlayer);

  return (
    <div className="game-room-container">
      {notification && (
        <div className="notification fade-in">
          {notification}
        </div>
      )}

      {/* End Game Button (Host Only) */}
      {isHost && !room.gameOver && (
        <button 
          className="end-game-btn"
          onClick={() => setShowEndGameModal(true)}
          disabled={endingGame}
          title="End the game for all players"
        >
          End Game
        </button>
      )}

      {/* Modals */}
      {showEndGameModal && (
        <EndGameModal
          onConfirm={handleEndGame}
          onCancel={() => setShowEndGameModal(false)}
          isEnding={endingGame}
        />
      )}

      {gameEndedByHost && (
        <GameEndedOverlay reason={gameEndReason} />
      )}

      <div className="game-header">
        <div className="room-info">
          <h2>🃏 Kazhutha Kali</h2>
          <p>Room: {roomId}</p>
          {!room.gameStarted && (
            <button className="btn-secondary btn-small" onClick={copyRoomLink}>
              📋 Copy Link
            </button>
          )}
        </div>

        {room.gameStarted && (
          <div className="game-status">
            <p>Round: {room.roundNumber}</p>
            {room.leadSuit && (
              <p className="lead-suit">
                Lead: <span className={`suit-${room.leadSuit}`}>{getSuitSymbol(room.leadSuit)}</span>
              </p>
            )}
          </div>
        )}
      </div>

      {/* Lobby View */}
      {!room.gameStarted && (
        <div className="lobby fade-in">
          <div className="card-container">
            <h3>Waiting for Players...</h3>
            <p className="player-count">{room.players.length} player(s) in lobby</p>
            
            <div className="players-list mt-3">
              {room.players.map(player => (
                <div key={player.id} className="player-item">
                  <span>{player.name}</span>
                  {player.isHost && <span className="host-badge">Host</span>}
                  {player.id === myPlayerId && <span className="host-badge" style={{background: '#4caf50'}}>You</span>}
                </div>
              ))}
            </div>

            {isHost ? (
              <div className="host-controls mt-3">
                <p className="host-message">👑 You are the host!</p>
                <button 
                  className="btn-success btn-large mt-2"
                  onClick={handleStartGame}
                  disabled={room.players.length < 2}
                >
                  {room.players.length < 2 ? 'Need 2+ Players to Start' : '🎮 Start Game'}
                </button>
              </div>
            ) : (
              <p className="waiting-message mt-3">⏳ Waiting for host to start the game...</p>
            )}
          </div>
        </div>
      )}

      {/* Game View */}
      {room.gameStarted && (
        <div className="game-area fade-in">
          {/* Game Over */}
          {room.gameOver && (
            <div className="game-over-modal">
              <div className="card-container">
                <h2>Game Over!</h2>
                <p className="loser-announcement">
                  🫏 {room.loser?.name} is the Kazhutha (Donkey)!
                </p>
                <button 
                  className="btn-primary mt-3"
                  onClick={() => navigate('/')}
                >
                  Back to Home
                </button>
              </div>
            </div>
          )}

          {/* Other Players */}
          <div className="other-players">
            {room.players.map((player, index) => {
              if (player.id === myPlayerId) return null;
              
              const isCurrentTurn = room.currentTurn === index;
              
              return (
                <div 
                  key={player.id} 
                  className={`other-player ${isCurrentTurn ? 'active-turn' : ''} ${player.isSafe ? 'safe' : ''}`}
                >
                  <div className="player-info">
                    <h4>{player.name}</h4>
                    <p>{player.handCount} cards</p>
                    {player.isSafe && <span className="safe-badge">✓ Safe</span>}
                    {isCurrentTurn && <span className="turn-indicator pulse">⏰ Turn</span>}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Center Pile */}
          <div className="center-pile">
            {room.centerPile.length > 0 ? (
              <div className="pile-cards">
                <h4 className="mb-2">Center Pile</h4>
                <div className="cards-row">
                  {room.centerPile.map((play, index) => (
                    <div key={index} className="played-card">
                      <Card card={play.card} size="medium" />
                      <p className="player-name">{play.playerName}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="empty-pile">
                <p>Waiting for cards...</p>
              </div>
            )}
          </div>

          {/* My Hand */}
          {myPlayer && (
            <div className="my-hand-section">
              <div className="hand-header">
                <h3>Your Hand ({myPlayer.hand.length} cards)</h3>
                {myPlayer.isSafe && <span className="safe-badge large">✓ You are Safe!</span>}
                {isMyTurn && !myPlayer.isSafe && (
                  <span className="turn-indicator pulse">⏰ Your Turn</span>
                )}
              </div>
              
              <PlayerHand 
                cards={myPlayer.hand}
                onCardClick={handlePlayCard}
                isMyTurn={isMyTurn && !myPlayer.isSafe}
                leadSuit={room.leadSuit}
              />
            </div>
          )}

          {/* End Game Modal for Host */}
          {isHost && room.gameStarted && (
            <div className="end-game-container">
              <button 
                className="btn-danger btn-large"
                onClick={() => setShowEndGameModal(true)}
              >
                🛑 End Game
              </button>
            </div>
          )}

          {showEndGameModal && (
            <EndGameModal 
              onClose={() => setShowEndGameModal(false)}
              onConfirm={handleEndGame}
              loading={endingGame}
            />
          )}

          {/* Game Ended Overlay */}
          {gameEndedByHost && (
            <GameEndedOverlay 
              reason={gameEndReason}
              onClose={() => {
                setGameEndedByHost(false);
                navigate('/');
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

// Helper function to get suit symbol
function getSuitSymbol(suit) {
  const symbols = {
    hearts: '♥',
    diamonds: '♦',
    clubs: '♣',
    spades: '♠'
  };
  return symbols[suit] || suit;
}

export default GameRoom;
