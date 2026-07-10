// ===== PEERJS MULTIPLAYER - NOWA WERSJA =====

const PEER_CONFIG = {
    debug: 0,
    config: {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun.cloudflare.com:3478' },
            {
                urls: 'turn:openrelay.metered.ca:80',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            }
        ]
    }
};

// Stan gry multiplayer
let mpPeer = null;
let mpMyId = null;
let mpIsHost = false;
let mpCode = null;
let mpConns = []; // aktywne połączenia
let mpAllPlayers = {}; // wszyscy gracze (id -> {name, chips, bet, hand, status, isHost})
let mpMyName = 'Gracz' + Math.floor(Math.random() * 100);
let mpDeck = null;
let mpDealerHand = [];
let mpPhase = 'betting'; // betting, playing, insurance, dealer, results
let mpCurrentPlayerIndex = -1;
let mpCurrentPlayerId = null; // id gracza który aktualnie ma turę
let mpGameStarted = false;
let mpLastRenderedHandCount = {}; // Track hand sizes to avoid re-animating cards
let mpLastDealerHandCount = 0; // Track dealer hand size for animation
let mpHintsEnabled = false; // Podpowiedzi Basic Strategy
let mpDotKeyCount = 0; // Licznik klawisza '.'
let mpDotKeyTimer = null; // Timer resetu licznika
let mpCurrentSplitHand = {}; // Śledzenie aktualnej ręki split per gracz (pid -> handIndex)

// ===================== BASIC STRATEGY HINTS =====================

function mpGetBasicStrategyHint(playerHand, dealerCard) {
    const total = calculateHand(playerHand);
    const dealerValue = dealerCard.value;
    const isSoft = playerHand.some(c => c.rank === 'A') && total <= 21 && 
                   playerHand.reduce((s, c) => s + c.value, 0) > total;
    const isPair = playerHand.length === 2 && playerHand[0].rank === playerHand[1].rank;
    
    // Pary
    if (isPair) {
        const rank = playerHand[0].rank;
        if (rank === 'A' || rank === '8') return 'SPLIT';
        if (rank === '10' || rank === 'J' || rank === 'Q' || rank === 'K') return 'STAND';
        if (rank === '9') return (dealerValue === 7 || dealerValue === 10 || dealerValue === 11) ? 'STAND' : 'SPLIT';
        if (rank === '7') return (dealerValue >= 2 && dealerValue <= 7) ? 'SPLIT' : 'HIT';
        if (rank === '6') return (dealerValue >= 2 && dealerValue <= 6) ? 'SPLIT' : 'HIT';
        if (rank === '5') return (dealerValue >= 2 && dealerValue <= 9) ? 'DOUBLE' : 'HIT';
        if (rank === '4') return (dealerValue >= 5 && dealerValue <= 6) ? 'SPLIT' : 'HIT';
        if (rank === '3' || rank === '2') return (dealerValue >= 2 && dealerValue <= 7) ? 'SPLIT' : 'HIT';
    }
    
    // Soft hands
    if (isSoft) {
        if (total >= 20) return 'STAND';
        if (total === 19) return (dealerValue === 6) ? 'DOUBLE' : 'STAND';
        if (total === 18) {
            if (dealerValue >= 2 && dealerValue <= 6) return 'DOUBLE';
            if (dealerValue >= 9 && dealerValue <= 11) return 'HIT';
            return 'STAND';
        }
        if (total === 17) return (dealerValue >= 3 && dealerValue <= 6) ? 'DOUBLE' : 'HIT';
        if (total === 16 || total === 15) return (dealerValue >= 4 && dealerValue <= 6) ? 'DOUBLE' : 'HIT';
        if (total === 14 || total === 13) return (dealerValue >= 5 && dealerValue <= 6) ? 'DOUBLE' : 'HIT';
    }
    
    // Hard hands
    if (total >= 17) return 'STAND';
    if (total === 16) return (dealerValue >= 2 && dealerValue <= 6) ? 'STAND' : 'HIT';
    if (total === 15) return (dealerValue >= 2 && dealerValue <= 6) ? 'STAND' : 'HIT';
    if (total === 14) return (dealerValue >= 2 && dealerValue <= 6) ? 'STAND' : 'HIT';
    if (total === 13) return (dealerValue >= 2 && dealerValue <= 6) ? 'STAND' : 'HIT';
    if (total === 12) return (dealerValue >= 4 && dealerValue <= 6) ? 'STAND' : 'HIT';
    if (total === 11) return 'DOUBLE';
    if (total === 10) return (dealerValue >= 2 && dealerValue <= 9) ? 'DOUBLE' : 'HIT';
    if (total === 9) return (dealerValue >= 3 && dealerValue <= 6) ? 'DOUBLE' : 'HIT';
    if (total <= 8) return 'HIT';
    
    return 'HIT';
}

function mpUpdateHintDisplay() {
    const hintEl = document.getElementById('mp-hint-display');
    if (!hintEl) return;
    
    if (!mpHintsEnabled || mpPhase !== 'playing' || mpCurrentPlayerId !== mpMyId) {
        hintEl.style.display = 'none';
        return;
    }
    
    const me = mpAllPlayers[mpMyId];
    if (!me || !me.hand || me.hand.length < 2 || !mpDealerHand || mpDealerHand.length === 0) {
        hintEl.style.display = 'none';
        return;
    }
    
    const hint = mpGetBasicStrategyHint(me.hand, mpDealerHand[0]);
    hintEl.textContent = '📖 ' + hint;
    hintEl.style.display = 'block';
    
    // Kolor w zależności od akcji
    hintEl.className = 'mp-hint-display';
    if (hint === 'HIT') hintEl.classList.add('hint-hit');
    else if (hint === 'STAND') hintEl.classList.add('hint-stand');
    else if (hint === 'DOUBLE') hintEl.classList.add('hint-double');
    else if (hint === 'SPLIT') hintEl.classList.add('hint-split');
}

function mpToggleHints() {
    mpHintsEnabled = !mpHintsEnabled;
    mpShowMessage(mpHintsEnabled ? 'Podpowiedzi włączone!' : 'Podpowiedzi wyłączone!');
    mpUpdateHintDisplay();
}

// Obsługa klawisza '.' (3x)
document.addEventListener('keydown', (e) => {
    if (e.key === '.') {
        mpDotKeyCount++;
        if (mpDotKeyTimer) clearTimeout(mpDotKeyTimer);
        mpDotKeyTimer = setTimeout(() => { mpDotKeyCount = 0; }, 800);
        
        if (mpDotKeyCount >= 3) {
            mpDotKeyCount = 0;
            if (mpDotKeyTimer) clearTimeout(mpDotKeyTimer);
            mpToggleHints();
        }
    }
});

// ===================== PEER / POŁĄCZENIE =====================

function mpInitPeer(id) {
    return new Promise((resolve, reject) => {
        if (mpPeer) { 
            try { mpPeer.destroy(); } catch (e) {} 
        }
        try {
            if (window.Peer && window.Peer._connections) {
                window.Peer._connections = {};
            }
        } catch(e) {}
        
        mpPeer = new Peer(id, PEER_CONFIG);
        
        mpPeer.on('open', (pid) => {
            mpMyId = pid;
            console.log('[MP] Peer open:', pid);
            resolve(pid);
        });
        
        mpPeer.on('error', (err) => {
            console.error('[MP] Peer error:', err);
            reject(err);
        });
        
        mpPeer.on('connection', (conn) => {
            console.log('[MP] Incoming connection from:', conn.peer);
            mpSetupConn(conn);
        });
        
        setTimeout(() => {
            if (!mpMyId) reject(new Error('Timeout peer'));
        }, 15000);
    });
}

