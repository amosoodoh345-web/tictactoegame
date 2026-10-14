/* =======================================================================
   TIC-TAC-TOE — Vanilla JS client
   Supports three modes:
     1. Local pass-and-play (2 Players)
     2. Single player vs AI (minimax "hard" + random "easy")
     3. Online multiplayer over Socket.IO, backed by a Neon Postgres
        database on the server for profiles / scores / match history.

   Local & AI modes persist to localStorage and work even when this file
   is opened directly from disk. Online mode requires the Node server in
   this project to be running (see README.md) because it needs Socket.IO
   and the Neon-backed REST endpoints.
   ======================================================================= */

(function () {
  'use strict';

  // ---------- Constants ----------
  const STORAGE_KEY = 'tictactoe.state.v1';
  const ONLINE_PROFILE_KEY = 'tictactoe.onlineProfile.v1';
  const WIN_LINES = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
    [0, 3, 6], [1, 4, 7], [2, 5, 8], // columns
    [0, 4, 8], [2, 4, 6]             // diagonals
  ];

  // ---------- DOM references ----------
  const boardEl = document.getElementById('board');
  const statusEl = document.getElementById('status');
  const scoreboardEl = document.getElementById('scoreboard');
  const historyTitleEl = document.getElementById('historyTitle');
  const historyListEl = document.getElementById('historyList');
  const leaderboardPanelEl = document.getElementById('leaderboardPanel');
  const leaderboardListEl = document.getElementById('leaderboardList');

  const playerXNameEl = document.getElementById('playerXName');
  const playerONameEl = document.getElementById('playerOName');
  const playerXLabel = document.getElementById('playerXLabel');
  const playerOLabel = document.getElementById('playerOLabel');
  const aiDifficultyField = document.getElementById('aiDifficultyField');
  const aiDifficultyEl = document.getElementById('aiDifficulty');

  const modePvpBtn = document.getElementById('modePvp');
  const modeAiBtn = document.getElementById('modeAi');
  const modeOnlineBtn = document.getElementById('modeOnline');

  const symbolStarterRow = document.getElementById('symbolStarterRow');
  const symbolGroup = document.getElementById('symbolGroup');
  const starterGroup = document.getElementById('starterGroup');

  const localControls = document.getElementById('localControls');
  const restartBtn = document.getElementById('restartBtn');
  const resetScoreBtn = document.getElementById('resetScoreBtn');
  const clearHistoryBtn = document.getElementById('clearHistoryBtn');

  const onlinePanel = document.getElementById('onlinePanel');
  const connectionDot = document.getElementById('connectionDot');
  const connectionLabel = document.getElementById('connectionLabel');
  const onlineNameEl = document.getElementById('onlineName');
  const onlineLobbyEl = document.getElementById('onlineLobby');
  const onlineRoomEl = document.getElementById('onlineRoom');
  const createRoomBtn = document.getElementById('createRoomBtn');
  const joinRoomCodeEl = document.getElementById('joinRoomCode');
  const joinRoomBtn = document.getElementById('joinRoomBtn');
  const roomCodeDisplayEl = document.getElementById('roomCodeDisplay');
  const roomHintEl = document.getElementById('roomHint');
  const rematchBtn = document.getElementById('rematchBtn');
  const leaveRoomBtn = document.getElementById('leaveRoomBtn');

  // ---------- Persisted state (local/AI modes) ----------
  let state = loadState();

  // ---------- Live game being played right now (rendered on the board) ----------
  let game = {
    board: Array(9).fill(null),
    current: state.starter,
    winner: null,
    winningLine: null,
    locked: false // true while the AI is "thinking"
  };

  // ---------- Online multiplayer runtime state (not persisted directly) ----------
  const online = {
    socket: null,
    connected: false,
    inRoom: false,
    roomCode: null,
    mySymbol: null,
    players: null,  // { X: {name, connected}|null, O: {...}|null } from server
    opponentName: null,
    stats: null     // { wins, losses, draws } from Neon via REST
  };

  let onlineProfile = loadOnlineProfile();

  // =====================================================================
  // LocalStorage helpers
  // =====================================================================
  function defaultState() {
    return {
      mode: 'pvp',              // 'pvp' | 'ai' | 'online'
      playerXName: '',
      playerOName: '',
      humanSymbol: 'O',          // used in AI mode: which symbol the human plays
      starter: 'O',              // which symbol goes first
      aiDifficulty: 'hard',
      scores: { X: 0, O: 0, draws: 0 },
      history: []                // array of {date, summary} for local/AI games
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      return Object.assign(defaultState(), JSON.parse(raw));
    } catch (e) {
      console.warn('Failed to load saved state, using defaults.', e);
      return defaultState();
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn('Failed to save state to LocalStorage.', e);
    }
  }

  function generateId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    // Fallback for older browsers without crypto.randomUUID.
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function loadOnlineProfile() {
    try {
      const raw = localStorage.getItem(ONLINE_PROFILE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {
      console.warn('Failed to load online profile.', e);
    }
    const fresh = { id: generateId(), name: '' };
    localStorage.setItem(ONLINE_PROFILE_KEY, JSON.stringify(fresh));
    return fresh;
  }

  function saveOnlineProfile() {
    try {
      localStorage.setItem(ONLINE_PROFILE_KEY, JSON.stringify(onlineProfile));
    } catch (e) {
      console.warn('Failed to save online profile.', e);
    }
  }

  // =====================================================================
  // Rendering: board
  // =====================================================================
  function renderBoard() {
    boardEl.innerHTML = '';
    game.board.forEach((mark, i) => {
      const btn = document.createElement('button');
      btn.className = 'cell';
      btn.setAttribute('data-index', i);
      btn.disabled = isCellDisabled(i);
      if (game.winningLine && game.winningLine.includes(i)) {
        btn.classList.add('win-cell');
      }
      if (mark) btn.appendChild(markSvg(mark));
      btn.addEventListener('click', () => handleCellClick(i));
      boardEl.appendChild(btn);
    });
  }

  function isCellDisabled(i) {
    if (game.board[i] || game.winner) return true;
    if (state.mode === 'online') {
      return !online.inRoom || !bothPlayersPresent() || game.current !== online.mySymbol;
    }
    return game.locked;
  }

  function markSvg(symbol) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    if (symbol === 'X') {
      svg.innerHTML = '<path class="mark-x" d="M5 5L19 19M19 5L5 19" stroke-width="3" stroke-linecap="round"/>';
    } else {
      svg.innerHTML = '<circle class="mark-o" cx="12" cy="12" r="7" stroke-width="3"/>';
    }
    return svg;
  }

  // =====================================================================
  // Rendering: status / scoreboard / history / leaderboard
  // =====================================================================
  function playerLabel(symbol) {
    if (state.mode === 'online') {
      if (symbol === online.mySymbol) return onlineProfile.name || 'You';
      return online.opponentName || 'Opponent';
    }
    if (symbol === 'X') return state.playerXName.trim() || 'Player X';
    return state.playerOName.trim() || 'Player O';
  }

  function bothPlayersPresent() {
    return !!(online.players && online.players.X && online.players.O);
  }

  function renderStatus() {
    statusEl.classList.remove('win', 'draw', 'error');

    if (state.mode === 'online') {
      if (!online.socket) {
        statusEl.textContent = 'Online mode needs the server. See README.md to run it.';
        statusEl.classList.add('error');
        return;
      }
      if (!online.connected) {
        statusEl.textContent = 'Connecting to server...';
        return;
      }
      if (!online.inRoom) {
        statusEl.textContent = 'Create a room or join one with a code to play online.';
        return;
      }
      if (!bothPlayersPresent()) {
        statusEl.textContent = 'Waiting for an opponent to join...';
        return;
      }
      if (game.winner === 'draw') {
        statusEl.textContent = "It's a draw!";
        statusEl.classList.add('draw');
        return;
      }
      if (game.winner) {
        const winnerName = game.winner === online.mySymbol ? 'You' : (online.opponentName || 'Opponent');
        statusEl.textContent = `${winnerName} (${game.winner}) won!`;
        statusEl.classList.add('win');
        return;
      }
      statusEl.textContent = game.current === online.mySymbol
        ? 'Your turn'
        : `${online.opponentName || 'Opponent'}'s turn`;
      return;
    }

    // Local (pvp / ai) status
    if (game.winner === 'draw') {
      statusEl.textContent = "It's a draw!";
      statusEl.classList.add('draw');
    } else if (game.winner) {
      statusEl.textContent = `${playerLabel(game.winner)} (${game.winner}) wins!`;
      statusEl.classList.add('win');
    } else {
      const label = state.mode === 'ai' && game.current !== state.humanSymbol
        ? 'AI is thinking...'
        : `${playerLabel(game.current)}'s turn (${game.current})`;
      statusEl.textContent = label;
    }
  }

  function renderScoreboard() {
    if (state.mode === 'online') {
      const stats = online.stats || { wins: 0, losses: 0, draws: 0 };
      scoreboardEl.innerHTML = `
        <div class="score-card">
          <div class="label">Wins</div>
          <div class="value">${stats.wins}</div>
        </div>
        <div class="score-card">
          <div class="label">Draws</div>
          <div class="value">${stats.draws}</div>
        </div>
        <div class="score-card">
          <div class="label">Losses</div>
          <div class="value">${stats.losses}</div>
        </div>
      `;
      return;
    }

    scoreboardEl.innerHTML = `
      <div class="score-card">
        <div class="label">${escapeHtml(playerLabel('X'))} (X)</div>
        <div class="value">${state.scores.X}</div>
      </div>
      <div class="score-card">
        <div class="label">Draws</div>
        <div class="value">${state.scores.draws}</div>
      </div>
      <div class="score-card">
        <div class="label">${escapeHtml(playerLabel('O'))} (O)</div>
        <div class="value">${state.scores.O}</div>
      </div>
    `;
  }

  function renderHistory() {
    historyTitleEl.textContent = state.mode === 'online' ? 'Your Online Matches' : 'Match History';

    if (state.mode === 'online') {
      // Online history is rendered separately via renderOnlineHistory() once
      // fetched from the server; show a neutral placeholder until then.
      if (!historyListEl.dataset.online) {
        historyListEl.innerHTML = '<div class="empty">Loading match history...</div>';
      }
      return;
    }

    historyListEl.dataset.online = '';
    if (!state.history.length) {
      historyListEl.innerHTML = '<div class="empty">No matches played yet.</div>';
      return;
    }
    const items = state.history
      .slice()
      .reverse()
      .map(h => `<li><span>${escapeHtml(h.summary)}</span><span>${escapeHtml(h.date)}</span></li>`)
      .join('');
    historyListEl.innerHTML = `<ul>${items}</ul>`;
  }

  function renderOnlineHistory(matches) {
    historyListEl.dataset.online = '1';
    if (!matches || !matches.length) {
      historyListEl.innerHTML = '<div class="empty">No online matches yet. Create or join a room!</div>';
      return;
    }
    const items = matches.map(m => {
      const youAreX = m.player_x_name && onlineProfile.name && m.player_x_name === onlineProfile.name;
      let resultLabel;
      if (m.winner === 'draw') {
        resultLabel = 'Draw';
      } else {
        resultLabel = `${m.winner === 'X' ? m.player_x_name : m.player_o_name} won`;
      }
      const opponent = youAreX ? m.player_o_name : m.player_x_name;
      const date = new Date(m.played_at).toLocaleString();
      return `<li><span>vs ${escapeHtml(opponent || '???')} — ${escapeHtml(resultLabel)}</span><span>${escapeHtml(date)}</span></li>`;
    }).join('');
    historyListEl.innerHTML = `<ul>${items}</ul>`;
  }

  function renderLeaderboard(rows) {
    if (!rows || !rows.length) {
      leaderboardListEl.innerHTML = '<div class="empty">No ranked players yet.</div>';
      return;
    }
    const items = rows.map((r, i) =>
      `<li><span>#${i + 1} ${escapeHtml(r.name)}</span><span>${r.wins}W / ${r.draws}D / ${r.losses}L</span></li>`
    ).join('');
    leaderboardListEl.innerHTML = `<ul>${items}</ul>`;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = String(str == null ? '' : str);
    return div.innerHTML;
  }

  function renderAll() {
    renderBoard();
    renderStatus();
    renderScoreboard();
    renderHistory();
  }

  // =====================================================================
  // Shared game rules (used by local, AI, and to mirror server state)
  // =====================================================================
  function checkWinner(board) {
    for (const line of WIN_LINES) {
      const [a, b, c] = line;
      if (board[a] && board[a] === board[b] && board[a] === board[c]) {
        return { winner: board[a], line };
      }
    }
    if (board.every(cell => cell)) {
      return { winner: 'draw', line: null };
    }
    return null;
  }

  // =====================================================================
  // Cell click dispatch
  // =====================================================================
  function handleCellClick(index) {
    if (state.mode === 'online') {
      handleOnlineCellClick(index);
      return;
    }

    if (game.locked || game.winner || game.board[index]) return;
    if (state.mode === 'ai' && game.current !== state.humanSymbol) return;

    makeLocalMove(index, game.current);

    if (state.mode === 'ai' && !game.winner) {
      game.locked = true;
      renderAll();
      setTimeout(() => {
        const aiMove = chooseAiMove();
        if (aiMove !== null) makeLocalMove(aiMove, game.current);
        game.locked = false;
        renderAll();
      }, 400);
    } else {
      renderAll();
    }
  }

  function makeLocalMove(index, symbol) {
    game.board[index] = symbol;
    const result = checkWinner(game.board);
    if (result) {
      game.winner = result.winner;
      game.winningLine = result.line;
      recordLocalResult(result.winner);
    } else {
      game.current = symbol === 'X' ? 'O' : 'X';
    }
  }

  function recordLocalResult(winner) {
    if (winner === 'draw') {
      state.scores.draws++;
    } else {
      state.scores[winner]++;
    }

    const modeLabel = state.mode === 'ai' ? 'Vs AI' : '2 Players';
    const summary = winner === 'draw'
      ? `${modeLabel}: Draw`
      : `${modeLabel}: ${playerLabel(winner)} (${winner}) won`;

    state.history.push({ date: new Date().toLocaleString(), summary });
    if (state.history.length > 50) state.history.shift();
    saveState();
  }

  // =====================================================================
  // AI logic (minimax + easy random)
  // =====================================================================
  function chooseAiMove() {
    const aiSymbol = game.current;
    const empty = game.board.map((v, i) => v === null ? i : null).filter(v => v !== null);
    if (!empty.length) return null;

    if (state.aiDifficulty === 'easy') {
      return empty[Math.floor(Math.random() * empty.length)];
    }

    const humanSymbol = aiSymbol === 'X' ? 'O' : 'X';
    let bestScore = -Infinity;
    let bestMove = empty[0];
    for (const idx of empty) {
      game.board[idx] = aiSymbol;
      const score = minimax(game.board, 0, false, aiSymbol, humanSymbol);
      game.board[idx] = null;
      if (score > bestScore) {
        bestScore = score;
        bestMove = idx;
      }
    }
    return bestMove;
  }

  function minimax(board, depth, isMaximizing, aiSymbol, humanSymbol) {
    const result = checkWinner(board);
    if (result) {
      if (result.winner === aiSymbol) return 10 - depth;
      if (result.winner === humanSymbol) return depth - 10;
      return 0;
    }

    const empty = board.map((v, i) => v === null ? i : null).filter(v => v !== null);

    if (isMaximizing) {
      let best = -Infinity;
      for (const idx of empty) {
        board[idx] = aiSymbol;
        best = Math.max(best, minimax(board, depth + 1, false, aiSymbol, humanSymbol));
        board[idx] = null;
      }
      return best;
    } else {
      let best = Infinity;
      for (const idx of empty) {
        board[idx] = humanSymbol;
        best = Math.min(best, minimax(board, depth + 1, true, aiSymbol, humanSymbol));
        board[idx] = null;
      }
      return best;
    }
  }

  // =====================================================================
  // New game / restart (local & AI modes)
  // =====================================================================
  function startNewGame() {
    game = {
      board: Array(9).fill(null),
      current: state.starter,
      winner: null,
      winningLine: null,
      locked: false
    };

    if (state.mode === 'ai' && game.current !== state.humanSymbol) {
      game.locked = true;
      renderAll();
      setTimeout(() => {
        const aiMove = chooseAiMove();
        if (aiMove !== null) makeLocalMove(aiMove, game.current);
        game.locked = false;
        renderAll();
      }, 400);
      return;
    }
    renderAll();
  }

  // =====================================================================
  // Online multiplayer (Socket.IO + Neon-backed REST endpoints)
  // =====================================================================
  function ensureSocket() {
    if (online.socket) return online.socket;
    if (typeof io === 'undefined') {
      // socket.io/socket.io.js failed to load — most likely the Node
      // server isn't running, or the page was opened via file://.
      return null;
    }

    const socket = io();
    online.socket = socket;

    socket.on('connect', () => {
      online.connected = true;
      updateConnectionUI();
      renderStatus();
    });

    socket.on('disconnect', () => {
      online.connected = false;
      online.inRoom = false;
      online.players = null;
      updateConnectionUI();
      renderOnlineRoomUI();
      renderStatus();
    });

    socket.on('state-update', applyServerState);

    socket.on('opponent-left', () => {
      roomHintEl.textContent = 'Your opponent left the room.';
      if (online.players) {
        const oppSymbol = online.mySymbol === 'X' ? 'O' : 'X';
        online.players[oppSymbol] = null;
      }
      renderStatus();
    });

    socket.on('stats-update', (stats) => {
      online.stats = stats;
      renderScoreboard();
    });

    return socket;
  }

  function updateConnectionUI() {
    connectionDot.classList.remove('connected', 'connecting');
    if (online.connected) {
      connectionDot.classList.add('connected');
      connectionLabel.textContent = 'Connected';
    } else if (online.socket) {
      connectionDot.classList.add('connecting');
      connectionLabel.textContent = 'Connecting...';
    } else {
      connectionLabel.textContent = 'Offline (server not running)';
    }
  }

  function applyServerState(s) {
    online.roomCode = s.roomCode;
    online.players = s.players;
    game.board = s.board;
    game.current = s.current;
    game.winner = s.winner;
    game.winningLine = s.winningLine;

    const oppSymbol = online.mySymbol === 'X' ? 'O' : 'X';
    online.opponentName = s.players[oppSymbol] ? s.players[oppSymbol].name : null;

    rematchBtn.style.display = game.winner ? 'inline-block' : 'none';
    roomHintEl.textContent = bothPlayersPresent()
      ? ''
      : 'Waiting for an opponent to join...';

    renderAll();

    if (game.winner) {
      // Give the server a brief moment to finish writing to Neon, then
      // pull fresh stats/history/leaderboard.
      setTimeout(() => {
        refreshOnlineProfile();
        refreshLeaderboard();
      }, 300);
    }
  }

  function renderOnlineRoomUI() {
    if (online.inRoom) {
      onlineLobbyEl.style.display = 'none';
      onlineRoomEl.style.display = 'block';
      roomCodeDisplayEl.textContent = online.roomCode || '------';
    } else {
      onlineLobbyEl.style.display = 'block';
      onlineRoomEl.style.display = 'none';
      rematchBtn.style.display = 'none';
    }
    updateConnectionUI();
  }

  function setOnlineError(message) {
    statusEl.textContent = message;
    statusEl.classList.add('error');
  }

  async function refreshLeaderboard() {
    try {
      const res = await fetch('/api/leaderboard');
      if (!res.ok) throw new Error('bad status');
      renderLeaderboard(await res.json());
    } catch (e) {
      leaderboardListEl.innerHTML = '<div class="empty">Leaderboard unavailable.</div>';
    }
  }

  async function refreshOnlineProfile() {
    try {
      const res = await fetch(`/api/players/${encodeURIComponent(onlineProfile.id)}/history`);
      if (!res.ok) throw new Error('bad status');
      const data = await res.json();
      online.stats = data.player || { wins: 0, losses: 0, draws: 0 };
      renderOnlineHistory(data.matches || []);
      renderScoreboard();
    } catch (e) {
      historyListEl.dataset.online = '1';
      historyListEl.innerHTML = '<div class="empty">Could not load match history.</div>';
    }
  }

  function handleOnlineCellClick(index) {
    if (!online.socket || !online.inRoom || game.winner) return;
    if (!bothPlayersPresent()) return;
    if (game.current !== online.mySymbol) return;
    if (game.board[index]) return;
    online.socket.emit('make-move', { roomCode: online.roomCode, index });
  }

  createRoomBtn.addEventListener('click', () => {
    const socket = ensureSocket();
    if (!socket) { setOnlineError('Start the Node server to use Online mode (see README.md).'); return; }
    const name = onlineNameEl.value.trim() || 'Player';
    onlineProfile.name = name;
    saveOnlineProfile();
    createRoomBtn.disabled = true;
    socket.emit('create-room', { playerId: onlineProfile.id, playerName: name }, (res) => {
      createRoomBtn.disabled = false;
      if (!res || !res.ok) { setOnlineError((res && res.error) || 'Failed to create room.'); return; }
      online.inRoom = true;
      online.roomCode = res.roomCode;
      online.mySymbol = res.symbol;
      renderOnlineRoomUI();
      applyServerState(res.state);
    });
  });

  joinRoomBtn.addEventListener('click', () => {
    const socket = ensureSocket();
    if (!socket) { setOnlineError('Start the Node server to use Online mode (see README.md).'); return; }
    const code = joinRoomCodeEl.value.trim().toUpperCase();
    if (!code) { setOnlineError('Enter a room code to join.'); return; }
    const name = onlineNameEl.value.trim() || 'Player';
    onlineProfile.name = name;
    saveOnlineProfile();
    joinRoomBtn.disabled = true;
    socket.emit('join-room', { roomCode: code, playerId: onlineProfile.id, playerName: name }, (res) => {
      joinRoomBtn.disabled = false;
      if (!res || !res.ok) { setOnlineError((res && res.error) || 'Failed to join room.'); return; }
      online.inRoom = true;
      online.roomCode = res.roomCode;
      online.mySymbol = res.symbol;
      renderOnlineRoomUI();
      applyServerState(res.state);
    });
  });

  rematchBtn.addEventListener('click', () => {
    if (online.socket && online.roomCode) {
      online.socket.emit('rematch', { roomCode: online.roomCode });
    }
  });

  leaveRoomBtn.addEventListener('click', () => {
    if (online.socket && online.roomCode) {
      online.socket.emit('leave-room', { roomCode: online.roomCode });
    }
    online.inRoom = false;
    online.roomCode = null;
    online.mySymbol = null;
    online.players = null;
    online.opponentName = null;
    game = { board: Array(9).fill(null), current: 'X', winner: null, winningLine: null, locked: false };
    renderOnlineRoomUI();
    renderAll();
  });

  onlineNameEl.addEventListener('input', () => {
    onlineProfile.name = onlineNameEl.value;
    saveOnlineProfile();
  });

  // =====================================================================
  // Mode switching & other controls
  // =====================================================================
  function setMode(mode) {
    state.mode = mode;
    saveState();

    modePvpBtn.classList.toggle('active', mode === 'pvp');
    modeAiBtn.classList.toggle('active', mode === 'ai');
    modeOnlineBtn.classList.toggle('active', mode === 'online');

    const isOnline = mode === 'online';
    const isAi = mode === 'ai';

    aiDifficultyField.style.display = isAi ? 'block' : 'none';
    onlinePanel.style.display = isOnline ? 'block' : 'none';
    symbolStarterRow.style.display = isOnline ? 'none' : 'flex';
    localControls.style.display = isOnline ? 'none' : 'flex';
    leaderboardPanelEl.style.display = isOnline ? 'block' : 'none';

    playerXLabel.style.display = (!isOnline && !(isAi && state.humanSymbol === 'O')) ? 'block' : 'none';
    playerOLabel.style.display = (!isOnline && !(isAi && state.humanSymbol === 'X')) ? 'block' : 'none';

    if (isOnline) {
      onlineNameEl.value = onlineProfile.name || '';
      ensureSocket();
      renderOnlineRoomUI();
      refreshLeaderboard();
      refreshOnlineProfile();
      game = { board: Array(9).fill(null), current: 'X', winner: null, winningLine: null, locked: false };
      renderAll();
    } else {
      startNewGame();
    }
  }

  modePvpBtn.addEventListener('click', () => setMode('pvp'));
  modeAiBtn.addEventListener('click', () => setMode('ai'));
  modeOnlineBtn.addEventListener('click', () => setMode('online'));

  playerXNameEl.addEventListener('input', () => {
    state.playerXName = playerXNameEl.value;
    saveState();
    renderStatus();
    renderScoreboard();
  });

  playerONameEl.addEventListener('input', () => {
    state.playerOName = playerONameEl.value;
    saveState();
    renderStatus();
    renderScoreboard();
  });

  aiDifficultyEl.addEventListener('change', () => {
    state.aiDifficulty = aiDifficultyEl.value;
    saveState();
  });

  symbolGroup.addEventListener('click', (e) => {
    const btn = e.target.closest('.icon-btn');
    if (!btn) return;
    state.humanSymbol = btn.getAttribute('data-symbol');
    [...symbolGroup.children].forEach(c => c.classList.toggle('active', c === btn));
    playerXLabel.style.display = state.mode === 'ai' && state.humanSymbol === 'O' ? 'none' : 'block';
    playerOLabel.style.display = state.mode === 'ai' && state.humanSymbol === 'X' ? 'none' : 'block';
    saveState();
    startNewGame();
  });

  starterGroup.addEventListener('click', (e) => {
    const btn = e.target.closest('.icon-btn');
    if (!btn) return;
    state.starter = btn.getAttribute('data-starter');
    [...starterGroup.children].forEach(c => c.classList.toggle('active', c === btn));
    saveState();
    startNewGame();
  });

  restartBtn.addEventListener('click', startNewGame);

  resetScoreBtn.addEventListener('click', () => {
    if (!confirm('Reset all scores to zero?')) return;
    state.scores = { X: 0, O: 0, draws: 0 };
    saveState();
    renderScoreboard();
  });

  clearHistoryBtn.addEventListener('click', () => {
    if (!confirm('Clear the full match history?')) return;
    state.history = [];
    saveState();
    renderHistory();
  });

  // =====================================================================
  // Initialize UI from saved state
  // =====================================================================
  function initUIFromState() {
    playerXNameEl.value = state.playerXName;
    playerONameEl.value = state.playerOName;
    aiDifficultyEl.value = state.aiDifficulty;

    modePvpBtn.classList.toggle('active', state.mode === 'pvp');
    modeAiBtn.classList.toggle('active', state.mode === 'ai');
    modeOnlineBtn.classList.toggle('active', state.mode === 'online');

    aiDifficultyField.style.display = state.mode === 'ai' ? 'block' : 'none';
    onlinePanel.style.display = state.mode === 'online' ? 'block' : 'none';
    symbolStarterRow.style.display = state.mode === 'online' ? 'none' : 'flex';
    localControls.style.display = state.mode === 'online' ? 'none' : 'flex';
    leaderboardPanelEl.style.display = state.mode === 'online' ? 'block' : 'none';

    [...symbolGroup.children].forEach(c =>
      c.classList.toggle('active', c.getAttribute('data-symbol') === state.humanSymbol));
    [...starterGroup.children].forEach(c =>
      c.classList.toggle('active', c.getAttribute('data-starter') === state.starter));

    playerXLabel.style.display = state.mode === 'online' || (state.mode === 'ai' && state.humanSymbol === 'O') ? 'none' : 'block';
    playerOLabel.style.display = state.mode === 'online' || (state.mode === 'ai' && state.humanSymbol === 'X') ? 'none' : 'block';
  }

  // ---------- Boot ----------
  initUIFromState();
  if (state.mode === 'online') {
    setMode('online');
  } else {
    startNewGame();
  }
})();
