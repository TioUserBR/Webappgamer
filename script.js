/*
 * script.js - Lógica do frontend do Jogo da Velha
 * Gerencia WebSocket, interface e interações do usuário
 */

// ==================== CONFIGURAÇÕES ====================

const WEBSOCKET_URL = 'wss://axicld.duckdns.org:3018/ws'; // Altere para sua URL
const MOVE_TIMEOUT = 30;

// ==================== VARIÁVEIS GLOBAIS ====================

let ws = null;
let tg = window.Telegram?.WebApp;
let userId = null;
let username = null;
let firstName = null;
let currentRoom = null;
let mySymbol = null;
let isMyTurn = false;
let gameStatus = 'idle'; // idle, waiting, playing, finished
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

// ==================== INICIALIZAÇÃO ====================

document.addEventListener('DOMContentLoaded', () => {
    initTelegram();
    initWebSocket();
    initEventListeners();
});

function initTelegram() {
    if (tg) {
        tg.ready();
        tg.expand();
        
        // Obtém dados do usuário
        const user = tg.initDataUnsafe?.user;
        if (user) {
            userId = user.id;
            username = user.username;
            firstName = user.first_name;
            
            updatePlayerInfo();
        }
        
        // Configura tema
        document.body.style.setProperty('--bg-primary', tg.backgroundColor || '#1a1a2e');
        
        // Verifica se há room_id na URL (convite)
        const urlParams = new URLSearchParams(window.location.search);
        const roomId = urlParams.get('room');
        const accept = urlParams.get('accept');
        
        if (roomId && accept === '1') {
            // Aguarda conexão WebSocket para aceitar convite
            setTimeout(() => {
                acceptInviteFromUrl(roomId);
            }, 1000);
        }
    } else {
        // Modo de desenvolvimento/teste
        userId = Math.floor(Math.random() * 1000000);
        username = 'test_user';
        firstName = 'Teste';
        updatePlayerInfo();
    }
}

function initWebSocket() {
    updateConnectionStatus('connecting');
    
    try {
        ws = new WebSocket(WEBSOCKET_URL);
        
        ws.onopen = () => {
            console.log('WebSocket conectado');
            updateConnectionStatus('connected');
            reconnectAttempts = 0;
            
            // Registra jogador
            sendMessage({
                type: 'register',
                user_id: userId,
                username: username,
                first_name: firstName
            });
        };
        
        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            handleMessage(data);
        };
        
        ws.onclose = () => {
            console.log('WebSocket desconectado');
            updateConnectionStatus('disconnected');
            
            // Tenta reconectar
            if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                reconnectAttempts++;
                setTimeout(initWebSocket, 2000 * reconnectAttempts);
            }
        };
        
        ws.onerror = (error) => {
            console.error('WebSocket erro:', error);
            updateConnectionStatus('error');
        };
    } catch (error) {
        console.error('Erro ao conectar WebSocket:', error);
        updateConnectionStatus('error');
    }
}

function initEventListeners() {
    // Células do tabuleiro
    document.querySelectorAll('.cell').forEach(cell => {
        cell.addEventListener('click', () => {
            const index = parseInt(cell.dataset.index);
            makeMove(index);
        });
    });
    
    // Botões
    document.getElementById('btn-refresh')?.addEventListener('click', refreshOnlinePlayers);
    document.getElementById('btn-new-game')?.addEventListener('click', requestNewGame);
    document.getElementById('btn-leave-game')?.addEventListener('click', leaveGame);
    document.getElementById('btn-cancel-wait')?.addEventListener('click', cancelWait);
    
    // Resultado do jogo - clique para fechar
    document.getElementById('game-result')?.addEventListener('click', closeResult);
}

// ==================== WEBSOCKET HANDLERS ====================

function sendMessage(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    }
}