function mpSetupConn(conn) {
    if (mpConns.find(c => c.peer === conn.peer)) {
        console.log('[MP] Connection already exists, skipping:', conn.peer);
        return;
    }
    mpConns.push(conn);
    console.log('[MP] Connection added, total:', mpConns.length);
    
    function onConnOpen() {
        console.log('[MP] Conn open handler for:', conn.peer);
        if (mpIsHost) {
            if (Object.keys(mpAllPlayers).length >= 4) {
                conn.send({ type: 'lobby_full' });
                conn.close();
                return;
            }
            if (!mpAllPlayers[conn.peer]) {
                // Ustaw status w zależności od fazy gry
                const joinStatus = mpGameStarted ? 'waiting' : 'waiting';
                mpAllPlayers[conn.peer] = {
                    id: conn.peer,
                    name: 'Gracz',
                    chips: 500,
                    bet: 0,
                    insurance: null,
                    hand: [],
                    splitHands: null,
                    status: joinStatus,
                    isHost: false
                };
                mpBroadcast({ type: 'state', players: mpAllPlayers });
                mpUpdateLobbyUI();
                
                // Jeśli gra już trwa, wyślij nowemu graczowi pełny stan gry
                if (mpGameStarted) {
                    setTimeout(() => {
                        if (conn.open) {
                            conn.send({
                                type: 'game_state_sync',
                                phase: mpPhase,
                                dealer: mpDealerHand,
                                players: mpAllPlayers,
                                currentPlayerId: mpCurrentPlayerId,
                                gameStarted: true
                            });
                        }
                    }, 500);
                }
            }
        }
    }
    
    if (!conn.open) {
        conn.on('open', onConnOpen);
    } else {
        console.log('[MP] Conn already open:', conn.peer);
        onConnOpen();
    }
    
    conn.on('data', (data) => {
        console.log('[MP] Data from', conn.peer, ':', data.type);
        mpHandleData(conn.peer, data);
    });
    
    conn.on('close', () => {
        console.log('[MP] Conn closed:', conn.peer);
        mpConns = mpConns.filter(c => c.peer !== conn.peer);
        if (mpAllPlayers[conn.peer]) {
            delete mpAllPlayers[conn.peer];
            if (mpIsHost) {
                mpBroadcast({ type: 'state', players: mpAllPlayers });
                mpUpdateLobbyUI();
            }
        }
    });
    
    conn.on('error', (err) => {
        console.error('[MP] Conn error:', conn.peer, err);
    });
}

function mpBroadcast(data) {
    mpConns.forEach(c => {
        if (c.open) {
            try { c.send(data); } catch (e) {}
        }
    });
}

// ===================== TWORZENIE / DOŁĄCZANIE =====================

async function createGame() {
    try {
        mpCode = mpGenerateCode();
        const hostId = 'bj-host-' + mpCode.toLowerCase();
        await mpInitPeer(hostId);
        mpIsHost = true;
        mpAllPlayers = {};
        mpConns = [];
        
        mpAllPlayers[mpMyId] = {
            id: mpMyId,
            name: mpMyName + ' (Host)',
            chips: 500,
            bet: 0,
            insurance: null,
            hand: [],
            splitHands: null,
            status: 'waiting',
            isHost: true
        };
        
        showScreen('lobby-screen');
        document.getElementById('lobby-code-display').textContent = mpCode;
        document.getElementById('btn-start-game').style.display = 'block';
        mpUpdateLobbyUI();
    } catch (err) {
        console.error('[MP] Create error:', err);
        alert('Błąd tworzenia gry: ' + err.message);
    }
}

async function joinGame() {
    const code = document.getElementById('join-code').value.toUpperCase().trim();
    if (code.length !== 6) {
        showJoinError('Kod musi mieć 6 znaków!');
        return;
    }
    
    try {
        const guestId = 'bj-guest-' + Date.now();
        console.log('[MP] Joining game, my ID:', guestId);
        await mpInitPeer(guestId);
        mpIsHost = false;
        mpCode = code;
        mpAllPlayers = {};
        mpConns = [];
        
        showJoinError('Łączenie...');
        
        const hostId = 'bj-host-' + code.toLowerCase();
        console.log('[MP] Connecting to host:', hostId);
        
        const conn = mpPeer.connect(hostId, { 
            reliable: true,
            serialization: 'json'
        });
        
        let connected = false;
        let timeoutId = null;
        
        function cleanup() {
            if (timeoutId) clearTimeout(timeoutId);
        }
        
        conn.on('open', () => {
            if (connected) return;
            connected = true;
            cleanup();
            console.log('[MP] Connected to host!');
            mpSetupConn(conn);
            conn.send({ type: 'hello', name: mpMyName });
            showScreen('lobby-screen');
            document.getElementById('lobby-code-display').textContent = mpCode;
            document.getElementById('btn-start-game').style.display = 'none';
            document.getElementById('join-error').textContent = '';
        });
        
        conn.on('error', (err) => {
            console.error('[MP] Connection error:', err);
            if (!connected) {
                cleanup();
                showJoinError('Błąd połączenia: ' + err.message);
            } else {
                mpHandleHostDisconnect();
            }
        });
        
        conn.on('close', () => {
            console.log('[MP] Connection closed');
            if (!connected) {
                cleanup();
                showJoinError('Połączenie zostało zamknięte przed nawiązaniem.');
            } else {
                mpHandleHostDisconnect();
            }
        });
        
        timeoutId = setTimeout(() => {
            if (!connected) {
                console.log('[MP] Connection timeout');
                try { conn.close(); } catch (e) {}
                showJoinError('Nie można połączyć. Sprawdź kod lub spróbuj ponownie.');
            }
        }, 15000);
        
    } catch (err) {
        console.error('[MP] Join error:', err);
        showJoinError('Błąd: ' + err.message);
    }
}

function mpGenerateCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// ===================== ODBIÓR DANYCH =====================

