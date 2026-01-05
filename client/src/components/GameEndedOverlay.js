import React, { useState, useEffect } from 'react';
import './GameEndedOverlay.css';

function GameEndedOverlay({ reason, onReturnHome }) {
  const [countdown, setCountdown] = useState(30);
  
  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          if (onReturnHome) {
            onReturnHome();
          } else {
            window.location.href = '/';
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    
    return () => clearInterval(timer);
  }, [onReturnHome]);
  
  const handleReturnNow = () => {
    if (onReturnHome) {
      onReturnHome();
    } else {
      window.location.href = '/';
    }
  };
  
  return (
    <div className="game-ended-overlay">
      <div className="ended-content">
        <h2>🛑 Game Ended by Host</h2>
        {reason && <p className="reason">Reason: {reason}</p>}
        <p className="countdown">Redirecting to home in {countdown} seconds...</p>
        <button 
          onClick={handleReturnNow}
          className="btn-primary"
        >
          Return to Home Now
        </button>
      </div>
    </div>
  );
}

export default GameEndedOverlay;
