import io from 'socket.io-client';

// Create a single socket instance to be shared across components
let socket = null;

// Session management
const SESSION_KEY = 'kazhutha_kali_session';

export const saveSession = (sessionId, roomId, playerName) => {
  localStorage.setItem(SESSION_KEY, JSON.stringify({
    sessionId,
    roomId,
    playerName,
    timestamp: Date.now()
  }));
};

export const getSession = () => {
  const data = localStorage.getItem(SESSION_KEY);
  if (!data) return null;
  
  try {
    const session = JSON.parse(data);
    const age = Date.now() - session.timestamp;
    
    // Check if session is < 10 minutes old
    if (age > 10 * 60 * 1000) {
      clearSession();
      return null;
    }
    
    return session;
  } catch (e) {
    clearSession();
    return null;
  }
};

export const clearSession = () => {
  localStorage.removeItem(SESSION_KEY);
};

export const getSocket = () => {
  if (!socket) {
    const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:5000';
    socket = io(SOCKET_URL, {
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000
    });
  }
  return socket;
};

export const attemptReconnection = (sessionId, roomId) => {
  return new Promise((resolve, reject) => {
    const socket = getSocket();
    
    socket.emit('reconnect_player', { sessionId, roomId });
    
    const successHandler = (data) => {
      socket.off('reconnection_failed', failHandler);
      resolve(data);
    };
    
    const failHandler = (data) => {
      socket.off('reconnection_successful', successHandler);
      clearSession();
      reject(data);
    };
    
    socket.once('reconnection_successful', successHandler);
    socket.once('reconnection_failed', failHandler);
    
    // Timeout after 5 seconds
    setTimeout(() => {
      socket.off('reconnection_successful', successHandler);
      socket.off('reconnection_failed', failHandler);
      reject({ reason: 'timeout' });
    }, 5000);
  });
};

export const disconnectSocket = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};