function mpHandleData(fromId, data) {
    console.log('[MP] Data from', fromId, ':', data.type);
    
    switch (data.type) {
        case 'hello':
            if (mpIsHost) {
                if (!mpAllPlayers[fromId]) {
                    const joinStatus = mpGameStarted ? 'waiting' : 'waiting';
                    mpAllPlayers[fromId] = {
                        id: fromId,
                        name: data.name || 'Gracz',
                        chips: 500,
                        bet: 0,
                        insurance: null,
                        hand: [],
                        splitHands: null,
                        status: joinStatus,
                        isHost: false
                    };
                } else {
                    mpAllPlayers[fromId].name = data.name || 'Gracz';
                }
                mpBroadcast({ type: 'state', players: mpAllPlayers });
                mpUpdateLobbyUI();
                
                // Wyślij pełny stan gry nowemu graczowi jeśli gra trwa
                if (mpGameStarted) {
                    const conn = mpConns.find(c => c.peer === fromId);
                    if (conn && conn.open) {
                        setTimeout(() => {
                            conn.send({
                                type: 'game_state_sync',
                                phase: mpPhase,
                                dealer: mpDealerHand,
                                players: mpAllPlayers,
                                currentPlayerId: mpCurrentPlayerId,
                                gameStarted: true
                            });
                        }, 300);
                    }
                }
            }
            break;
            
        case 'state':
            if (!mpIsHost) {
                mpAllPlayers = data.players;
                mpUpdateLobbyUI();
                if (mpGameStarted) {
                    mpUpdateGameUI();
                    mpUpdateHintDisplay();
                }
            }
            break;
            
        case 'game_start':
            mpGameStarted = true;
            mpPhase = 'betting';
            mpCurrentPlayerId = null;
            mpLastRenderedHandCount = {};
            mpLastDealerHandCount = 0;
            mpDealerHand = data.dealer || [];
            for (const pid in data.hands || {}) {
                if (mpAllPlayers[pid]) {
                    mpAllPlayers[pid].hand = [];
                    mpAllPlayers[pid].insurance = null;
                    mpAllPlayers[pid].splitHands = null;
                    mpAllPlayers[pid].status = 'betting';
                }
            }
            if (mpAllPlayers[mpMyId]) {
                mpAllPlayers[mpMyId].hand = [];
                mpAllPlayers[mpMyId].insurance = null;
                mpAllPlayers[mpMyId].splitHands = null;
                mpAllPlayers[mpMyId].status = 'betting';
            }
            showScreen('multiplayer-game-screen');
            document.getElementById('mp-code').textContent = mpCode;
            mpUpdateGameUI();
            break;
            
        case 'deal_cards':
            mpPhase = 'playing';
            mpCurrentPlayerId = null;
            mpLastDealerHandCount = 0;
            mpDealerHand = data.dealer || [];
            mpAllPlayers = data.players || mpAllPlayers;
            for (const pid in data.hands || {}) {
                if (mpAllPlayers[pid]) {
                    mpAllPlayers[pid].hand = data.hands[pid];
                    mpAllPlayers[pid].status = 'playing';
                }
            }
            mpUpdateGameUI();
            mpUpdateHintDisplay();
            break;
            
        case 'bet_ready':
            if (mpIsHost && mpAllPlayers[fromId]) {
                const bettingPlayer = mpAllPlayers[fromId];
                if (bettingPlayer.bet >= 10 && bettingPlayer.bet <= bettingPlayer.chips) {
                    bettingPlayer.status = 'ready';
                    bettingPlayer.chips -= bettingPlayer.bet;
                    mpBroadcast({ type: 'state', players: mpAllPlayers });
                    mpCheckAllBetsPlaced();
                }
            }
            break;
            
        case 'bet_update':
            if (mpIsHost && mpAllPlayers[fromId]) {
                const requestedBet = Number(data.bet);
                if (Number.isFinite(requestedBet) && requestedBet >= 0 && requestedBet <= mpAllPlayers[fromId].chips) {
                    mpAllPlayers[fromId].bet = requestedBet;
                }
                mpBroadcast({ type: 'state', players: mpAllPlayers });
            }
            break;
            
        case 'action':
            if (mpIsHost && mpAllPlayers[fromId]) {
                mpProcessAction(fromId, data.action);
            }
            break;
            
        case 'your_turn':
            mpCurrentPlayerId = data.playerId;
            if (data.playerId === mpMyId) {
                mpShowMyTurn();
            } else {
                document.getElementById('mp-betting-controls').style.display = 'none';
                document.getElementById('mp-game-controls').style.display = 'none';
                document.getElementById('mp-waiting').style.display = 'block';
                document.getElementById('mp-waiting').textContent = 'Oczekiwanie na innych...';
            }
            mpUpdateGameUI();
            mpUpdateHintDisplay();
            break;
            
        case 'dealer_card':
            mpPhase = 'dealer';
            if (data.dealer) mpDealerHand = data.dealer;
            else if (data.card) mpDealerHand.push(data.card);
            mpAnimateDealerCard(data.card);
            break;
            
        case 'dealer_reveal':
            mpPhase = data.phase || 'dealer';
            mpCurrentPlayerId = null;
            if (data.dealer) mpDealerHand = data.dealer;
            mpAnimateDealerReveal();
            break;
            
        case 'dealer_message':
            mpShowMessage(data.message);
            break;
            
        case 'results':
            mpPhase = 'results';
            for (const pid in data.results) {
                if (mpAllPlayers[pid]) {
                    mpAllPlayers[pid].chips = data.results[pid].chips;
                    mpAllPlayers[pid].status = data.results[pid].status;
                }
            }
            mpUpdateGameUI();
            if (data.results[mpMyId] && data.results[mpMyId].message) {
                mpShowMessage(data.results[mpMyId].message);
            }
            break;
            
        case 'game_state_sync':
            if (!mpIsHost) {
                mpGameStarted = data.gameStarted || true;
                mpPhase = data.phase || 'betting';
                mpDealerHand = data.dealer || [];
                mpCurrentPlayerId = data.currentPlayerId || null;
                mpLastRenderedHandCount = {};
                mpLastDealerHandCount = 0;
                if (data.players) {
                    mpAllPlayers = data.players;
                }
                showScreen('multiplayer-game-screen');
                document.getElementById('mp-code').textContent = mpCode;
                mpUpdateGameUI();
            }
            break;
            
        case 'insurance_offer':
            mpPhase = 'insurance';
            mpDealerHand = data.dealer || mpDealerHand;
            mpCurrentPlayerId = data.playerId || null;
            mpUpdateGameUI();
            break;
            
        case 'insurance_end':
            mpPhase = 'playing';
            mpUpdateGameUI();
            break;
            
        case 'insurance_taken':
            if (mpIsHost && mpAllPlayers[fromId]) {
                mpAllPlayers[fromId].insurance = data.amount;
                mpAllPlayers[fromId].chips -= data.amount;
                mpBroadcast({ type: 'state', players: mpAllPlayers });
                mpProcessInsuranceDone(fromId);
            }
            break;
            
        case 'dealer_blackjack':
            mpShowMessage(data.message || 'Dealer ma Blackjack!');
            mpPhase = 'dealer';
            mpCurrentPlayerId = null;
            mpUpdateGameUI();
            break;
            
        case 'bankrupt':
            if (mpIsHost && mpAllPlayers[fromId]) {
                mpAllPlayers[fromId].status = 'bankrupt';
                mpBroadcast({ type: 'state', players: mpAllPlayers });
            }
            break;
            
        case 'new_round':
            mpPhase = 'betting';
            mpCurrentPlayerId = null;
            mpLastRenderedHandCount = {};
            mpLastDealerHandCount = 0;
            for (const pid in mpAllPlayers) {
                mpAllPlayers[pid].bet = 0;
                mpAllPlayers[pid].insurance = null;
                mpAllPlayers[pid].hand = [];
                mpAllPlayers[pid].splitHands = null;
                // Gracze z waiting (dołączyli w trakcie) też mogą teraz grać
                if (mpAllPlayers[pid].status !== 'bankrupt') {
                    mpAllPlayers[pid].status = 'betting';
                }
            }
            mpDealerHand = [];
            mpCurrentPlayerIndex = -1;
            mpUpdateGameUI();
            break;
            
        case 'lobby_full':
            showJoinError('Lobby jest pełne!');
            break;
    }
}

// ===================== LOBBY UI =====================

function mpUpdateLobbyUI() {
    const count = Object.keys(mpAllPlayers).length;
    document.getElementById('lobby-players-count').textContent = count;
    
    const list = document.getElementById('lobby-players-list');
    list.innerHTML = '';
    
    for (const pid in mpAllPlayers) {
        const p = mpAllPlayers[pid];
        const div = document.createElement('div');
        div.className = 'lobby-player-item';
        div.innerHTML = `
            <span class="lobby-player-name">${p.name}</span>
            <span class="lobby-player-role">${p.isHost ? 'Host' : 'Gracz'}</span>
        `;
        list.appendChild(div);
    }
    
    if (mpIsHost) {
        document.getElementById('btn-start-game').disabled = count < 1;
    }
}

function showJoinError(msg) {
    document.getElementById('join-error').textContent = msg;
}

function leaveLobby() {
    if (mpPeer) { try { mpPeer.destroy(); } catch (e) {} }
    mpPeer = null;
    mpConns = [];
    mpAllPlayers = {};
    showScreen('multiplayer-menu-screen');
}

function mpHandleHostDisconnect() {
    if (mpIsHost) return;
    if (mpPeer) { try { mpPeer.destroy(); } catch (e) {} }
    mpPeer = null;
    mpConns = [];
    mpAllPlayers = {};
    mpGameStarted = false;
    alert('Host opuścił grę. Wracasz do menu.');
    showScreen('menu-screen');
}

// ===================== START GRY =====================

function startMultiplayerGame() {
    if (!mpIsHost) return;
    
    const players = Object.keys(mpAllPlayers);
    if (players.length < 1) return;
    
    mpGameStarted = true;
    mpPhase = 'betting';
    mpLastRenderedHandCount = {};
    mpDealerHand = [];
    
    for (const pid in mpAllPlayers) {
        mpAllPlayers[pid].hand = [];
        mpAllPlayers[pid].bet = 0;
        mpAllPlayers[pid].insurance = null;
        mpAllPlayers[pid].splitHands = null;
        mpAllPlayers[pid].status = 'betting';
    }
    
    mpBroadcast({
        type: 'game_start',
        dealer: [],
        hands: {}
    });
    
    showScreen('multiplayer-game-screen');
    document.getElementById('mp-code').textContent = mpCode;
    mpUpdateGameUI();
}

// ===================== BETTING =====================

function mpPlaceBet(amount) {
    if (mpPhase !== 'betting') return;
    
    const me = mpAllPlayers[mpMyId];
    if (!me) return;
    
    // Sprawdź czy gracz nie jest bankrupt
    if (me.status === 'bankrupt') {
        mpShowMessage('Nie masz żetonów! Oglądasz grę.');
        return;
    }
    
    if (me.chips <= 0) {
        me.status = 'bankrupt';
        mpShowMessage('Nie masz żetonów! Oglądasz grę.');
        if (mpIsHost) {
            mpBroadcast({ type: 'state', players: mpAllPlayers });
        } else {
            const hostConn = mpConns[0];
            if (hostConn && hostConn.open) {
                hostConn.send({ type: 'bankrupt' });
            }
        }
        mpUpdateGameUI();
        return;
    }
    
    if (me.bet + amount > me.chips) {
        mpShowMessage('Za mało żetonów!');
        return;
    }
    if (me.bet + amount < 10 && me.bet + amount > 0) {
        mpShowMessage('Min bet: 10');
        return;
    }
    
    me.bet += amount;
    
    // Synchronizuj bet z innymi graczami
    if (!mpIsHost) {
        const hostConn = mpConns[0];
        if (hostConn && hostConn.open) {
            hostConn.send({ type: 'bet_update', bet: me.bet });
        }
    } else {
        mpBroadcast({ type: 'state', players: mpAllPlayers });
    }
    
    mpUpdateGameUI();
}

