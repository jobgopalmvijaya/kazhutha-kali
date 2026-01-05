import React, { useState } from 'react';
import './EndGameModal.css';

function EndGameModal({ onConfirm, onCancel, isEnding }) {
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  
  const reasons = [
    'Game needs to be cancelled',
    'Technical issues',
    'Player left',
    'Restart needed',
    'Other'
  ];
  
  const handleConfirm = () => {
    if (!confirmed) {
      alert('Please confirm you want to end the game');
      return;
    }
    onConfirm(reason);
  };
  
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h2>End Game?</h2>
        <p className="warning">
          ⚠️ This will end the game for all players
        </p>
        
        <div className="reason-select">
          <label>Reason (optional):</label>
          <select 
            value={reason} 
            onChange={(e) => setReason(e.target.value)}
            disabled={isEnding}
          >
            <option value="">Select a reason...</option>
            {reasons.map(r => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>
        
        <div className="confirmation">
          <label>
            <input 
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              disabled={isEnding}
            />
            I confirm I want to end this game
          </label>
        </div>
        
        <div className="modal-actions">
          <button 
            onClick={onCancel}
            disabled={isEnding}
            className="btn-secondary"
          >
            Cancel
          </button>
          <button 
            onClick={handleConfirm}
            disabled={isEnding || !confirmed}
            className="btn-danger"
          >
            {isEnding ? 'Ending...' : 'End Game'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default EndGameModal;
