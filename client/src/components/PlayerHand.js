import React from 'react';
import Card from './Card';
import './PlayerHand.css';

function PlayerHand({ cards, onCardClick, isMyTurn, leadSuit }) {
  // Determine which cards can be played
  const getPlayableCards = () => {
    if (!isMyTurn) return [];
    
    // If no lead suit, all cards are playable
    if (!leadSuit) return cards.map(c => c.id);
    
    // Check if player has any cards of the lead suit
    const hasLeadSuit = cards.some(c => c.suit === leadSuit);
    
    if (hasLeadSuit) {
      // Must play lead suit
      return cards.filter(c => c.suit === leadSuit).map(c => c.id);
    } else {
      // Can play any card (cut)
      return cards.map(c => c.id);
    }
  };

  const playableCardIds = getPlayableCards();

  // Sort cards by suit and value
  const sortedCards = [...cards].sort((a, b) => {
    const suitOrder = { spades: 0, hearts: 1, diamonds: 2, clubs: 3 };
    const valueOrder = { 
      'A': 14, 'K': 13, 'Q': 12, 'J': 11, 
      '10': 10, '9': 9, '8': 8, '7': 7, 
      '6': 6, '5': 5, '4': 4, '3': 3, '2': 2 
    };
    
    if (suitOrder[a.suit] !== suitOrder[b.suit]) {
      return suitOrder[a.suit] - suitOrder[b.suit];
    }
    return valueOrder[b.value] - valueOrder[a.value];
  });

  if (cards.length === 0) {
    return (
      <div className="player-hand empty">
        <p>No cards in hand</p>
      </div>
    );
  }

  return (
    <div className="player-hand">
      <div className="cards-container">
        {sortedCards.map((card) => {
          const canPlay = playableCardIds.includes(card.id);
          
          return (
            <div key={card.id} className="card-wrapper">
              <Card 
                card={card}
                size="large"
                onClick={isMyTurn ? onCardClick : null}
                disabled={!isMyTurn}
                canPlay={canPlay}
              />
              {isMyTurn && !canPlay && (
                <div className="cannot-play-overlay">
                  <span>✗</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
      
      {isMyTurn && leadSuit && (
        <div className="hint-message">
          {cards.some(c => c.suit === leadSuit) 
            ? `Must follow suit: ${getSuitSymbol(leadSuit)}`
            : 'You can play any card (Cut!)'}
        </div>
      )}
    </div>
  );
}

function getSuitSymbol(suit) {
  const symbols = {
    hearts: '♥',
    diamonds: '♦',
    clubs: '♣',
    spades: '♠'
  };
  return symbols[suit] || suit;
}

export default PlayerHand;