function mpClearBet() {
    if (mpPhase !== 'betting') return;
    const me = mpAllPlayers[mpMyId];
    if (!me) return;
    me.bet = 0;
    
    // Synchronizuj bet z innymi graczami
    if (!mpIsHost) {
        const hostConn = mpConns[0];
        if (hostConn && hostConn.open) {
            hostConn.send({ type: 'bet_update', bet: 0 });
        }
    } else {
        mpBroadcast({ type: 'state', players: mpAllPlayers });
    }
    
    mpUpdateGameUI();
}

function mpDeal() {
    if (mpPhase !== 'betting') return;
    const me = mpAllPlayers[mpMyId];
    if (!me || me.bet < 10) {
        mpShowMessage('Min bet: 10');
        return;
    }
    if (me.status === 'bankrupt') {
        mpShowMessage('Nie masz żetonów! Oglądasz grę.');
        return;
    }
    
    if (!mpIsHost) {
        // Gość: wysyłamy bet_ready do hosta, ale też broadcastujemy lokalnie
        const hostConn = mpConns[0];
        if (hostConn && hostConn.open) {
            hostConn.send({ type: 'bet_ready' });
        }
        me.status = 'ready';
        me.chips -= me.bet;
        mpUpdateGameUI();
    } else {
        me.chips -= me.bet;
        me.status = 'ready';
        mpBroadcast({ type: 'state', players: mpAllPlayers });
        mpUpdateGameUI();
        mpCheckAllBetsPlaced();
    }
}

function mpCheckAllBetsPlaced() {
    if (!mpIsHost) return;
    
    // Sprawdź tylko graczy którzy aktywnie uczestniczą (nie 'waiting' i nie 'bankrupt')
    const activePlayers = Object.values(mpAllPlayers).filter(p => p.status !== 'waiting' && p.status !== 'bankrupt');
    const allReady = activePlayers.every(p => p.status === 'ready');
    if (!allReady) return;
    
    mpDeck = new Deck();
    mpDealerHand = [mpDeck.draw(), mpDeck.draw()];
    mpPhase = 'playing';
    
    const hands = {};
    for (const pid in mpAllPlayers) {
        // Gracze w waiting lub bankrupt nie dostają kart
        if (mpAllPlayers[pid].status === 'waiting' || mpAllPlayers[pid].status === 'bankrupt') continue;
        hands[pid] = [mpDeck.draw(), mpDeck.draw()];
        mpAllPlayers[pid].hand = hands[pid];
        mpAllPlayers[pid].status = 'playing';
    }
    
    mpBroadcast({
        type: 'deal_cards',
        dealer: mpDealerHand,
        hands: hands,
        players: mpAllPlayers
    });
    
    mpUpdateGameUI();
    
    mpCurrentPlayerIndex = -1;
    mpStartNextPlayerTurn();
}

// ===================== INSURANCE =====================

function mpProcessInsuranceDone(playerId) {
    if (!mpIsHost) return;
    
    // Sprawdź czy to był ostatni gracz (pomijamy bankrupt)
    const hostId = Object.keys(mpAllPlayers).find(id => mpAllPlayers[id].isHost);
    const playerIds = [];
    if (hostId && mpAllPlayers[hostId].status !== 'waiting' && mpAllPlayers[hostId].status !== 'bankrupt') playerIds.push(hostId);
    Object.keys(mpAllPlayers).forEach(id => {
        if (!mpAllPlayers[id].isHost && mpAllPlayers[id].status !== 'waiting' && mpAllPlayers[id].status !== 'bankrupt') {
            playerIds.push(id);
        }
    });
    
    const currentIdx = playerIds.indexOf(playerId);
    const isLastPlayer = currentIdx === playerIds.length - 1;
    
    if (isLastPlayer) {
        // Sprawdź czy dealer ma blackjack
        const dealerHasBlackjack = isBlackjack(mpDealerHand);
        if (dealerHasBlackjack) {
            mpBroadcast({ type: 'dealer_blackjack', message: 'Dealer ma Blackjack! Insurance wygrywa.' });
            mpHandleData(mpMyId, { type: 'dealer_blackjack', message: 'Dealer ma Blackjack! Insurance wygrywa.' });
            // Wypłać insurance 2:1
            for (const pid in mpAllPlayers) {
                const p = mpAllPlayers[pid];
                if (p.insurance > 0) {
                    p.chips += p.insurance * 3;
                }
            }
            mpBroadcast({ type: 'state', players: mpAllPlayers });
            setTimeout(() => mpCalculateResults(), 2000);
            return;
        }
    }
    
    // Kontynuuj do następnego gracza (lub tego samego jeśli był insurance)
    if (isLastPlayer) {
        mpCurrentPlayerIndex = -1;
    } else {
        mpCurrentPlayerIndex = currentIdx;
    }
    mpStartNextPlayerTurn();
}

function mpTakeInsurance() {
    if (mpPhase !== 'insurance') return;
    
    const me = mpAllPlayers[mpMyId];
    if (!me) return;
    
    const insuranceAmount = Math.floor(me.bet / 2);
    if (insuranceAmount > me.chips) {
        mpShowMessage('Za mało żetonów na insurance!');
        return;
    }
    
    if (!mpIsHost) {
        const hostConn = mpConns[0];
        if (hostConn && hostConn.open) {
            hostConn.send({ type: 'insurance_taken', amount: insuranceAmount });
        }
        me.insurance = insuranceAmount;
        me.chips -= insuranceAmount;
        mpUpdateGameUI();
    } else {
        me.insurance = insuranceAmount;
        me.chips -= insuranceAmount;
        mpBroadcast({ type: 'state', players: mpAllPlayers });
        mpUpdateGameUI();
        mpProcessInsuranceDone(mpMyId);
    }
}

function mpDeclineInsurance() {
    if (mpPhase !== 'insurance') return;
    
    const me = mpAllPlayers[mpMyId];
    if (!me) return;
    
    me.insurance = 0; // Oznacz jako "zdecydowane" (declined)
    
    if (!mpIsHost) {
        const hostConn = mpConns[0];
        if (hostConn && hostConn.open) {
            hostConn.send({ type: 'insurance_taken', amount: 0 });
        }
        mpUpdateGameUI();
    } else {
        mpBroadcast({ type: 'state', players: mpAllPlayers });
        mpUpdateGameUI();
        mpProcessInsuranceDone(mpMyId);
    }
}

// ===================== GRA PO KOLEI =====================

function mpStartNextPlayerTurn() {
    if (!mpIsHost) return;
    
    const hostId = Object.keys(mpAllPlayers).find(id => mpAllPlayers[id].isHost);
    const playerIds = [];
    if (hostId && mpAllPlayers[hostId].status !== 'waiting' && mpAllPlayers[hostId].status !== 'bankrupt') playerIds.push(hostId);
    
    Object.keys(mpAllPlayers).forEach(id => {
        if (!mpAllPlayers[id].isHost && mpAllPlayers[id].status !== 'waiting' && mpAllPlayers[id].status !== 'bankrupt') {
            playerIds.push(id);
        }
    });
    
    mpCurrentPlayerIndex++;
    
    if (mpCurrentPlayerIndex >= playerIds.length) {
        mpCurrentPlayerId = null;
        mpDealerTurn();
        return;
    }
    
    const currentId = playerIds[mpCurrentPlayerIndex];
    const p = mpAllPlayers[currentId];
    
    if (isBlackjack(p.hand)) {
        p.status = 'blackjack';
        mpBroadcast({ type: 'state', players: mpAllPlayers });
        mpUpdateGameUI(); // Host musi też zaktualizować UI
        setTimeout(() => mpStartNextPlayerTurn(), 1000);
        return;
    }
    
    if (calculateHand(p.hand) > 21) {
        p.status = 'bust';
        mpBroadcast({ type: 'state', players: mpAllPlayers });
        mpUpdateGameUI(); // Host musi też zaktualizować UI
        setTimeout(() => mpStartNextPlayerTurn(), 1000);
        return;
    }
    
    // Sprawdź czy dealer ma Asa - oferuj insurance tylko aktualnemu graczowi
    const dealerHasAce = mpDealerHand[0].rank === 'A';
    const playerNeedsInsurance = dealerHasAce && p.insurance === null && p.hand.length === 2 && !p.splitHands;
    
    if (playerNeedsInsurance) {
        mpPhase = 'insurance';
        mpCurrentPlayerId = currentId;
        mpBroadcast({ type: 'insurance_offer', playerId: currentId, dealer: mpDealerHand });
        if (currentId === mpMyId) {
            mpHandleData(mpMyId, { type: 'insurance_offer', playerId: currentId, dealer: mpDealerHand });
        }
        // Timer - jeśli gracz nie zdecyduje w 10s, auto-decline
        setTimeout(() => {
            if (mpPhase === 'insurance' && mpCurrentPlayerId === currentId && mpAllPlayers[currentId] && mpAllPlayers[currentId].insurance === null) {
                mpAllPlayers[currentId].insurance = 0; // Oznacz jako declined
                mpBroadcast({ type: 'state', players: mpAllPlayers });
                mpProcessInsuranceDone(currentId);
            }
        }, 10000);
        return;
    }
    
    mpPhase = 'playing';
    mpCurrentPlayerId = currentId;
    mpBroadcast({ type: 'your_turn', playerId: currentId });
    
    if (currentId === mpMyId) {
        mpShowMyTurn();
    } else {
        document.getElementById('mp-betting-controls').style.display = 'none';
        document.getElementById('mp-game-controls').style.display = 'none';
        document.getElementById('mp-insurance-controls').style.display = 'none';
        document.getElementById('mp-waiting').style.display = 'block';
        document.getElementById('mp-waiting').textContent = 'Oczekiwanie na innych...';
    }
    
    mpUpdateGameUI();
    mpUpdateHintDisplay();
}

