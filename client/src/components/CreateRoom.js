import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import io from 'socket.io-client';
import './CreateRoom.css';

let socket;

function CreateRoom() {
  const navigate = useNavigate();
  const location = useLocation();
  const playerName = location.state?.playerName;
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    // Redirect to home if no player name provided
    if (!playerName) {
      navigate('/');
      return;
    }

    // Create socket connection
    socket = io('http://localhost:5000');

    socket.on('connect', () => {
      console.log('Connected, creating room...');
      setIsCreating(true);
      // Create room with the provided player name
      socket.emit('create_room', playerName);
    });

    socket.on('room_created', ({ roomId, room }) => {
      console.log('Room created:', roomId);
      // Navigate to the game room - socket is already connected and we're the host
      navigate(`/room/${roomId}`, { 
        replace: true,
        state: { 
          socketId: socket.id,
          alreadyJoined: true 
        } 
      });
    });

    socket.on('error', ({ message }) => {
      console.error('Error creating room:', message);
      alert('Error creating room: ' + message);
      navigate('/');
    });

    return () => {
      // Don't disconnect - we need this socket for the game room
      // socket.disconnect();
    };
  }, [playerName, navigate]);

  return (
    <div className="create-room-container">
      <div className="create-room-content fade-in">
        <div className="card-container text-center">
          <h2>Creating Room...</h2>
          <div className="loading-spinner mt-3">
            <div className="spinner"></div>
            <p className="mt-2">Setting up room for <strong>{playerName}</strong></p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default CreateRoom;

// Export socket so GameRoom can use the same instance
export { socket };