function handleMessage(data) {
    console.log('Mensagem recebida:', data);
    
    switch (data.type) {
        case 'registered':
            handleRegistered(data);
            break;
        case 'online_players':
            updateOnlinePlayersList(data.players);
            break;
        case 'room_update':
            handleRoomUpdate(data);
            break;
        case 'room_created':
            handleRoomCreated(data);
            break;
        case 'game_started':
            handleGameStarted(data);
            break;
        case 'timer_update':
            updateTimer(data.remaining);
            break;
        case 'timeout':
            handleTimeout(data);
            break;
        case 'opponent_disconnected':
        case 'opponent_left':
            handleOpponentLeft(data);
            break;
        case 'invite_result':
            handleInviteResult(data);
            break;
        case 'invite_expired':
            handleInviteExpired(data);
            break;
        case 'accept_invite_result':
            handleAcceptInviteResult(data);
            break;
        case 'stats':
            updatePlayerStats(data.player);
            break;
        case 'left_game':
            handleLeftGame();
            break;
        case 'error':
            showError(data.message);
            break;
    }
}

// ==================== HANDLERS ====================

function handleRegistered(data) {
    console.log('Registrado:', data);
    
    if (data.current_room && data.in_game) {
        currentRoom = data.current_room;
        gameStatus = 'playing';
    }
    
    // Solicita lista de jogadores online
    sendMessage({ type: 'get_online_players' });
    
    // Solicita estatísticas
    sendMessage({ type: 'get_stats' });
}

function handleRoomUpdate(data) {
    currentRoom = data.room_id;
    
    // Atualiza informações dos jogadores
    const playerXInfo = data.player_x_info || {};
    const playerOInfo = data.player_o_info || {};
    
    document.getElementById('player-x-name').textContent = 
        playerXInfo.first_name || playerXInfo.username || 'Jogador X';
    document.getElementById('player-o-name').textContent = 
        playerOInfo.first_name || playerOInfo.username || 'Jogador O';
    
    // Determina meu símbolo
    if (data.player_x === userId) {
        mySymbol = 'X';
    } else if (data.player_o === userId) {
        mySymbol = 'O';
    }
    
    // Atualiza turno
    isMyTurn = (data.current_turn === mySymbol);
    updateTurnIndicator(data.current_turn, data.player_x, data.player_o);
    
    // Atualiza primeiro jogador
    document.getElementById('first-player-symbol').textContent = data.first_player;
    
    // Atualiza tabuleiro
    updateBoard(data.board);
    
    // Atualiza status
    if (data.status === 'playing') {
        gameStatus = 'playing';
        showGameScreen();
    } else if (data.status === 'finished') {
        gameStatus = 'finished';
        showGameResult(data);
    }
    
    // Atualiza timer
    if (data.timeout_remaining !== undefined) {
        updateTimer(data.timeout_remaining);
    }
}

function handleRoomCreated(data) {
    currentRoom = data.room_id;
    
    if (data.status === 'waiting') {
        gameStatus = 'waiting';
        showWaitingScreen('Aguardando oponente aceitar o convite...');
    }
}

function handleGameStarted(data) {
    gameStatus = 'playing';
    currentRoom = data.room_id;
    showGameScreen();
}

function handleTimeout(data) {
    const timedOutPlayer = data.timed_out_player;
    
    if (timedOutPlayer === userId) {
        showAlert('⏱️ Tempo esgotado! Você perdeu por W.O.');
    } else {
        showAlert('⏱️ Oponente demorou demais! Você venceu!');
    }
}

function handleOpponentLeft(data) {
    showAlert('🚪 Oponente saiu da partida! Você venceu!');
    gameStatus = 'finished';
    
    setTimeout(() => {
        resetToMenu();
    }, 2000);
}

function handleInviteResult(data) {
    if (data.success) {
        currentRoom = data.room_id;
        gameStatus = 'waiting';
        showWaitingScreen('Convite enviado! Aguardando resposta...');
    } else {
        showError(data.error || 'Erro ao enviar convite');
        resetToMenu();
    }
}

function handleInviteExpired(data) {
    showAlert('⏱️ Convite expirou!');
    resetToMenu();
}

function handleAcceptInviteResult(data) {
    if (data.success) {
        currentRoom = data.room_id;
        gameStatus = 'playing';
        showGameScreen();
    } else {
        showError(data.error || 'Erro ao aceitar convite');
    }
}