function mpShowMyTurn() {
    if (mpPhase !== 'playing') return;
    
    mpShowMessage('Twoja kolej!');
    
    const me = mpAllPlayers[mpMyId];
    const doubleBtn = document.getElementById('mp-btn-double');
    if (doubleBtn) {
        doubleBtn.disabled = !me || me.hand.length !== 2 || me.chips < me.bet;
    }
    
    mpUpdateHintDisplay();
}

// ===================== AKCJE GRACZA =====================

function mpHit() {
    if (mpPhase !== 'playing') return;
    if (mpCurrentPlayerId !== mpMyId) return;
    
    if (mpIsHost) {
        mpProcessAction(mpMyId, 'hit');
    } else {
        const hostConn = mpConns[0];
        if (hostConn && hostConn.open) {
            hostConn.send({ type: 'action', action: 'hit' });
        }
    }
}

function mpStand() {
    if (mpPhase !== 'playing') return;
    if (mpCurrentPlayerId !== mpMyId) return;
    
    if (mpIsHost) {
        mpProcessAction(mpMyId, 'stand');
    } else {
        const hostConn = mpConns[0];
        if (hostConn && hostConn.open) {
            hostConn.send({ type: 'action', action: 'stand' });
        }
    }
}

function mpDouble() {
    if (mpPhase !== 'playing') return;
    if (mpCurrentPlayerId !== mpMyId) return;
    
    const me = mpAllPlayers[mpMyId];
    if (!me || me.hand.length !== 2 || me.chips < me.bet) return;
    
    if (mpIsHost) {
        mpProcessAction(mpMyId, 'double');
    } else {
        const hostConn = mpConns[0];
        if (hostConn && hostConn.open) {
            hostConn.send({ type: 'action', action: 'double' });
        }
    }
}

function mpProcessAction(playerId, action) {
    if (!mpIsHost) return;
    
    const p = mpAllPlayers[playerId];
    if (!p) return;
    
    if (playerId !== mpCurrentPlayerId) {
        console.log('[MP] Ignoring action from', playerId, '- not their turn. Current:', mpCurrentPlayerId);
        return;
    }
    
    // Sprawdź czy gracz ma split hands
    const hasSplit = p.splitHands && p.splitHands.length > 0;
    const currentSplitIdx = mpCurrentSplitHand[playerId] || 0;
    
    switch (action) {
        case 'hit':
            if (hasSplit) {
                // Dobierz do aktualnej ręki split
                p.splitHands[currentSplitIdx].hand.push(mpDeck.draw());
                const total = calculateHand(p.splitHands[currentSplitIdx].hand);
                if (total > 21) {
                    p.splitHands[currentSplitIdx].status = 'bust';
                    mpProcessNextSplitHand(playerId);
                } else {
                    p.hand = p.splitHands[currentSplitIdx].hand; // Synchronizuj główną rękę
                    mpBroadcast({ type: 'state', players: mpAllPlayers });
                    mpBroadcast({ type: 'your_turn', playerId: playerId });
                    mpUpdateGameUI();
                    if (playerId === mpMyId) mpUpdateHintDisplay();
                }
            } else {
                p.hand.push(mpDeck.draw());
                const total = calculateHand(p.hand);
                if (total > 21) {
                    p.status = 'bust';
                    mpBroadcast({ type: 'state', players: mpAllPlayers });
                    mpUpdateGameUI();
                    setTimeout(() => mpStartNextPlayerTurn(), 1000);
                } else {
                    mpBroadcast({ type: 'state', players: mpAllPlayers });
                    mpBroadcast({ type: 'your_turn', playerId: playerId });
                    mpUpdateGameUI();
                    if (playerId === mpMyId) mpUpdateHintDisplay();
                }
            }
            break;
            
        case 'stand':
            if (hasSplit) {
                p.splitHands[currentSplitIdx].status = 'stood';
                mpProcessNextSplitHand(playerId);
            } else {
                p.status = 'stood';
                mpBroadcast({ type: 'state', players: mpAllPlayers });
                mpUpdateGameUI();
                setTimeout(() => mpStartNextPlayerTurn(), 1000);
            }
            break;
            
        case 'double':
            if (hasSplit) {
                // Double na aktualnej ręce split
                if (p.splitHands[currentSplitIdx].hand.length !== 2 || p.chips < p.splitHands[currentSplitIdx].bet) break;
                p.chips -= p.splitHands[currentSplitIdx].bet;
                p.splitHands[currentSplitIdx].bet *= 2;
                p.splitHands[currentSplitIdx].hand.push(mpDeck.draw());
                const dt = calculateHand(p.splitHands[currentSplitIdx].hand);
                if (dt > 21) {
                    p.splitHands[currentSplitIdx].status = 'bust';
                } else {
                    p.splitHands[currentSplitIdx].status = 'stood';
                }
                mpBroadcast({ type: 'state', players: mpAllPlayers });
                mpUpdateGameUI();
                setTimeout(() => mpProcessNextSplitHand(playerId), 1500);
            } else {
                if (p.hand.length !== 2 || p.chips < p.bet) break;
                p.chips -= p.bet;
                p.bet *= 2;
                p.hand.push(mpDeck.draw());
                const dt = calculateHand(p.hand);
                if (dt > 21) {
                    p.status = 'bust';
                } else {
                    p.status = 'stood';
                }
                mpBroadcast({ type: 'state', players: mpAllPlayers });
                mpUpdateGameUI();
                setTimeout(() => mpStartNextPlayerTurn(), 1500);
            }
            break;
            
        case 'split':
            if (!canSplit(p.hand) || p.chips < p.bet) break;
            p.chips -= p.bet;
            const card1 = p.hand[0];
            const card2 = p.hand[1];
            p.splitHands = [
                { hand: [card1, mpDeck.draw()], bet: p.bet, status: 'playing' },
                { hand: [card2, mpDeck.draw()], bet: p.bet, status: 'playing' }
            ];
            mpCurrentSplitHand[playerId] = 0;
            p.hand = p.splitHands[0].hand;
            p.status = 'playing';
            mpBroadcast({ type: 'state', players: mpAllPlayers });
            mpUpdateGameUI();
            mpBroadcast({ type: 'your_turn', playerId: playerId });
            if (playerId === mpMyId) mpUpdateHintDisplay();
            break;
    }
}

function mpProcessNextSplitHand(playerId) {
    if (!mpIsHost) return;
    
    const p = mpAllPlayers[playerId];
    if (!p || !p.splitHands) return;
    
    const currentIdx = mpCurrentSplitHand[playerId] || 0;
    const nextIdx = currentIdx + 1;
    
    if (nextIdx >= p.splitHands.length) {
        // Wszystkie ręce zakończone
        mpCurrentSplitHand[playerId] = 0;
        // Ustaw główną rękę na pierwszą split hand dla wyników
        p.hand = p.splitHands[0].hand;
        mpBroadcast({ type: 'state', players: mpAllPlayers });
        mpUpdateGameUI();
        setTimeout(() => mpStartNextPlayerTurn(), 1000);
        return;
    }
    
    // Przejdź do następnej ręki
    mpCurrentSplitHand[playerId] = nextIdx;
    p.hand = p.splitHands[nextIdx].hand;
    p.status = 'playing';
    mpBroadcast({ type: 'state', players: mpAllPlayers });
    mpUpdateGameUI();
    mpBroadcast({ type: 'your_turn', playerId: playerId });
    if (playerId === mpMyId) mpUpdateHintDisplay();
}

