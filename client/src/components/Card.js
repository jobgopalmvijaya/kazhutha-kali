import React from 'react';
import './Card.css';

function Card({ card, size = 'medium', onClick, disabled = false, canPlay = true }) {
  const isRed = card.suit === 'hearts' || card.suit === 'diamonds';
  
  const getSuitSymbol = () => {
    const symbols = {
      hearts: '♥',
      diamonds: '♦',
      clubs: '♣',
      spades: '♠'
    };
    return symbols[card.suit];
  };

  const handleClick = () => {
    if (!disabled && onClick && canPlay) {
      onClick(card);
    }
  };

  return (
    <div 
      className={`playing-card ${size} ${isRed ? 'red' : 'black'} ${!canPlay ? 'disabled' : ''} ${onClick && !disabled && canPlay ? 'clickable' : ''}`}
      onClick={handleClick}
    >
      <div className="card-corner top-left">
        <div className="card-value">{card.value}</div>
        <div className="card-suit">{getSuitSymbol()}</div>
      </div>
      
      <div className="card-center">
        <span className="card-suit-large">{getSuitSymbol()}</span>
      </div>
      
      <div className="card-corner bottom-right">
        <div className="card-value">{card.value}</div>
        <div className="card-suit">{getSuitSymbol()}</div>
      </div>
    </div>
  );
}

export default Card;
