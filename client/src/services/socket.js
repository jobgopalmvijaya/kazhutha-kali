import io from 'socket.io-client';

// Create a single socket instance to be shared across components
let socket = null;

export const getSocket = () => {
  if (!socket) {
    const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:5000';
    socket = io(SOCKET_URL);
  }
  return socket;
};

export const disconnectSocket = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};