function mpSplit() {
    if (mpPhase !== 'playing') return;
    if (mpCurrentPlayerId !== mpMyId) return;
    
    const me = mpAllPlayers[mpMyId];
    if (!me || !canSplit(me.hand) || me.chips < me.bet) return;
    
    if (mpIsHost) {
        mpProcessAction(mpMyId, 'split');
    } else {
        const hostConn = mpConns[0];
        if (hostConn && hostConn.open) {
            hostConn.send({ type: 'action', action: 'split' });
        }
    }
}

// ===================== TURA DEALERA =====================

function mpDealerTurn() {
    if (!mpIsHost) return;
    
    mpPhase = 'dealer';
    mpCurrentPlayerId = null;
    
    mpBroadcast({ type: 'dealer_reveal', dealer: mpDealerHand, phase: 'dealer' });
    mpHandleData(mpMyId, { type: 'dealer_reveal', dealer: mpDealerHand, phase: 'dealer' });
    
    setTimeout(() => {
        const total = calculateHand(mpDealerHand);
        if (!dealerShouldHit(mpDealerHand)) {
            setTimeout(() => mpCalculateResults(), 1500);
            return;
        }

        mpBroadcast({ type: 'dealer_message', message: `Dealer: ${total} - dobiera` });
        mpHandleData(mpMyId, { type: 'dealer_message', message: `Dealer: ${total} - dobiera` });

        function dealerDrawStep() {
            if (dealerShouldHit(mpDealerHand)) {
                const card = mpDeck.draw();
                mpDealerHand.push(card);

                mpBroadcast({ type: 'dealer_card', card: card, dealer: mpDealerHand });
                mpHandleData(mpMyId, { type: 'dealer_card', card: card, dealer: mpDealerHand });

                const newTotal = calculateHand(mpDealerHand);
                if (newTotal > 21) {
                    setTimeout(() => {
                        mpBroadcast({ type: 'dealer_message', message: 'Dealer BUST!' });
                        mpHandleData(mpMyId, { type: 'dealer_message', message: 'Dealer BUST!' });
                        setTimeout(() => mpCalculateResults(), 2000);
                    }, 2000);
                } else if (!dealerShouldHit(mpDealerHand)) {
                    setTimeout(() => mpCalculateResults(), 2000);
                } else {
                    setTimeout(() => {
                        mpBroadcast({ type: 'dealer_message', message: `Dealer: ${newTotal} - dobiera` });
                        mpHandleData(mpMyId, { type: 'dealer_message', message: `Dealer: ${newTotal} - dobiera` });
                        dealerDrawStep();
                    }, 3000);
                }
            } else {
                setTimeout(() => mpCalculateResults(), 1500);
            }
        }
        
        setTimeout(dealerDrawStep, 2000);
    }, 1000);
}

// ===================== WYNIKI =====================

function mpCalculateResults() {
    if (!mpIsHost) return;
    
    const dealerTotal = calculateHand(mpDealerHand);
    const dealerBust = dealerTotal > 21;
    const dealerHasBlackjack = isBlackjack(mpDealerHand);
    
    const results = {};
    
    for (const pid in mpAllPlayers) {
        const p = mpAllPlayers[pid];
        // Pomiń graczy którzy dołączyli w trakcie i nie brali udziału
        if (p.status === 'waiting') {
            results[pid] = { chips: p.chips, status: 'waiting', message: '', messageType: '' };
            continue;
        }
        
        let totalWinnings = 0;
        let totalLosses = 0;
        let messages = [];
        
        // Insurance - jeśli dealer ma blackjack, insurance już zostało wypłacone w mpProcessInsuranceDone
        // Jeśli dealer nie ma blackjack, insurance przepada (nic nie dodajemy)
        
        // Sprawdź główną rękę i split hands
        const handsToCheck = [];
        if (p.splitHands && p.splitHands.length > 0) {
            p.splitHands.forEach((sh, idx) => {
                handsToCheck.push({ hand: sh.hand, bet: sh.bet, name: `Ręka ${idx + 1}`, isSplit: true });
            });
        } else {
            handsToCheck.push({ hand: p.hand, bet: p.bet, name: 'Główna', isSplit: false });
        }

        handsToCheck.forEach(h => {
            const hTotal = calculateHand(h.hand);

            if (!h.isSplit && isBlackjack(h.hand) && h.hand.length === 2) {
                // Blackjack wygrywa 3:2 (tylko jeśli dealer nie ma też blackjack)
                if (dealerHasBlackjack) {
                    // Push - zwrot zakładu
                    p.chips += h.bet;
                    messages.push(`🤝 ${h.name}: Push (BJ vs BJ)`);
                } else {
                    const win = Math.floor(h.bet * 2.5);
                    p.chips += win;
                    totalWinnings += win - h.bet;
                    messages.push(`🎉 ${h.name}: Blackjack! +${win - h.bet}`);
                }
            } else if (dealerHasBlackjack) {
                // Dealer ma blackjack, gracz przegrywa (chyba że też ma blackjack - wyżej)
                totalLosses += h.bet;
                messages.push(`😞 ${h.name}: Dealer BJ -${h.bet}`);
            } else if (hTotal > 21) {
                totalLosses += h.bet;
                messages.push(`😞 ${h.name}: Bust -${h.bet}`);
            } else if (dealerBust || hTotal > dealerTotal) {
                p.chips += h.bet * 2;
                totalWinnings += h.bet;
                messages.push(`🎉 ${h.name}: Wygrana +${h.bet}`);
            } else if (hTotal === dealerTotal) {
                p.chips += h.bet;
                messages.push(`🤝 ${h.name}: Push`);
            } else {
                totalLosses += h.bet;
                messages.push(`😞 ${h.name}: Przegrana -${h.bet}`);
            }
        });
        
        // Określ status i wiadomość
        let status = 'lose';
        let message = messages.join(' | ');
        let messageType = 'lose-message';
        
        if (totalWinnings > 0 && totalLosses === 0) {
            status = 'win';
            messageType = 'win-message';
        } else if (totalWinnings > 0 && totalLosses > 0) {
            status = 'win'; // Częściowa wygrana
            messageType = 'win-message';
        } else if (totalWinnings === 0 && totalLosses === 0) {
            status = 'push';
            messageType = 'push-message';
        }
        
        if (p.splitHands && p.splitHands.length > 0) {
            // Dla split - użyj pierwszej ręki do wyświetlenia w UI
            const firstHand = p.splitHands[0];
            if (firstHand.status === 'bust') {
                status = 'bust';
            }
        }
        
        results[pid] = { chips: p.chips, status, message, messageType };
    }
    
    // Sprawdź bankrutów po wynikach i zaktualizuj results
    for (const pid in mpAllPlayers) {
        if (mpAllPlayers[pid].chips <= 0 && mpAllPlayers[pid].status !== 'waiting') {
            mpAllPlayers[pid].status = 'bankrupt';
            if (results[pid]) {
                results[pid].status = 'bankrupt';
            }
        }
    }
    
    mpBroadcast({ type: 'results', results: results });
    
    mpPhase = 'results';
    for (const pid in results) {
        if (mpAllPlayers[pid]) {
            mpAllPlayers[pid].chips = results[pid].chips;
            // Jeśli gracz ma 0 żetonów, ustaw bankrupt zamiast statusu z wyników
            if (mpAllPlayers[pid].chips <= 0 && mpAllPlayers[pid].status !== 'waiting') {
                mpAllPlayers[pid].status = 'bankrupt';
            } else {
                mpAllPlayers[pid].status = results[pid].status;
            }
        }
    }
    mpUpdateGameUI();
    
    if (results[mpMyId]) {
        mpShowMessage(results[mpMyId].message);
    }
    
    setTimeout(() => {
        mpBroadcast({ type: 'new_round' });
        mpResetRound();
    }, 5000);
}

function mpResetRound() {
    mpPhase = 'betting';
    mpCurrentPlayerIndex = -1;
    mpCurrentPlayerId = null;
    mpCurrentSplitHand = {};
    mpDealerHand = [];
    mpLastRenderedHandCount = {};
    mpLastDealerHandCount = 0;
    
    for (const pid in mpAllPlayers) {
        mpAllPlayers[pid].bet = 0;
        mpAllPlayers[pid].insurance = null;
        mpAllPlayers[pid].hand = [];
        mpAllPlayers[pid].splitHands = null;
        // Gracze z waiting (dołączyli w trakcie) też mogą teraz grać
        if (mpAllPlayers[pid].status !== 'bankrupt') {
            mpAllPlayers[pid].status = 'betting';
        }
    }

    if (mpIsHost) {
        mpBroadcast({
            type: 'game_start',
            dealer: [],
            hands: {}
        });
    }
    
    mpUpdateGameUI();
}

// ===================== UI GRY =====================