function handleLeftGame() {
    resetToMenu();
}

// ==================== AÇÕES DO JOGADOR ====================

function makeMove(position) {
    if (!isMyTurn || gameStatus !== 'playing') {
        return;
    }
    
    const cell = document.querySelector(`[data-index="${position}"]`);
    if (cell.classList.contains('filled')) {
        return;
    }
    
    sendMessage({
        type: 'move',
        room_id: currentRoom,
        position: position
    });
}

function invitePlayer(targetUserId) {
    if (gameStatus !== 'idle') {
        showError('Você já está em uma partida ou aguardando');
        return;
    }
    
    sendMessage({
        type: 'invite',
        to_user_id: targetUserId
    });
}

function acceptInviteFromUrl(roomId) {
    sendMessage({
        type: 'accept_invite',
        room_id: roomId
    });
}

function requestNewGame() {
    if (gameStatus === 'playing') {
        if (!confirm('Tem certeza que deseja sair da partida atual?')) {
            return;
        }
        leaveGame();
    }
    
    resetToMenu();
}

function leaveGame() {
    sendMessage({ type: 'leave_game' });
}

function cancelWait() {
    sendMessage({ type: 'leave_game' });
    resetToMenu();
}

function refreshOnlinePlayers() {
    sendMessage({ type: 'get_online_players' });
}

// ==================== ATUALIZAÇÃO DA UI ====================

function updateConnectionStatus(status) {
    const statusDot = document.querySelector('.status-dot');
    const statusText = document.querySelector('.status-text');
    
    statusDot.classList.remove('connected', 'error');
    
    switch (status) {
        case 'connecting':
            statusText.textContent = 'Conectando...';
            break;
        case 'connected':
            statusDot.classList.add('connected');
            statusText.textContent = 'Online';
            break;
        case 'disconnected':
            statusText.textContent = 'Desconectado';
            break;
        case 'error':
            statusDot.classList.add('error');
            statusText.textContent = 'Erro de conexão';
            break;
    }
}

function updatePlayerInfo() {
    const nameEl = document.getElementById('player-name');
    if (nameEl) {
        nameEl.textContent = firstName || username || `Jogador ${userId}`;
    }
}

function updatePlayerStats(player) {
    if (player) {
        const statsEl = document.getElementById('player-stats');
        if (statsEl) {
            statsEl.textContent = `${player.points || 0} pts`;
        }
    }
}

function updateOnlinePlayersList(players) {
    const container = document.getElementById('online-players');
    
    // Filtra o próprio jogador
    const otherPlayers = players.filter(p => p.user_id !== userId);
    
    if (otherPlayers.length === 0) {
        container.innerHTML = '<div class="no-players">Nenhum jogador online no momento</div>';
        return;
    }
    
    container.innerHTML = otherPlayers.map(player => {
        const name = player.first_name || player.username || `User ${player.user_id}`;
        const inGame = player.in_game;
        
        return `
            <div class="online-player">
                <div class="online-player-info">
                    <span class="online-indicator ${inGame ? 'in-game' : ''}"></span>
                    <span class="online-player-name">${escapeHtml(name)}</span>
                </div>
                <button 
                    class="btn-invite" 
                    onclick="invitePlayer(${player.user_id})"
                    ${inGame ? 'disabled title="Jogador em partida"' : ''}
                >
                    ${inGame ? 'Em jogo' : 'Convidar'}
                </button>
            </div>
        `;
    }).join('');
}

function updateBoard(board) {
    document.querySelectorAll('.cell').forEach((cell, index) => {
        const value = board[index];
        
        cell.textContent = value || '';
        cell.classList.remove('x', 'o', 'filled', 'disabled');
        
        if (value) {
            cell.classList.add(value.toLowerCase(), 'filled');
        }
        
        if (!isMyTurn || gameStatus !== 'playing') {
            cell.classList.add('disabled');
        }
    });
}

