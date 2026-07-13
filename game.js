// ===== BLACKJACK GAME LOGIC =====

const SUITS = ['♠', '♥', '♣', '♦'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SUIT_COLORS = { '♠': 'black', '♣': 'black', '♥': 'red', '♦': 'red' };

class Deck {
    constructor() {
        this.cards = [];
        this.reset();
    }

    reset() {
        this.cards = [];
        for (const suit of SUITS) {
            for (const rank of RANKS) {
                this.cards.push({ suit, rank, value: this.getValue(rank) });
            }
        }
        this.shuffle();
    }

    shuffle() {
        for (let i = this.cards.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
        }
    }

    getValue(rank) {
        if (rank === 'A') return 11;
        if (['J', 'Q', 'K'].includes(rank)) return 10;
        return parseInt(rank);
    }

    draw() {
        return this.cards.pop();
    }

    get remaining() {
        return this.cards.length;
    }
}

function calculateHand(hand) {
    let total = 0;
    let aces = 0;
    for (const card of hand) {
        total += card.value;
        if (card.rank === 'A') aces++;
    }
    while (total > 21 && aces > 0) {
        total -= 10;
        aces--;
    }
    return total;
}

function isBlackjack(hand) {
    return hand.length === 2 && calculateHand(hand) === 21;
}

function isSoftHand(hand) {
    let total = 0;
    let aces = 0;
    for (const card of hand) {
        total += card.value;
        if (card.rank === 'A') aces++;
    }
    while (total > 21 && aces > 0) {
        total -= 10;
        aces--;
    }
    return aces > 0;
}

function dealerShouldHit(hand) {
    const total = calculateHand(hand);
    if (total < 17) return true;
    if (total === 17 && isSoftHand(hand)) return true;
    return false;
}

function canSplit(hand) {
    return hand.length === 2 && hand[0].rank === hand[1].rank;
}

function createCardElement(card, hidden = false, index = 0, skipAnimation = false) {
    const div = document.createElement('div');
    div.className = 'card';
    if (skipAnimation) {
        div.style.animation = 'none';
    }
    if (hidden) {
        div.classList.add('card-back');
    } else {
        div.classList.add(SUIT_COLORS[card.suit]);
        div.innerHTML = `
            <div class="card-top">${card.rank}<br>${card.suit}</div>
            <div class="card-center">${card.suit}</div>
            <div class="card-bottom">${card.rank}<br>${card.suit}</div>
        `;
    }
    div.style.setProperty('--rotation', `${(index - 1) * 3}deg`);
    return div;
}

function createCardElementWithAnimation(card, hidden = false, index = 0) {
    const div = createCardElement(card, hidden, index, true);
    div.style.animation = 'dealCard 0.4s ease-out';
    return div;
}

function createChipElement(value) {
    const div = document.createElement('div');
    let colorClass = 'chip-10';
    if (value >= 100) colorClass = 'chip-100';
    else if (value >= 50) colorClass = 'chip-50';
    else if (value >= 25) colorClass = 'chip-25';
    div.className = `chip ${colorClass}`;
    div.textContent = value;
    return div;
}

// Rozkłada kwotę na żetony (100/50/25/10 + ewentualna reszta)
function chipDenominationsFor(amount) {
    const values = [100, 50, 25, 10];
    const result = [];
    let remaining = Math.round(amount);
    for (const v of values) {
        while (remaining >= v) {
            result.push(v);
            remaining -= v;
        }
    }
    if (remaining > 0) result.push(remaining);
    return result;
}

// Fizycznie animuje pojedynczy element żetonu z jednego miejsca w drugie, po czym go usuwa
function flyChipBetween(chipEl, fromRect, toRect, onArrive) {
    document.body.appendChild(chipEl);
    chipEl.style.position = 'fixed';
    chipEl.style.left = fromRect.left + 'px';
    chipEl.style.top = fromRect.top + 'px';
    chipEl.style.margin = '0';
    chipEl.style.zIndex = '600';
    chipEl.style.animation = 'none';
    chipEl.style.transition = 'none';
    void chipEl.offsetWidth; // wymuszenie reflow przed startem animacji
    requestAnimationFrame(() => {
        chipEl.style.transition = 'transform 0.5s cubic-bezier(0.4,0,0.2,1), opacity 0.5s ease-in';
        const dx = (toRect.left + toRect.width / 2) - (fromRect.left + fromRect.width / 2);
        const dy = (toRect.top + toRect.height / 2) - (fromRect.top + fromRect.height / 2);
        chipEl.style.transform = `translate(${dx}px, ${dy}px) scale(0.5)`;
        chipEl.style.opacity = '0.2';
    });
    setTimeout(() => {
        chipEl.remove();
        if (onArrive) onArrive();
    }, 520);
}

// Tworzy jeden nowy żeton i animuje go z fromEl do toEl; deposit=true zostawia trwały żeton w toEl po dolocie
function flyChip(value, fromEl, toEl, deposit, onArrive) {
    if (!fromEl || !toEl) {
        if (deposit && toEl) toEl.appendChild(createChipElement(value));
        if (onArrive) onArrive();
        return;
    }
    const chipEl = createChipElement(value);
    const fromRect = fromEl.getBoundingClientRect();
    const toRect = toEl.getBoundingClientRect();
    flyChipBetween(chipEl, fromRect, toRect, () => {
        if (deposit) toEl.appendChild(createChipElement(value));
        if (onArrive) onArrive();
    });
}

// Animuje ISTNIEJĄCE żetony z kontenera źródłowego do celu, po kolei, znikają po dotarciu (np. wypłata/przegrana)
function flyContainerChipsTo(sourceEl, destEl, onAllDone) {
    if (!sourceEl) { if (onAllDone) onAllDone(); return; }
    const chips = Array.from(sourceEl.children);
    if (chips.length === 0) { if (onAllDone) onAllDone(); return; }
    const destRect = destEl ? destEl.getBoundingClientRect() : null;
    let remaining = chips.length;
    chips.forEach((chipEl, idx) => {
        setTimeout(() => {
            const fromRect = chipEl.getBoundingClientRect();
            flyChipBetween(chipEl, fromRect, destRect || fromRect, () => {
                remaining--;
                if (remaining === 0 && onAllDone) onAllDone();
            });
        }, idx * 120);
    });
}

// Rozkłada kwotę na żetony i animuje je pojedynczo (po kolei) z fromEl do toEl
function flyNewChipsAmount(amount, fromEl, toEl, deposit, onAllDone) {
    const denominations = chipDenominationsFor(amount);
    if (denominations.length === 0) { if (onAllDone) onAllDone(); return; }
    let remaining = denominations.length;
    denominations.forEach((value, idx) => {
        setTimeout(() => {
            flyChip(value, fromEl, toEl, deposit, () => {
                remaining--;
                if (remaining === 0 && onAllDone) onAllDone();
            });
        }, idx * 120);
    });
}

// ===== SINGLEPLAYER GAME =====

let spDeck = null;
let spPlayerHand = [];
let spDealerHand = [];
let spPlayerChips = 500;
let spCurrentBet = 0;
let spGameActive = false;
let spPlayerStood = false;
let spSplitHands = null;
let spCurrentSplitHand = 0;
let spCardsDealt = false; // Flaga czy karty zostały już rozdane (animacja)

function initSingleplayer() {
    spPlayerChips = 500;
    spCurrentBet = 0;
    spGameActive = false;
    spCardsDealt = false;
    updateSingleplayerUI();
    showBettingControls();
}

function updateSingleplayerUI() {
    document.getElementById('player-chips').textContent = spPlayerChips;
    document.getElementById('current-bet').textContent = spCurrentBet;
    
    const playerCards = document.getElementById('player-cards');
    const dealerCards = document.getElementById('dealer-cards');
    const dealerStatus = document.getElementById('dealer-status');
    
    const playerTotal = calculateHand(spPlayerHand);
    const dealerTotal = calculateHand(spDealerHand);
    const gameEnded = !spGameActive && spDealerHand.length > 0;
    
    // Określ wynik gry dla efektów wizualnych
    let playerResult = '';
    if (gameEnded && !spSplitHands) {
        if (playerTotal > 21) playerResult = 'lose';
        else if (dealerTotal > 21 || playerTotal > dealerTotal) playerResult = 'win';
        else if (playerTotal < dealerTotal) playerResult = 'lose';
        else playerResult = 'push';
    }
    
    // Aktualizuj karty gracza - tylko jeśli się zmieniły lub przy pierwszym rozdaniu
    if (spPlayerHand.length > 0 || spSplitHands) {
        // Sprawdź czy karty się zmieniły (porównaj liczbę kart)
        const currentPlayerCards = playerCards.children.length;
        const expectedCards = spSplitHands ? spSplitHands.reduce((sum, h) => sum + h.length, 0) : spPlayerHand.length;
        
        if (currentPlayerCards !== expectedCards || !spCardsDealt) {
            playerCards.innerHTML = '';
            
            if (spSplitHands) {
                for (let i = 0; i < spSplitHands.length; i++) {
                    const handDiv = document.createElement('div');
                    const handTotal = calculateHand(spSplitHands[i]);
                    const isBust = handTotal > 21;
                    const isActive = i === spCurrentSplitHand && spGameActive;
                    
                    // Określ wynik dla tej ręki
                    let handResult = '';
                    if (gameEnded) {
                        if (isBust) handResult = 'bust';
                        else if (dealerTotal > 21 || handTotal > dealerTotal) handResult = 'win';
                        else if (handTotal < dealerTotal) handResult = 'lose';
                        else handResult = 'push';
                    }
                    
                    handDiv.className = 'split-hand';
                    if (isActive) handDiv.classList.add('active');
                    if (handResult) handDiv.classList.add(handResult);
                    
                    // Dodaj etykietę ręki
                    const label = document.createElement('div');
                    label.className = 'split-hand-label';
                    label.textContent = `Ręka ${i+1}: ${handTotal}${isBust ? ' BUST!' : ''}`;
                    handDiv.appendChild(label);
                    
                    spSplitHands[i].forEach((card, idx) => {
                        const cardEl = createCardElement(card, false, idx);
                        // Efekt końcowy dla kart
                        if (gameEnded && handResult) {
                            cardEl.classList.add(handResult === 'win' ? 'win-effect' : (handResult === 'push' ? 'push-effect' : 'lose-effect'));
                        }
                        handDiv.appendChild(cardEl);
                    });
                    playerCards.appendChild(handDiv);
                }
                document.getElementById('player-score').textContent = '';
            } else {
                spPlayerHand.forEach((card, idx) => {
                    const cardEl = createCardElement(card, false, idx);
                    // Efekt końcowy dla kart gracza
                    if (gameEnded && spPlayerHand.length > 0 && playerResult) {
                        cardEl.classList.add(playerResult === 'win' ? 'win-effect' : (playerResult === 'push' ? 'push-effect' : 'lose-effect'));
                    }
                    playerCards.appendChild(cardEl);
                });
                document.getElementById('player-score').textContent = spGameActive || spPlayerHand.length > 0 ? calculateHand(spPlayerHand) : '';
            }
        }
    } else if (playerCards.children.length > 0) {
        playerCards.innerHTML = '';
        document.getElementById('player-score').textContent = '';
    }
    
    // Aktualizuj karty dealera - tylko jeśli się zmieniły
    const currentDealerCards = dealerCards.children.length;
    const expectedDealerCards = spDealerHand.length;
    
    if (currentDealerCards !== expectedDealerCards || !spCardsDealt) {
        dealerCards.innerHTML = '';
        
        const isDealerBust = dealerTotal > 21;
        
        spDealerHand.forEach((card, idx) => {
            const hidden = idx === 1 && spGameActive && !spPlayerStood;
            // Nie animuj kart dealera podczas jego tury (animacja jest pokazywana osobno w centrum)
            const skipAnim = spGameActive && spPlayerStood && idx === spDealerHand.length - 1 && spDealerHand.length > 2;
            const cardEl = createCardElement(card, hidden, idx, skipAnim);
            
            // Efekt "dealer-active" do ostatniej karty dealera jeśli gra trwa
            if (spGameActive && spPlayerStood && idx === spDealerHand.length - 1 && spDealerHand.length > 2) {
                cardEl.classList.add('dealer-active');
                setTimeout(() => cardEl.classList.remove('dealer-active'), 1500);
            }
            
            // Efekt końcowy - zielona ramka jeśli dealer wygrał, czerwona jeśli przegrał
            if (gameEnded && !hidden) {
                if (isDealerBust) {
                    cardEl.classList.add('lose-effect');
                } else {
                    cardEl.classList.add('push-effect');
                }
            }
            
            dealerCards.appendChild(cardEl);
        });
    } else {
        // Tylko odkryj ukrytą kartę dealera jeśli gra się skończyła
        if (gameEnded && spDealerHand.length > 1) {
            const hiddenCard = dealerCards.children[1];
            if (hiddenCard && hiddenCard.classList.contains('card-back')) {
                const card = spDealerHand[1];
                hiddenCard.className = 'card ' + SUIT_COLORS[card.suit] + ' flip-reveal';
                hiddenCard.innerHTML = `
                    <div class="card-top">${card.rank}<br>${card.suit}</div>
                    <div class="card-center">${card.suit}</div>
                    <div class="card-bottom">${card.rank}<br>${card.suit}</div>
                `;
            }
        }
    }
    
    // Pokazuj sumę dealera gdy: gra trwa i dealer gra, LUB gra się skończyła
    const showDealerTotal = (spGameActive && spPlayerStood) || gameEnded;
    document.getElementById('dealer-score').textContent = showDealerTotal ? dealerTotal : (spDealerHand.length > 0 ? calculateHand([spDealerHand[0]]) : '');
    
    // Aktualizuj status dealera (bez dotykania kart!)
    if (spGameActive && spPlayerStood) {
        if (dealerShouldHit(spDealerHand)) {
            dealerStatus.textContent = 'Dobiera...';
        } else if (dealerTotal > 21) {
            dealerStatus.textContent = 'BUST! 💥';
        } else {
            dealerStatus.textContent = 'Stoi.';
        }
    } else if (gameEnded) {
        dealerStatus.textContent = `Wynik: ${dealerTotal}`;
    } else {
        dealerStatus.textContent = '';
    }
}

function placeBet(amount) {
    if (spGameActive) return;
    if (spCurrentBet + amount > spPlayerChips) {
        showMessage('Nie masz wystarczająco żetonów!');
        return;
    }
    if (spCurrentBet + amount < 10) {
        showMessage('Minimalny zakład to 10!');
        return;
    }
    spCurrentBet += amount;
    updateSingleplayerUI();

    const sourceBtn = document.querySelector('.chip-btn.chip-' + amount);
    const pot = document.getElementById('pot-area');
    flyChip(amount, sourceBtn, pot, true);
}

function clearBet() {
    if (spGameActive) return;
    spCurrentBet = 0;
    // Wyczyść karty gdy wyczyścimy bet przed rozdaniem
    spPlayerHand = [];
    spDealerHand = [];
    spPlayerStood = false;
    spSplitHands = null;
    spCurrentSplitHand = 0;
    spCardsDealt = false;
    updateSingleplayerUI();
    updatePotArea();
    // Nie czyść komunikatu - może to być wynik gry
    document.getElementById('dealer-status').textContent = '';
}

function updatePotArea() {
    const pot = document.getElementById('pot-area');
    pot.innerHTML = '';
    chipDenominationsFor(spCurrentBet).forEach(v => pot.appendChild(createChipElement(v)));
}

function showMessage(msg, type = '') {
    const el = document.getElementById('game-message');
    
    // Wyczyść poprzedni timeout jeśli istnieje
    if (el._timeoutId) {
        clearTimeout(el._timeoutId);
    }
    
    el.textContent = msg;
    el.className = 'message-area' + (type ? ' ' + type : '');
    
    // Dłuższy czas wyświetlania dla komunikatów końcowych i dealera
    let displayTime = 3000;
    if (type === 'win-message' || type === 'lose-message') {
        displayTime = 8000; // Jeszcze dłużej dla wyników
    } else if (type === 'push-message' && msg.includes('Dealer')) {
        displayTime = 4000;
    }
    
    el._timeoutId = setTimeout(() => {
        if (el.textContent === msg) {
            el.textContent = '';
            el.className = 'message-area';
        }
    }, displayTime);
}

function showBettingControls() {
    document.getElementById('betting-controls').style.display = 'flex';
    document.getElementById('game-controls').style.display = 'none';
    // Wyczyść karty przy powrocie do betowania
    if (!spGameActive) {
        spPlayerHand = [];
        spDealerHand = [];
        spPlayerStood = false;
        spSplitHands = null;
        spCurrentSplitHand = 0;
        spCardsDealt = false;
        updateSingleplayerUI();
        updatePotArea();
        // Nie czyść komunikatu - wynik powinien być widoczny
        document.getElementById('dealer-status').textContent = '';
    }
}

function showGameControls() {
    document.getElementById('betting-controls').style.display = 'none';
    document.getElementById('game-controls').style.display = 'flex';
}

function deal() {
    if (spCurrentBet < 10) {
        showMessage('Minimalny zakład to 10!');
        return;
    }
    if (spCurrentBet > spPlayerChips) {
        showMessage('Nie masz wystarczająco żetonów!');
        return;
    }
    
    spPlayerChips -= spCurrentBet;
    spDeck = new Deck();
    spPlayerHand = [spDeck.draw(), spDeck.draw()];
    spDealerHand = [spDeck.draw(), spDeck.draw()];
    spGameActive = true;
    spPlayerStood = false;
    spSplitHands = null;
    spCurrentSplitHand = 0;
    spCardsDealt = false; // Reset flagi animacji
    
    updateSingleplayerUI();
    spCardsDealt = true; // Po pierwszej aktualizacji karty są "rozłożone"
    showGameControls();
    
    const playerHasBlackjack = isBlackjack(spPlayerHand);
    const dealerHasBlackjack = isBlackjack(spDealerHand);
    if (playerHasBlackjack || dealerHasBlackjack) {
        resolveNaturalBlackjack(playerHasBlackjack, dealerHasBlackjack);
    } else {
        updateButtons();
    }
}

// Animuje żetony z puli w stronę gracza (wygrana/push) lub dealera (przegrana) po rozstrzygnięciu rundy
function animateRoundChips(messageType, totalBet, totalCredited) {
    const potEl = document.getElementById('pot-area');
    const chipsDisplay = document.getElementById('player-chips');
    const dealerAreaEl = document.getElementById('dealer-area');

    if (messageType === 'lose-message') {
        flyContainerChipsTo(potEl, dealerAreaEl);
    } else if (messageType === 'push-message') {
        flyContainerChipsTo(potEl, chipsDisplay);
    } else if (messageType === 'win-message') {
        flyContainerChipsTo(potEl, chipsDisplay);
        const profit = totalCredited - totalBet;
        if (profit > 0) {
            flyNewChipsAmount(profit, dealerAreaEl, chipsDisplay, false);
        }
    }
}

function resolveNaturalBlackjack(playerHasBlackjack, dealerHasBlackjack) {
    document.getElementById('game-controls').style.display = 'none';
    document.getElementById('betting-controls').style.display = 'none';

    spPlayerStood = true;
    updateSingleplayerUI();

    const betAmount = spCurrentBet;
    let message = '';
    let messageType = '';
    let winAmount = 0;

    if (playerHasBlackjack && dealerHasBlackjack) {
        spPlayerChips += betAmount;
        message = `🤝 Push`;
        messageType = 'push-message';
    } else if (playerHasBlackjack) {
        winAmount = Math.floor(betAmount * 2.5);
        spPlayerChips += winAmount;
        message = `🎉 +${winAmount - betAmount}`;
        messageType = 'win-message';
    } else {
        message = `😞 -${betAmount}`;
        messageType = 'lose-message';
    }

    showMessage(message, messageType);
    animateRoundChips(messageType, betAmount, winAmount);

    spGameActive = false;
    spCurrentBet = 0;
    updateSingleplayerUI();

    setTimeout(() => {
        spPlayerHand = [];
        spDealerHand = [];
        spPlayerStood = false;
        spSplitHands = null;
        spCurrentSplitHand = 0;
        spCardsDealt = false;
        updateSingleplayerUI();
        updatePotArea();
        document.getElementById('dealer-status').textContent = '';
        document.getElementById('betting-controls').style.display = 'flex';
        document.getElementById('game-controls').style.display = 'none';
    }, 4000);
}

function updateButtons() {
    const doubleBtn = document.getElementById('btn-double');
    const splitBtn = document.getElementById('btn-split');
    
    doubleBtn.disabled = !!spSplitHands || spPlayerHand.length !== 2 || spPlayerChips < spCurrentBet;
    splitBtn.style.display = canSplit(spPlayerHand) && !spSplitHands ? 'inline-block' : 'none';
    splitBtn.disabled = spPlayerChips < spCurrentBet;
}

function playerHit() {
    if (!spGameActive) return;
    
    if (spSplitHands) {
        spSplitHands[spCurrentSplitHand].push(spDeck.draw());
        const total = calculateHand(spSplitHands[spCurrentSplitHand]);
        if (total > 21) {
            showMessage('Bust! Ręka ' + (spCurrentSplitHand + 1) + ' przegrana.');
            spCurrentSplitHand++;
            if (spCurrentSplitHand >= spSplitHands.length) {
                spPlayerStood = true;
                setTimeout(() => {
                    dealerTurn();
                }, 1500);
            }
        }
    } else {
        spPlayerHand.push(spDeck.draw());
        const total = calculateHand(spPlayerHand);
        if (total > 21) {
            // Pokaż wynik natychmiast gdy BUST
            endSingleplayerGame(false);
            return;
        }
    }
    
    updateSingleplayerUI();
    updateButtons();
}

function playerStand() {
    if (!spGameActive) return;
    
    if (spSplitHands) {
        spCurrentSplitHand++;
        if (spCurrentSplitHand < spSplitHands.length) {
            updateSingleplayerUI();
            updateButtons();
            return;
        }
    }
    
    spPlayerStood = true;
    dealerTurn();
}

function playerDouble() {
    if (!spGameActive || spSplitHands || spPlayerHand.length !== 2 || spPlayerChips < spCurrentBet) return;

    const additionalBet = spCurrentBet;
    spPlayerChips -= spCurrentBet;
    spCurrentBet *= 2;
    spPlayerHand.push(spDeck.draw());

    const chipsDisplay = document.getElementById('player-chips');
    const pot = document.getElementById('pot-area');
    flyNewChipsAmount(additionalBet, chipsDisplay, pot, true);

    updateSingleplayerUI();
    
    const total = calculateHand(spPlayerHand);
    if (total > 21) {
        // Pokaż wynik natychmiast gdy BUST po double
        endSingleplayerGame(false);
    } else {
        spPlayerStood = true;
        setTimeout(() => {
            dealerTurn();
        }, 1000);
    }
}

function playerSplit() {
    if (!spGameActive || !canSplit(spPlayerHand) || spPlayerChips < spCurrentBet) return;
    
    spPlayerChips -= spCurrentBet;
    spSplitHands = [
        [spPlayerHand[0], spDeck.draw()],
        [spPlayerHand[1], spDeck.draw()]
    ];
    spCurrentSplitHand = 0;
    
    updateSingleplayerUI();
    updateButtons();
}

function dealerTurn() {
    // Ukryj kontrolki gry - teraz gra dealer
    document.getElementById('game-controls').style.display = 'none';
    document.getElementById('betting-controls').style.display = 'none';
    
    // Odkryj kartę dealera najpierw
    const dealerCards = document.getElementById('dealer-cards');
    const hiddenCard = dealerCards.children[1];
    if (hiddenCard && hiddenCard.classList.contains('card-back')) {
        hiddenCard.classList.add('flip-reveal');
        setTimeout(() => {
            const card = spDealerHand[1];
            hiddenCard.className = 'card ' + SUIT_COLORS[card.suit] + ' flip-reveal';
            hiddenCard.innerHTML = `
                <div class="card-top">${card.rank}<br>${card.suit}</div>
                <div class="card-center">${card.suit}</div>
                <div class="card-bottom">${card.rank}<br>${card.suit}</div>
            `;
        }, 400);
    }
    
    setTimeout(() => {
        const dealerTotal = calculateHand(spDealerHand);
        if (!dealerShouldHit(spDealerHand)) {
            updateSingleplayerUI();
            setTimeout(() => {
                resolveSingleplayerGame(true);
            }, 1500);
            return;
        }
        
        showMessage(`Dealer: ${dealerTotal} - dobiera`, 'push-message');
        updateSingleplayerUI();
        
        // Funkcja do pokazania karty w centrum ekranu, a potem dodania do ręki
        function animateDealerCard(card, onComplete) {
            // Stwórz kontener na środku ekranu
            const revealContainer = document.createElement('div');
            revealContainer.className = 'dealer-card-reveal';
            
            const cardEl = document.createElement('div');
            cardEl.className = 'card ' + SUIT_COLORS[card.suit];
            cardEl.innerHTML = `
                <div class="card-top">${card.rank}<br>${card.suit}</div>
                <div class="card-center">${card.suit}</div>
                <div class="card-bottom">${card.rank}<br>${card.suit}</div>
            `;
            revealContainer.appendChild(cardEl);
            document.body.appendChild(revealContainer);
            
            // Po 1.5s (karta jest widoczna w centrum) dodaj do ręki dealera
            setTimeout(() => {
                document.body.removeChild(revealContainer);
                if (onComplete) onComplete();
            }, 1500);
        }
        
        setTimeout(() => {
            const dealerInterval = setInterval(() => {
                if (dealerShouldHit(spDealerHand)) {
                    // Dobierz kartę
                    const newCard = spDeck.draw();
                    spDealerHand.push(newCard);
                    
                    // Pokaż animację karty w centrum
                    animateDealerCard(newCard, () => {
                        // Po animacji zaktualizuj UI
                        updateSingleplayerUI();
                        const newTotal = calculateHand(spDealerHand);
                        
                        if (newTotal > 21) {
                            showMessage('Dealer BUST!', 'win-message');
                            setTimeout(() => {
                                resolveSingleplayerGame(true);
                            }, 2000);
                            clearInterval(dealerInterval);
                        } else if (!dealerShouldHit(spDealerHand)) {
                            // Dealer skończył, pokaż wynik
                            setTimeout(() => {
                                resolveSingleplayerGame(true);
                            }, 2000);
                            clearInterval(dealerInterval);
                        }
                    });
                } else {
                    clearInterval(dealerInterval);
                    setTimeout(() => {
                        resolveSingleplayerGame(true);
                    }, 1500);
                }
            }, 3000); // 3s na cały cykl (1.5s animacja + 1.5s pauza)
        }, 1000);
    }, 800);
}

function resolveSingleplayerGame(fromDealerTurn = false) {
    const playerTotal = calculateHand(spPlayerHand);
    const dealerTotal = calculateHand(spDealerHand);
    const betAmount = spCurrentBet;

    let message = '';
    let messageType = '';
    let totalBet = betAmount;
    let totalCredited = 0;

    if (spSplitHands) {
        let winChips = 0;
        totalBet = spSplitHands.length * betAmount;
        for (let i = 0; i < spSplitHands.length; i++) {
            const hand = spSplitHands[i];
            const total = calculateHand(hand);
            if (total > 21) {
                // strata
            } else if (dealerTotal > 21 || total > dealerTotal) {
                winChips += betAmount * 2;
            } else if (total < dealerTotal) {
                // strata
            } else {
                winChips += betAmount;
            }
        }
        spPlayerChips += winChips;
        totalCredited = winChips;

        const netResult = winChips - totalBet;
        if (netResult > 0) {
            message = `🎉 +${netResult}`;
            messageType = 'win-message';
        } else if (netResult < 0) {
            message = `😞 ${netResult}`;
            messageType = 'lose-message';
        } else {
            message = `🤝 Push`;
            messageType = 'push-message';
        }
    } else {
        if (isBlackjack(spPlayerHand)) {
            const winAmount = Math.floor(betAmount * 2.5);
            spPlayerChips += winAmount;
            message = `🎉 +${winAmount - betAmount}`;
            messageType = 'win-message';
            totalCredited = winAmount;
        } else if (playerTotal > 21) {
            message = `😞 -${betAmount}`;
            messageType = 'lose-message';
        } else if (dealerTotal > 21) {
            const winAmount = betAmount * 2;
            spPlayerChips += winAmount;
            message = `🎉 +${winAmount - betAmount}`;
            messageType = 'win-message';
            totalCredited = winAmount;
        } else if (playerTotal > dealerTotal) {
            const winAmount = betAmount * 2;
            spPlayerChips += winAmount;
            message = `🎉 +${winAmount - betAmount}`;
            messageType = 'win-message';
            totalCredited = winAmount;
        } else if (playerTotal < dealerTotal) {
            message = `😞 -${betAmount}`;
            messageType = 'lose-message';
        } else {
            const winAmount = betAmount;
            spPlayerChips += winAmount;
            message = `🤝 Push`;
            messageType = 'push-message';
            totalCredited = winAmount;
        }
    }

    // Zawsze pokazuj wynik końcowy, nadpisując poprzedni komunikat
    showMessage(message, messageType);
    animateRoundChips(messageType, totalBet, totalCredited);

    spGameActive = false;
    spCurrentBet = 0;
    updateSingleplayerUI();
    
    // Poczekaj z wyczyszczeniem kart aby wynik był widoczny
    setTimeout(() => {
        // Wyczyść karty i pokaż kontrolki betowania
        spPlayerHand = [];
        spDealerHand = [];
        spPlayerStood = false;
        spSplitHands = null;
        spCurrentSplitHand = 0;
        spCardsDealt = false;
        updateSingleplayerUI();
        updatePotArea();
        document.getElementById('dealer-status').textContent = '';
        document.getElementById('betting-controls').style.display = 'flex';
        document.getElementById('game-controls').style.display = 'none';
    }, 4000);
}

function endSingleplayerGame(playerWins) {
    // Ukryj kontrolki gry - gra się skończyła
    document.getElementById('game-controls').style.display = 'none';
    document.getElementById('betting-controls').style.display = 'none';
    
    spPlayerStood = true;
    updateSingleplayerUI();

    const betAmount = spCurrentBet;
    let message = '';
    let messageType = '';
    let totalCredited = 0;

    if (playerWins) {
        const winAmount = betAmount * 2;
        spPlayerChips += winAmount;
        message = `🎉 +${winAmount - betAmount}`;
        messageType = 'win-message';
        totalCredited = winAmount;
    } else {
        message = `😞 -${betAmount}`;
        messageType = 'lose-message';
    }

    showMessage(message, messageType);
    animateRoundChips(messageType, betAmount, totalCredited);

    spGameActive = false;
    spCurrentBet = 0;
    updateSingleplayerUI();
    
    // Poczekaj z wyczyszczeniem kart aby wynik był widoczny
    setTimeout(() => {
        // Wyczyść karty i pokaż kontrolki betowania
        spPlayerHand = [];
        spDealerHand = [];
        spPlayerStood = false;
        spSplitHands = null;
        spCurrentSplitHand = 0;
        spCardsDealt = false;
        updateSingleplayerUI();
        updatePotArea();
        document.getElementById('dealer-status').textContent = '';
        document.getElementById('betting-controls').style.display = 'flex';
        document.getElementById('game-controls').style.display = 'none';
    }, 4000);
}