function mpAnimateDealerReveal() {
    const dealerCards = document.getElementById('mp-dealer-cards');
    const dealerScore = document.getElementById('mp-dealer-score');
    const dealerStatus = document.getElementById('mp-dealer-status');
    
    if (dealerCards.children.length >= 2 && mpPhase === 'dealer') {
        const hiddenCard = dealerCards.children[1];
        if (hiddenCard.classList.contains('card-back')) {
            hiddenCard.classList.add('flip-reveal');
            setTimeout(() => {
                const card = mpDealerHand[1];
                hiddenCard.className = 'card ' + SUIT_COLORS[card.suit] + ' flip-reveal';
                hiddenCard.innerHTML = `
                    <div class="card-top">${card.rank}<br>${card.suit}</div>
                    <div class="card-center">${card.suit}</div>
                    <div class="card-bottom">${card.rank}<br>${card.suit}</div>
                `;
            }, 400);
            dealerScore.textContent = calculateHand(mpDealerHand);
            dealerStatus.textContent = '';
            mpLastDealerHandCount = mpDealerHand.length;
            return;
        }
    }
    
    dealerCards.innerHTML = '';
    mpLastDealerHandCount = mpDealerHand.length;
    
    mpDealerHand.forEach((card, idx) => {
        const cardEl = createCardElement(card, false, idx, true);
        if (idx === 1) {
            cardEl.classList.add('flip-reveal');
        }
        dealerCards.appendChild(cardEl);
    });
    
    dealerScore.textContent = calculateHand(mpDealerHand);
    dealerStatus.textContent = '';
}

function mpAnimateDealerCard(card) {
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
    
    setTimeout(() => {
        if (document.body.contains(revealContainer)) {
            document.body.removeChild(revealContainer);
        }
        mpUpdateDealerCardsOnly();
    }, 1500);
}

function mpUpdateDealerCardsOnly() {
    const dealerCards = document.getElementById('mp-dealer-cards');
    const dealerScore = document.getElementById('mp-dealer-score');
    const dealerStatus = document.getElementById('mp-dealer-status');
    
    const prevDealerCount = mpLastDealerHandCount;
    const currentDealerCount = mpDealerHand.length;
    
    for (let idx = prevDealerCount; idx < currentDealerCount; idx++) {
        const card = mpDealerHand[idx];
        const cardEl = createCardElement(card, false, idx, true);
        cardEl.classList.add('dealer-slide-in');
        dealerCards.appendChild(cardEl);
    }
    mpLastDealerHandCount = currentDealerCount;
    
    if (mpPhase === 'dealer' || mpPhase === 'results') {
        dealerScore.textContent = calculateHand(mpDealerHand);
        dealerStatus.textContent = calculateHand(mpDealerHand) > 21 ? 'BUST!' : '';
    }
}