function updateTurnIndicator(currentTurn, playerX, playerO) {
    const turnText = document.getElementById('turn-text');
    const playerXDisplay = document.getElementById('player-x-display');
    const playerODisplay = document.getElementById('player-o-display');
    
    playerXDisplay.classList.remove('active');
    playerODisplay.classList.remove('active');
    
    if (currentTurn === 'X') {
        playerXDisplay.classList.add('active');
    } else {
        playerODisplay.classList.add('active');
    }
    
    if (isMyTurn) {
        turnText.textContent = '🎯 Sua vez!';
    } else {
        turnText.textContent = `Turno: ${currentTurn}`;
    }
}

function updateTimer(remaining) {
    const timerEl = document.getElementById('timer');
    timerEl.textContent = `${remaining}s`;
    
    if (remaining <= 10) {
        timerEl.classList.add('urgent');
    } else {
        timerEl.classList.remove('urgent');
    }
}

function showGameScreen() {
    document.getElementById('menu').classList.add('hidden');
    document.getElementById('waiting').classList.add('hidden');
    document.getElementById('game-status').classList.remove('hidden');
    document.getElementById('game-board').classList.remove('hidden');
    document.getElementById('game-actions').classList.remove('hidden');
    document.getElementById('game-result').classList.add('hidden');
}

function showWaitingScreen(message) {
    document.getElementById('menu').classList.add('hidden');
    document.getElementById('game-status').classList.add('hidden');
    document.getElementById('game-board').classList.add('hidden');
    document.getElementById('game-actions').classList.add('hidden');
    document.getElementById('game-result').classList.add('hidden');
    
    document.getElementById('waiting-message').textContent = message;
    document.getElementById('waiting').classList.remove('hidden');
}

function showGameResult(data) {
    const resultContainer = document.getElementById('game-result');
    const resultIcon = document.getElementById('result-icon');
    const resultTitle = document.getElementById('result-title');
    const resultMessage = document.getElementById('result-message');
    const pointsEarned = document.getElementById('points-earned');
    
    if (data.is_draw) {
        resultIcon.textContent = '🤝';
        resultTitle.textContent = 'Empate!';
        resultMessage.textContent = 'A partida terminou empatada.';
        pointsEarned.textContent = '+1 ponto';
        pointsEarned.className = 'points-earned draw';
    } else if (data.winner === userId) {
        resultIcon.textContent = '🏆';
        resultTitle.textContent = 'Você Venceu!';
        resultMessage.textContent = 'Parabéns pela vitória!';
        pointsEarned.textContent = '+3 pontos';
        pointsEarned.className = 'points-earned';
    } else {
        resultIcon.textContent = '😔';
        resultTitle.textContent = 'Você Perdeu';
        resultMessage.textContent = 'Não desanime, tente novamente!';
        pointsEarned.textContent = '0 pontos';
        pointsEarned.className = 'points-earned lose';
    }
    
    resultContainer.classList.remove('hidden');
    
    // Atualiza estatísticas
    sendMessage({ type: 'get_stats' });
}

function closeResult() {
    document.getElementById('game-result').classList.add('hidden');
    resetToMenu();
}

function resetToMenu() {
    gameStatus = 'idle';
    currentRoom = null;
    mySymbol = null;
    isMyTurn = false;
    
    document.getElementById('menu').classList.remove('hidden');
    document.getElementById('waiting').classList.add('hidden');
    document.getElementById('game-status').classList.add('hidden');
    document.getElementById('game-board').classList.add('hidden');
    document.getElementById('game-actions').classList.add('hidden');
    document.getElementById('game-result').classList.add('hidden');
    
    // Limpa tabuleiro
    document.querySelectorAll('.cell').forEach(cell => {
        cell.textContent = '';
        cell.classList.remove('x', 'o', 'filled', 'disabled', 'winning');
    });
    
    // Atualiza lista de jogadores
    refreshOnlinePlayers();
}

// ==================== UTILITÁRIOS ====================

function showAlert(message) {
    if (tg) {
        tg.showAlert(message);
    } else {
        alert(message);
    }
}

function showError(message) {
    console.error(message);
    showAlert('❌ ' + message);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Expõe função para uso no HTML

window.invitePlayer = invitePlayer;
