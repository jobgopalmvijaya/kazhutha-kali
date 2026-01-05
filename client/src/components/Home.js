import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSocket } from '../services/socket';
import './Home.css';

function Home() {
  const [playerName, setPlayerName] = useState('');
  const [roomIdInput, setRoomIdInput] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const socket = getSocket();
  
  // Use ref to store playerName so we don't need it in useEffect dependencies
  const playerNameRef = useRef(playerName);
  
  // Update ref when playerName changes
  useEffect(() => {
    playerNameRef.current = playerName;
  }, [playerName]);

  useEffect(() => {
    // Set up socket listeners ONCE
    const handleRoomCreated = ({ roomId }) => {
      console.log('Room created with ID:', roomId);
      navigate(`/room/${roomId}`, { state: { playerName: playerNameRef.current, isHost: true } });
    };

    socket.on('room_created', handleRoomCreated);

    return () => {
      socket.off('room_created', handleRoomCreated);
    };
  }, [navigate, socket]); // Only depend on navigate and socket

  const handleCreateRoom = () => {
    if (!playerName.trim()) {
      setError('Please enter your name');
      return;
    }

    console.log('Creating room with name:', playerName);
    socket.emit('create_room', playerName);
  };

  const handleJoinRoom = () => {
    if (!playerName.trim()) {
      setError('Please enter your name');
      return;
    }

    if (!roomIdInput.trim()) {
      setError('Please enter a room ID');
      return;
    }

    // Pass player name to GameRoom
    navigate(`/room/${roomIdInput}`, { state: { playerName } });
  };

  return (
    <div className="home-container">
      <div className="home-content fade-in">
        <h1 className="game-title">🃏 Kazhutha Kali</h1>
        <p className="game-subtitle">The Traditional Kerala Card Game</p>

        <div className="card-container mt-4">
          <div className="input-group">
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
                if (e.key === 'Enter') handleCreateRoom();
              }}
            />
          </div>

          {error && <p className="error-message">{error}</p>}

          <div className="button-group mt-3">
            <button 
              className="btn-primary btn-large"
              onClick={handleCreateRoom}
            >
              Create New Room
            </button>

            <div className="divider">
              <span>OR</span>
            </div>

            <div className="input-group">
              <label>Room ID</label>
              <input
                type="text"
                placeholder="Enter room ID"
                value={roomIdInput}
                onChange={(e) => {
                  setRoomIdInput(e.target.value);
                  setError('');
                }}
                onKeyPress={(e) => {
                  if (e.key === 'Enter') handleJoinRoom();
                }}
              />
            </div>

            <button 
              className="btn-secondary btn-large"
              onClick={handleJoinRoom}
            >
              Join Room
            </button>
          </div>
        </div>

        <div className="rules-section mt-4">
          <h3>How to Play</h3>
          <ul>
            <li>🎯 Don't be the last player with cards!</li>
            <li>🃏 Follow the lead suit if you have it</li>
            <li>👑 Ace is the highest card</li>
            <li>✂️ "Pani" (Cut) - Play a different suit to punish the highest lead card player</li>
            <li>🏆 Empty your hand to be "Safe"</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

export default Home;