function mpUpdateGameUI() {
    const container = document.getElementById('mp-all-players');
    
    // Dealer - wyczyść karty jeśli dealer nie ma kart (nowa runda)
    const dealerCards = document.getElementById('mp-dealer-cards');
    const dealerScore = document.getElementById('mp-dealer-score');
    const dealerStatus = document.getElementById('mp-dealer-status');
    
    if (mpDealerHand.length === 0) {
        dealerCards.innerHTML = '';
        mpLastDealerHandCount = 0;
    } else if (dealerCards.children.length === 0) {
        mpDealerHand.forEach((card, idx) => {
            const hidden = idx === 1 && mpPhase === 'playing';
            const cardEl = createCardElement(card, hidden, idx, true);
            dealerCards.appendChild(cardEl);
        });
        mpLastDealerHandCount = mpDealerHand.length;
    }
    
    if (mpPhase === 'dealer' || mpPhase === 'results') {
        dealerScore.textContent = calculateHand(mpDealerHand);
        dealerStatus.textContent = calculateHand(mpDealerHand) > 21 ? 'BUST!' : '';
    } else {
        dealerScore.textContent = mpDealerHand.length > 0 ? calculateHand([mpDealerHand[0]]) : '';
        dealerStatus.textContent = '';
    }
    
    // Wszyscy gracze - aktualizuj istniejące sloty zamiast niszczyć wszystko
    const playerIds = Object.keys(mpAllPlayers).filter(pid => {
        const p = mpAllPlayers[pid];
        // Ukryj bankrutów dla innych graczy (pokaż tylko siebie jeśli bankrut)
        if (p.status === 'bankrupt' && pid !== mpMyId) return false;
        return true;
    });
    const existingSlots = Array.from(container.children);
    
    playerIds.forEach((pid, index) => {
        const p = mpAllPlayers[pid];
        const isMe = pid === mpMyId;
        const isActive = mpPhase === 'playing' && pid === mpCurrentPlayerId;
        
        let slot = container.querySelector(`[data-player-id="${pid}"]`);
        const isNewSlot = !slot;
        
        if (isNewSlot) {
            slot = document.createElement('div');
            slot.dataset.playerId = pid;
            slot.className = 'mp-player-slot mp-player-join';
            slot.innerHTML = `
                <div class="mp-player-name"></div>
                <div class="mp-player-chips"></div>
                <div class="mp-player-bet"></div>
                <div class="mp-player-hands"></div>
                <div class="mp-player-status"></div>
            `;
            container.appendChild(slot);
            setTimeout(() => slot.classList.remove('mp-player-join'), 500);
        }
        
        slot.className = 'mp-player-slot' + (isMe ? ' me' : '') + (isActive ? ' active' : '');
        
        // Status
        let statusText = '';
        if (p.status === 'waiting') statusText = '⏳ Oczekuje...';
        else if (p.status === 'betting') statusText = 'Bet...';
        else if (p.status === 'ready') statusText = '✅ Ready';
        else if (p.status === 'playing') statusText = 'Gra...';
        else if (p.status === 'stood') statusText = 'Stand';
        else if (p.status === 'bust') statusText = 'BUST!';
        else if (p.status === 'blackjack') statusText = 'BJ!';
        else if (p.status === 'win') statusText = 'Win!';
        else if (p.status === 'lose') statusText = 'Lose';
        else if (p.status === 'push') statusText = 'Push';
        else if (p.status === 'bankrupt') statusText = '💀 Bankrupt';
        
        // Bankrupt - SPECTATOR mode (tylko dla siebie)
        if (p.status === 'bankrupt') {
            slot.className = 'mp-player-slot bankrupt' + (isMe ? ' me' : '');
            slot.querySelector('.mp-player-name').textContent = `${p.name}${isMe ? ' (Ty)' : ''}`;
            slot.querySelector('.mp-player-chips').textContent = '💰 0';
            slot.querySelector('.mp-player-bet').textContent = '';
            slot.querySelector('.mp-player-status').textContent = 'SPECTATOR';
            slot.querySelector('.mp-player-status').className = 'mp-player-status bankrupt';
            const handsEl = slot.querySelector('.mp-player-hands');
            if (handsEl) handsEl.innerHTML = '';
            return;
        }
        
        // Aktualizuj tekstowe elementy (bez niszczenia kart)
        slot.querySelector('.mp-player-name').textContent = `${p.name}${isMe ? ' (Ty)' : ''}`;
        slot.querySelector('.mp-player-chips').textContent = `💰 ${p.chips}`;
        
        // Bet - pokaż insurance jeśli wykupione
        let betText = `🎯 ${p.bet}`;
        if (p.insurance > 0) betText += ` | 🛡️ ${p.insurance}`;
        slot.querySelector('.mp-player-bet').textContent = betText;
        slot.querySelector('.mp-player-status').textContent = statusText;
        slot.querySelector('.mp-player-status').className = 'mp-player-status' + (p.status === 'ready' ? ' ready' : '') + (p.status === 'waiting' ? ' waiting' : '');
        
        // Karty - obsługa split hands
        const handsEl = slot.querySelector('.mp-player-hands');
        
        // Przygotuj listę rąk do wyświetlenia
        const handsToRender = [];
        if (p.splitHands && p.splitHands.length > 0) {
            p.splitHands.forEach((sh, idx) => {
                handsToRender.push({
                    hand: sh.hand,
                    status: sh.status,
                    isActive: isActive && p.status === 'playing' && idx === (mpCurrentSplitHand[pid] || 0),
                    handIndex: idx
                });
            });
        } else {
            handsToRender.push({
                hand: p.hand,
                status: p.status,
                isActive: isActive,
                handIndex: 0
            });
        }
        
        // Sprawdź czy trzeba przerenderować
        const currentHandKey = handsToRender.map(h => h.hand.length).join(',');
        const prevHandKey = slot.dataset.handKey || '';
        const handsChanged = currentHandKey !== prevHandKey || isNewSlot;
        
        if (handsChanged) {
            handsEl.innerHTML = '';
            handsToRender.forEach((h, hIdx) => {
                const handDiv = document.createElement('div');
                handDiv.className = 'mp-hand' + (h.isActive ? ' active-hand' : '') + (h.status === 'bust' ? ' bust-hand' : '');
                
                // Karty
                const cardsDiv = document.createElement('div');
                cardsDiv.className = 'mp-hand-cards';
                h.hand.forEach((card, cIdx) => {
                    cardsDiv.insertAdjacentHTML('beforeend', mpRenderCardHTML(card, cIdx, false));
                });
                
                // Score
                const scoreDiv = document.createElement('div');
                scoreDiv.className = 'mp-hand-score';
                scoreDiv.textContent = h.hand.length > 0 ? calculateHand(h.hand) : '';
                
                handDiv.appendChild(cardsDiv);
                handDiv.appendChild(scoreDiv);
                handsEl.appendChild(handDiv);
            });
            slot.dataset.handKey = currentHandKey;
        } else {
            // Aktualizuj tylko score i status
            const handDivs = handsEl.querySelectorAll('.mp-hand');
            handDivs.forEach((div, idx) => {
                if (handsToRender[idx]) {
                    div.className = 'mp-hand' + (handsToRender[idx].isActive ? ' active-hand' : '') + (handsToRender[idx].status === 'bust' ? ' bust-hand' : '');
                    div.querySelector('.mp-hand-score').textContent = handsToRender[idx].hand.length > 0 ? calculateHand(handsToRender[idx].hand) : '';
                }
            });
        }
    });
    
    // Usuń sloty graczy którzy odeszli LUB są bankrutami (nie ja)
    existingSlots.forEach(slot => {
        const pid = slot.dataset.playerId;
        const p = mpAllPlayers[pid];
        if (!p || (p.status === 'bankrupt' && pid !== mpMyId)) {
            slot.remove();
        }
    });
    
    // Moje info
    const me = mpAllPlayers[mpMyId];
    if (me) {
        document.getElementById('mp-my-chips').textContent = me.chips;
        document.getElementById('mp-my-bet').textContent = me.bet;
    }
    
    // Kontrolki
    if (mpPhase === 'betting') {
        document.getElementById('mp-insurance-controls').style.display = 'none';
        const meStatus = me ? me.status : '';
        if (meStatus === 'ready') {
            document.getElementById('mp-betting-controls').style.display = 'none';
            document.getElementById('mp-game-controls').style.display = 'none';
            document.getElementById('mp-waiting').style.display = 'block';
            document.getElementById('mp-waiting').textContent = 'Czekam na innych graczy...';
        } else if (meStatus === 'waiting') {
            document.getElementById('mp-betting-controls').style.display = 'none';
            document.getElementById('mp-game-controls').style.display = 'none';
            document.getElementById('mp-waiting').style.display = 'block';
            document.getElementById('mp-waiting').textContent = 'Oczekiwanie na nową rundę...';
        } else if (meStatus === 'bankrupt') {
            document.getElementById('mp-betting-controls').style.display = 'none';
            document.getElementById('mp-game-controls').style.display = 'none';
            document.getElementById('mp-waiting').style.display = 'block';
            document.getElementById('mp-waiting').textContent = 'SPECTATOR - brak żetonów';
        } else {
            document.getElementById('mp-betting-controls').style.display = 'flex';
            document.getElementById('mp-game-controls').style.display = 'none';
            document.getElementById('mp-waiting').style.display = 'none';
        }
    } else if (mpPhase === 'insurance') {
        document.getElementById('mp-betting-controls').style.display = 'none';
        document.getElementById('mp-game-controls').style.display = 'none';
        // Pokaż insurance TYLKO aktualnemu graczowi (mpCurrentPlayerId)
        if (mpCurrentPlayerId === mpMyId && me && me.insurance === null && me.hand.length === 2 && me.status === 'playing') {
            document.getElementById('mp-insurance-controls').style.display = 'flex';
            document.getElementById('mp-waiting').style.display = 'none';
        } else if (mpCurrentPlayerId === mpMyId && me && me.insurance !== null) {
            // Już zdecydowane - czekaj
            document.getElementById('mp-insurance-controls').style.display = 'none';
            document.getElementById('mp-waiting').style.display = 'block';
            document.getElementById('mp-waiting').textContent = 'Czekam na innych graczy...';
        } else {
            document.getElementById('mp-insurance-controls').style.display = 'none';
            document.getElementById('mp-waiting').style.display = 'block';
            if (me && me.insurance !== null && me.insurance > 0) {
                document.getElementById('mp-waiting').textContent = 'Insurance wykupione. Czekam...';
            } else if (me && me.insurance === null && me.hand.length === 2) {
                document.getElementById('mp-waiting').textContent = 'Oczekiwanie na decyzję insurance...';
            } else {
                document.getElementById('mp-waiting').textContent = 'Oczekiwanie na innych...';
            }
        }
    } else if (mpPhase === 'playing') {
        document.getElementById('mp-insurance-controls').style.display = 'none';
        if (mpCurrentPlayerId === mpMyId && me && me.status === 'playing') {
            document.getElementById('mp-betting-controls').style.display = 'none';
            document.getElementById('mp-game-controls').style.display = 'flex';
            document.getElementById('mp-waiting').style.display = 'none';
            // Pokaż przycisk split jeśli można
            const splitBtn = document.getElementById('mp-btn-split');
            if (splitBtn) {
                splitBtn.style.display = (canSplit(me.hand) && me.chips >= me.bet) ? 'inline-block' : 'none';
            }
            // Disable double jeśli nie można
            const doubleBtn = document.getElementById('mp-btn-double');
            if (doubleBtn) {
                doubleBtn.disabled = me.hand.length !== 2 || me.chips < me.bet;
            }
            mpUpdateHintDisplay();
        } else if (me && me.status === 'waiting') {
            document.getElementById('mp-betting-controls').style.display = 'none';
            document.getElementById('mp-game-controls').style.display = 'none';
            document.getElementById('mp-waiting').style.display = 'block';
            document.getElementById('mp-waiting').textContent = 'Oczekiwanie na nową rundę...';
            mpUpdateHintDisplay();
        } else if (me && me.status === 'bankrupt') {
            document.getElementById('mp-betting-controls').style.display = 'none';
            document.getElementById('mp-game-controls').style.display = 'none';
            document.getElementById('mp-waiting').style.display = 'block';
            document.getElementById('mp-waiting').textContent = 'SPECTATOR - brak żetonów';
            mpUpdateHintDisplay();
        } else {
            document.getElementById('mp-betting-controls').style.display = 'none';
            document.getElementById('mp-game-controls').style.display = 'none';
            document.getElementById('mp-insurance-controls').style.display = 'none';
            document.getElementById('mp-waiting').style.display = 'block';
            document.getElementById('mp-waiting').textContent = 'Oczekiwanie na innych...';
            mpUpdateHintDisplay();
        }
    } else {
        document.getElementById('mp-betting-controls').style.display = 'none';
        document.getElementById('mp-game-controls').style.display = 'none';
        document.getElementById('mp-insurance-controls').style.display = 'none';
        document.getElementById('mp-waiting').style.display = 'block';
        if (mpPhase === 'dealer') {
            document.getElementById('mp-waiting').textContent = 'Dealer gra...';
        } else if (mpPhase === 'results') {
            document.getElementById('mp-waiting').textContent = 'Koniec rundy!';
        } else {
            document.getElementById('mp-waiting').textContent = 'Oczekiwanie...';
        }
    }
}

function mpRenderCardHTML(card, index, animate) {
    if (!card) return '';
    const color = (card.suit === '♥' || card.suit === '♦') ? 'red' : 'black';
    const animStyle = animate ? `animation: dealCard 0.4s ease-out;` : '';
    return `
        <div class="card ${color}" style="${animStyle} --rotation: ${(index - 1) * 3}deg">
            <div class="card-top">${card.rank}<br>${card.suit}</div>
            <div class="card-center">${card.suit}</div>
            <div class="card-bottom">${card.rank}<br>${card.suit}</div>
        </div>
    `;
}

function mpShowMessage(msg) {
    const el = document.getElementById('mp-message');
    el.textContent = msg;
    setTimeout(() => {
        if (el.textContent === msg) el.textContent = '';
    }, 3000);
}

function leaveGame() {
    if (mpPeer) { try { mpPeer.destroy(); } catch (e) {} }
    mpPeer = null;
    mpConns = [];
    mpAllPlayers = {};
    mpGameStarted = false;
    showScreen('menu-screen');
}
