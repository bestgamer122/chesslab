import { CONFIG, CLASSES } from './config.js';
import { Engine } from './engine.js';
import { Settings } from './settings.js';
import { parsePgn, gameMetaFromHeaders, formatTimestamp, resultScore, resultLabel } from './pgn.js';
import { analyzeGame } from './analysis.js';
import { fetchRecentGames, timeClassRu } from './chesscom.js';
import { BoardView } from './board.js';
import { EvalGraph } from './graph.js';
import { SoundPlayer } from './sounds.js';
import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1.4.0/dist/esm/chess.js';

const $ = (s) => document.querySelector(s);

const state = {
  game: null, moves: [], analysis: null, ply: 0, orientation: 'w',
  depth: 14, busy: false, runId: 0, searchAbort: null,
  playMode: false, playChess: null, playElo: 1200, playColor: 'w',
  playPly: 0, playMoves: [], premove: null
};

const settings = new Settings();
const sounds = new SoundPlayer();
let board, boardPlay, graph, engine, toastTimer;

init();

function init() {
  sounds.toggle(settings.get('sound') !== false);
  
  board = new BoardView($('#board'), settings);
  boardPlay = new BoardView($('#boardPlay'), settings, handlePlayerMove);
  
  graph = new EvalGraph($('#evalGraph'), (ply) => goToPly(ply));
  engine = new Engine();

  initCustomSelect('depthCustomSelect', state.depth, (val) => {
    state.depth = parseInt(val, 10);
    settings.save({ depth: state.depth });
  });
  
  initCustomSelect('themeCustomSelect', settings.get('boardTheme') || 'green', () => {});

  bindEvents();
  renderSummary();
  renderMoveInfo();
  setEngineState('idle');
  
  const savedNick = localStorage.getItem('chesscom_nick');
  if (savedNick) {
    $('#usernameInput').value = savedNick;
    loadChesscomGames(savedNick);
  }
}

function initCustomSelect(id, defaultVal, onChange) {
  const el = document.getElementById(id);
  if (!el) return;
  const trigger = el.querySelector('.select-trigger .select-label');
  const options = el.querySelectorAll('.select-option');
  
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    document.querySelectorAll('.custom-select').forEach(s => { if (s !== el) s.classList.remove('open'); });
    el.classList.toggle('open');
  });

  options.forEach(opt => {
    opt.addEventListener('click', () => {
      const val = opt.dataset.value;
      trigger.textContent = opt.textContent;
      options.forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      el.classList.remove('open');
      if (onChange) onChange(val);
    });
    
    if (String(opt.dataset.value) === String(defaultVal)) {
      opt.classList.add('selected');
      trigger.textContent = opt.textContent;
    }
  });
}

document.addEventListener('click', () => {
  document.querySelectorAll('.custom-select').forEach(s => s.classList.remove('open'));
});

function bindEvents() {
  $('#brandLink').addEventListener('click', (e) => { e.preventDefault(); goHome(); });
  
  $('#chesscomForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const nick = $('#usernameInput').value.trim();
    if (nick) {
      localStorage.setItem('chesscom_nick', nick);
      loadChesscomGames(nick);
    }
  });

  $('#dropZone').addEventListener('click', () => $('#fileInput').click());
  $('#fileInput').addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) readPgnFile(e.target.files[0]);
    e.target.value = '';
  });

  $('#pastePgnBtnHero').addEventListener('click', () => { $('#pgnError').classList.add('hidden'); $('#pgnModal').classList.remove('hidden'); });
  $('#pgnCloseBtn').addEventListener('click', () => $('#pgnModal').classList.add('hidden'));
  $('#pgnCancelBtn').addEventListener('click', () => $('#pgnModal').classList.add('hidden'));
  $('#pgnAnalyzeBtn').addEventListener('click', analyzePgnFromModal);

  $('#settingsBtn').addEventListener('click', () => {
    $('#themeCustomSelect .select-options').querySelectorAll('.select-option').forEach(o => {
      const isSel = o.dataset.value === (settings.get('boardTheme') || 'green');
      o.classList.toggle('selected', isSel);
      if (isSel) $('#themeCustomSelect .select-label').textContent = o.textContent;
    });
    $('#showCoordsCheckbox').checked = settings.get('showCoords') !== false;
    $('#animationsCheckbox').checked = settings.get('animations') !== false;
    $('#soundCheckbox').checked = settings.get('sound') !== false;
    $('#settingsModal').classList.remove('hidden');
  });
  
  $('#settingsCloseBtn').addEventListener('click', () => $('#settingsModal').classList.add('hidden'));
  $('#settingsSaveBtn').addEventListener('click', () => {
    const selectedTheme = $('#themeCustomSelect .select-option.selected').dataset.value;
    const soundState = $('#soundCheckbox').checked;
    
    settings.save({
      boardTheme: selectedTheme,
      showCoords: $('#showCoordsCheckbox').checked,
      animations: $('#animationsCheckbox').checked,
      sound: soundState
    });
    
    sounds.toggle(soundState);
    board.updateStyles();
    boardPlay.updateStyles();
    board.setPosition(board.currentFen, { animate: false });
    boardPlay.setPosition(boardPlay.currentFen, { animate: false });
    $('#settingsModal').classList.add('hidden');
    toast('Настройки сохранены');
  });

  $('#playEngineBtn').addEventListener('click', () => $('#playSetupModal').classList.remove('hidden'));
  $('#playSetupCloseBtn').addEventListener('click', () => $('#playSetupModal').classList.add('hidden'));
  
  $('#eloSlider').addEventListener('input', (e) => {
    $('#eloValue').textContent = e.target.value;
    state.playElo = parseInt(e.target.value, 10);
  });

  document.querySelectorAll('.play-color-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.play-color-btn').forEach(b => {
        b.classList.remove('btn-primary', 'active');
        b.classList.add('btn-ghost');
      });
      e.target.classList.remove('btn-ghost');
      e.target.classList.add('btn-primary', 'active');
      state.playColor = e.target.dataset.color;
    });
  });

  $('#startPlayBtn').addEventListener('click', startPlayGame);
  $('#finishGameBtn').addEventListener('click', finishPlayGame);
  $('#backFromPlayBtn').addEventListener('click', goHome);

  $('#reanalyzeBtn').addEventListener('click', () => startAnalysis(true));
  $('#cancelBtn').addEventListener('click', cancelAnalysis);
  $('#backBtn').addEventListener('click', goHome);

  $('#firstBtn').addEventListener('click', () => goToPly(0));
  $('#prevBtn').addEventListener('click', () => goToPly(state.ply - 1));
  $('#nextBtn').addEventListener('click', () => goToPly(state.ply + 1));
  $('#lastBtn').addEventListener('click', () => goToPly(state.moves.length));
  $('#flipBtn').addEventListener('click', () => board.flip());

  $('#firstPlayBtn').addEventListener('click', () => goToPlayPly(0));
  $('#prevPlayBtn').addEventListener('click', () => goToPlayPly(state.playPly - 1));
  $('#nextPlayBtn').addEventListener('click', () => goToPlayPly(state.playPly + 1));
  $('#lastPlayBtn').addEventListener('click', () => goToPlayPly(state.playMoves.length));
  $('#flipPlayBtn').addEventListener('click', () => boardPlay.flip());
  
  $('#moveList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-ply]');
    if (btn) goToPly(parseInt(btn.dataset.ply, 10));
  });

  $('#playMoveList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-play-ply]');
    if (btn) goToPlayPly(parseInt(btn.dataset.playPly, 10));
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, select')) return;
    
    if (!$('#playView').classList.contains('hidden') && state.playMode) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); goToPlayPly(state.playPly - 1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); goToPlayPly(state.playPly + 1); }
      if (e.key === 'Home') { e.preventDefault(); goToPlayPly(0); }
      if (e.key === 'End') { e.preventDefault(); goToPlayPly(state.playMoves.length); }
      return;
    }

    if (!$('#analysisView').classList.contains('hidden') && state.game) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); goToPly(state.ply - 1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); goToPly(state.ply + 1); }
      if (e.key === 'Home') { e.preventDefault(); goToPly(0); }
      if (e.key === 'End') { e.preventDefault(); goToPly(state.moves.length); }
    }
  });
}

function playSound(move, chess) {
  if (!move) return;
  if (chess.inCheck()) sounds.playCheck();
  else if (move.captured) sounds.playCapture();
  else sounds.playMove();
}

// ================= ИГРА ПРОТИВ ДВИЖКА =================
async function startPlayGame() {
  $('#playSetupModal').classList.add('hidden');
  $('#homeView').classList.add('hidden');
  $('#analysisView').classList.add('hidden');
  $('#playView').classList.remove('hidden');
  
  state.playMode = true;
  state.playChess = new Chess();
  state.playMoves = [];
  state.playPly = 0;
  state.premove = null;
  boardPlay.premove = null;
  
  $('#playDiffText').textContent = `${state.playElo} ELO`;
  $('#playColorText').textContent = state.playColor === 'w' ? 'Вы играете белыми' : 'Вы играете чёрными';
  
  const top = $('#topPlayerCard');
  const bot = $('#bottomPlayerCard');
  
  if (state.playColor === 'w') {
    top.innerHTML = `<span class="pc-dot black"></span><div class="pc-main"><strong>Движок Stockfish</strong></div>`;
    bot.innerHTML = `<span class="pc-dot white"></span><div class="pc-main"><strong>Вы</strong></div>`;
  } else {
    top.innerHTML = `<span class="pc-dot white"></span><div class="pc-main"><strong>Вы</strong></div>`;
    bot.innerHTML = `<span class="pc-dot black"></span><div class="pc-main"><strong>Движок Stockfish</strong></div>`;
  }

  boardPlay.isLive = true;
  boardPlay.setPlayerColor(state.playColor);
  boardPlay.setPosition(state.playChess.fen(), { animate: false });
  
  // БЛОКИРУЕМ ДОСКУ ДО ГОТОВНОСТИ ДВИЖКА
  boardPlay.setInteractive(false); 
  updatePlayList();
  
  try {
    await engine.init(status => setEngineState(status));
    engine.setElo(state.playElo);
    toast('Игра началась');
    
    if (state.playColor === 'b') {
      makeEngineMove();
    } else {
      boardPlay.setInteractive(true); // Включаем, когда движок готов
    }
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function handlePlayerMove(move) {
  if (!state.playMode) return;

  if (move.isPremove) {
    state.premove = move;
    boardPlay.premove = move;
    boardPlay.setPosition(state.playChess.fen(), { animate: false });
    return;
  }

  if (state.playChess.turn() !== state.playColor) return;
  
  playSound(move, state.playChess);
  state.playChess.move(move);
  state.playMoves.push(move.san);
  state.premove = null;
  boardPlay.premove = null;
  state.playPly = state.playMoves.length;
  
  boardPlay.setPosition(state.playChess.fen(), { from: move.from, to: move.to });
  updatePlayList();
  
  if (checkGameOver()) return;
  
  boardPlay.setInteractive(false);
  makeEngineMove();
}

async function makeEngineMove() {
  if (!state.playMode || state.playChess.isGameOver()) return;
  
  try {
    const time = state.playElo < 1400 ? 500 : state.playElo < 2000 ? 1000 : 1500;
    await new Promise(r => setTimeout(r, 300));

    const ev = await engine.evaluateTime(state.playChess.fen(), time);
    
    if (!ev.bestMove || !state.playMode) return;
    
    const move = state.playChess.move({ 
      from: ev.bestMove.slice(0,2), 
      to: ev.bestMove.slice(2,4), 
      promotion: ev.bestMove[4] || 'q' 
    });
    
    if (move) {
      playSound(move, state.playChess);
      state.playMoves.push(move.san);
      state.playPly = state.playMoves.length;
      boardPlay.setPosition(state.playChess.fen(), { from: move.from, to: move.to });
      updatePlayList();
      
      if (checkGameOver()) return;

      if (state.premove) {
        const pm = state.premove;
        state.premove = null;
        boardPlay.premove = null;
        
        const testChess = new Chess(state.playChess.fen());
        try {
          const pmMove = testChess.move({ from: pm.from, to: pm.to, promotion: 'q' });
          if (pmMove) {
            setTimeout(() => handlePlayerMove(pmMove), 250);
            return; 
          }
        } catch (_) {}
        
        boardPlay.setPosition(state.playChess.fen(), { animate: true });
      }

      boardPlay.setInteractive(true);
    }
  } catch (err) {
    if (err.message !== 'AbortError') {
      console.error(err);
      toast('Ошибка движка: ' + err.message, 'error');
      boardPlay.setInteractive(true); // Разрешаем ходить, чтобы не зависнуть
    }
  }
}

function goToPlayPly(ply) {
  if (!state.playChess) return;
  
  state.playPly = Math.max(0, Math.min(state.playMoves.length, ply));
  
  const tempChess = new Chess();
  for(let i=0; i<state.playPly; i++) {
    tempChess.move(state.playMoves[i]);
  }
  
  const lastMove = state.playPly > 0 ? state.playMoves[state.playPly - 1] : null;
  boardPlay.setPosition(tempChess.fen(), { 
    from: lastMove?.from, to: lastMove?.to, 
    animate: true 
  });
  
  updatePlayList();
  
  const isLive = state.playPly === state.playMoves.length;
  boardPlay.isLive = isLive;
  
  const isPlayerTurn = tempChess.turn() === state.playColor;
  boardPlay.setInteractive(isLive && isPlayerTurn && !tempChess.isGameOver());
}

function checkGameOver() {
  if (state.playChess.isGameOver()) {
    boardPlay.setInteractive(false);
    let msg = 'Игра окончена. ';
    if (state.playChess.isCheckmate()) msg += state.playChess.turn() === state.playColor ? 'Вам мат.' : 'Вы победили!';
    else if (state.playChess.isDraw()) msg += 'Ничья.';
    toast(msg);
    return true;
  }
  return false;
}

function updatePlayList() {
  const el = $('#playMoveList');
  let html = '';
  for (let i = 0; i < state.playMoves.length; i += 2) {
    html += `<div class="move-row"><div class="move-no">${i/2 + 1}.</div>`;
    html += `<button class="move-btn ${state.playPly === i+1 ? 'active' : ''}" data-play-ply="${i+1}">${state.playMoves[i]}</button>`;
    html += i+1 < state.playMoves.length ? `<button class="move-btn ${state.playPly === i+2 ? 'active' : ''}" data-play-ply="${i+2}">${state.playMoves[i+1]}</button>` : '<div></div>';
    html += '</div>';
  }
  el.innerHTML = html;
  $('#playMoveCount').textContent = state.playMoves.length + ' ходов';
  $('#playMoveCounter').textContent = `Ход ${Math.ceil(state.playPly/2)} / ${Math.ceil(state.playMoves.length/2)}`;

  const active = el.querySelector('.move-btn.active');
  if (active) active.scrollIntoView({ block: 'nearest' });
}

function finishPlayGame() {
  if (state.playMoves.length < 2) return toast('Сделайте хотя бы пару ходов', 'error');
  state.playMode = false;
  state.premove = null;
  boardPlay.premove = null;
  boardPlay.setInteractive(false);
  
  const pgn = state.playChess.pgn();
  const parsed = parsePgn(pgn);
  const meta = gameMetaFromHeaders(parsed.headers, {
    event: 'Игра с движком', date: 'Сегодня', 
    whiteName: state.playColor === 'w' ? 'Вы' : `Stockfish ${state.playElo}`,
    blackName: state.playColor === 'w' ? `Stockfish ${state.playElo}` : 'Вы', 
    result: '*'
  });
  loadGame(parsed, meta, state.playColor);
}

// ================= ЗАГРУЗКА ПАРТИЙ =================
async function loadChesscomGames(username) {
  if (!username.trim()) return setGamesState('Введите ник', 'error');
  if (state.searchAbort) state.searchAbort.abort();
  state.searchAbort = new AbortController();

  const btn = $('#loadPlayerBtn');
  btn.disabled = true; btn.textContent = 'Ищем…';
  setGamesState('Загружаем…'); $('#gamesList').innerHTML = '';

  try {
    const { profile, games } = await fetchRecentGames(username, { signal: state.searchAbort.signal });
    renderPlayerBox(profile);
    renderGames(games);
  } catch (err) {
    if (err.name === 'AbortError') return;
    setGamesState(err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Найти';
  }
}

function renderPlayerBox(profile) {
  const box = $('#playerBox');
  box.classList.remove('hidden');
  const av = profile.avatar ? `<img class="player-avatar" src="${profile.avatar}">` : `<span class="player-avatar-fallback">${profile.username[0].toUpperCase()}</span>`;
  box.innerHTML = `${av}<div><strong>${profile.name || profile.username}</strong><span>@${profile.username}</span></div>`;
}

function renderGames(games) {
  const list = $('#gamesList');
  list.innerHTML = games.length ? '' : 'Нет партий.';
  setGamesState(`Найдено: ${games.length}`);

  games.forEach(g => {
    const el = document.createElement('button');
    el.className = 'game-card';
    el.innerHTML = `
      <div class="gc-top"><span>${timeClassRu(g.timeClass)}</span><span>${formatTimestamp(g.endTime)}</span></div>
      <div class="gc-line"><span class="dot white"></span><span class="gc-name">${g.white.name}</span><span class="gc-rating">${g.white.rating||''}</span><span class="gc-score">${resultScore(g.result)}</span></div>
      <div class="gc-line"><span class="dot black"></span><span class="gc-name">${g.black.name}</span><span class="gc-rating">${g.black.rating||''}</span></div>
    `;
    el.addEventListener('click', () => analyzeChesscomGame(g));
    list.appendChild(el);
  });
}

function setGamesState(text, type) {
  $('#gamesState').textContent = text;
  $('#gamesState').className = 'state-text ' + (type || '');
}

function analyzeChesscomGame(game) {
  try {
    const parsed = parsePgn(game.pgn);
    const meta = gameMetaFromHeaders(parsed.headers, {
      source: 'Chess.com', whiteName: game.white.name, blackName: game.black.name,
      whiteElo: game.white.rating, blackElo: game.black.rating,
      date: formatTimestamp(game.endTime), event: 'Chess.com · ' + timeClassRu(game.timeClass),
      result: game.result
    });
    loadGame(parsed, meta, game.playerColor);
  } catch (err) { toast(err.message, 'error'); }
}

function readPgnFile(file) {
  if (file.size > 5*1024*1024) return toast('Файл > 5МБ', 'error');
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = parsePgn(reader.result);
      loadGame(parsed, gameMetaFromHeaders(parsed.headers), 'w');
    } catch (err) { toast(err.message, 'error'); }
  };
  reader.readAsText(file);
}

function analyzePgnFromModal() {
  try {
    const parsed = parsePgn($('#pgnTextarea').value);
    $('#pgnModal').classList.add('hidden');
    loadGame(parsed, gameMetaFromHeaders(parsed.headers), 'w');
  } catch (err) {
    $('#pgnError').textContent = err.message;
    $('#pgnError').classList.remove('hidden');
  }
}

// ================= АНАЛИЗ =================
function loadGame(parsed, meta, orientation) {
  cancelAnalysis(true);
  state.game = { ...parsed, meta };
  state.moves = parsed.moves;
  state.ply = 0;
  state.analysis = null;
  state.orientation = orientation || 'w';

  $('#homeView').classList.add('hidden');
  $('#playView').classList.add('hidden');
  $('#analysisView').classList.remove('hidden');
  window.scrollTo(0, 0);

  renderGameMeta();
  renderPlayers();
  renderMoveList();
  graph.setData([], 0); 
  goToPly(0);
  
  setTimeout(() => startAnalysis(false), 200);
}

function goHome() {
  cancelAnalysis(true);
  state.playMode = false;
  state.premove = null;
  boardPlay.premove = null;
  $('#analysisView').classList.add('hidden');
  $('#playView').classList.add('hidden');
  $('#homeView').classList.remove('hidden');
}

async function startAnalysis(isManual) {
  if (!state.game || state.busy) return;
  if (engine) engine.stop();
  
  const runId = ++state.runId;
  state.busy = true;
  state.analysis = null;
  
  renderSummary(); renderMoveList(); graph.setData([], 0); goToPly(0);
  $('#progressWrap').classList.remove('hidden');
  $('#cancelBtn').classList.remove('hidden');
  $('#reanalyzeBtn').disabled = true;
  setProgress(0, 'Запускаем движок…');

  try {
    await engine.init(status => setEngineState(status));
    if (runId !== state.runId) return;

    if (engine.worker) engine.worker.postMessage('setoption name UCI_LimitStrength value false');

    const analysis = await analyzeGame({
      moves: state.moves, startFen: state.game.startFen, engine, depth: state.depth,
      isCancelled: () => runId !== state.runId,
      onProgress: (done, total) => setProgress(done/total, `Анализ ${done}/${total} · глубина ${state.depth}`),
    });

    if (runId !== state.runId) return;
    state.analysis = analysis;
    
    renderSummary(); 
    renderMoveList(); 
    goToPly(state.ply);
    graph.setData(analysis.points, state.ply);
    
    animateAccuracy(state.analysis.summary.w.accuracy, state.analysis.summary.b.accuracy, state.analysis.summary.w.acpl, state.analysis.summary.b.acpl);

    if (isManual) toast('Готово');
  } catch (err) {
    if (err.message !== 'AbortError' && runId === state.runId) {
      console.error(err);
      setEngineState('error');
      toast(err.message, 'error');
    }
  } finally {
    if (runId === state.runId) {
      state.busy = false;
      $('#progressWrap').classList.add('hidden');
      $('#cancelBtn').classList.add('hidden');
      $('#reanalyzeBtn').disabled = false;
    }
  }
}

function cancelAnalysis(silent) {
  const busy = state.busy;
  state.runId++;
  state.busy = false;
  
  if (engine && typeof engine.stop === 'function') engine.stop();
  
  $('#progressWrap').classList.add('hidden');
  $('#cancelBtn').classList.add('hidden');
  $('#reanalyzeBtn').disabled = false;
  if (busy && !silent) toast('Остановлено');
}

function setProgress(frac, label) {
  const pct = Math.round(frac * 100);
  $('#progressBar').style.width = pct + '%';
  $('#progressPct').textContent = pct + '%';
  if (label) $('#progressLabel').textContent = label;
}

function setEngineState(s) {
  const p = $('#enginePill');
  p.className = 'engine-pill ' + (s === 'loading' ? 'is-loading' : s === 'ready' ? 'is-ready' : s === 'error' ? 'is-error' : '');
  $('#enginePillText').textContent = 'Движок · ' + ({ loading: 'загрузка', ready: 'готов', error: 'ошибка', idle: 'ожидание' }[s] || s);
}

function goToPly(ply) {
  if (!state.game) return;
  state.ply = Math.max(0, Math.min(state.moves.length, ply));
  
  const fen = state.ply === 0 ? state.game.startFen : state.moves[state.ply - 1].after;
  const lastMove = state.ply > 0 ? state.moves[state.ply - 1] : null;
  const best = state.analysis?.moves[state.ply]?.bestMove || null;

  board.setPosition(fen, { from: lastMove?.from, to: lastMove?.to, best });
  
  highlightMove();
  renderMoveInfo();
  updateEvalBar();
  $('#moveCounter').textContent = `Ход ${Math.ceil(state.ply/2)} / ${Math.ceil(state.moves.length/2)}`;
  if (state.analysis) graph.setCurrent(state.ply);
}

function highlightMove() {
  const list = $('#moveList');
  list.querySelectorAll('[data-ply]').forEach(b => b.classList.toggle('active', +b.dataset.ply === state.ply));
  const active = list.querySelector('.active');
  if (active) active.scrollIntoView({ block: 'nearest' });
}

function renderGameMeta() {
  const m = state.game.meta;
  $('#gameMeta').innerHTML = `
    <div class="gm-line"><span class="result-chip">${resultScore(m.result)}</span><strong>${m.white.name}</strong> <span class="vs">vs</span> <strong>${m.black.name}</strong></div>
    <div class="gm-sub">${m.event} · ${m.date}</div>
  `;
}

function renderPlayers() {
  const m = state.game.meta;
  $('#whiteName').textContent = m.white.name; $('#whiteElo').textContent = m.white.elo ? `(${m.white.elo})` : '';
  $('#blackName').textContent = m.black.name; $('#blackElo').textContent = m.black.elo ? `(${m.black.elo})` : '';
  
  const wAcc = $('#whiteAcc'), bAcc = $('#blackAcc');
  if (state.analysis) {
    wAcc.textContent = state.analysis.summary.w.accuracy.toFixed(1) + '%';
    bAcc.textContent = state.analysis.summary.b.accuracy.toFixed(1) + '%';
    wAcc.className = 'pc-acc ' + (state.analysis.summary.w.accuracy >= 85 ? 'good' : state.analysis.summary.w.accuracy < 60 ? 'bad' : '');
    bAcc.className = 'pc-acc ' + (state.analysis.summary.b.accuracy >= 85 ? 'good' : state.analysis.summary.b.accuracy < 60 ? 'bad' : '');
  } else {
    wAcc.textContent = '—'; bAcc.textContent = '—'; wAcc.className = 'pc-acc'; bAcc.className = 'pc-acc';
  }
}

function renderMoveList() {
  const el = $('#moveList');
  if (!state.game) return;
  const an = state.analysis?.moves || [];
  let html = '';

  for (let i = 0; i < state.moves.length; i += 2) {
    html += `<div class="move-row"><div class="move-no">${i/2 + 1}.</div>`;
    html += genMoveBtn(i, an[i]);
    html += i+1 < state.moves.length ? genMoveBtn(i+1, an[i+1]) : '<div></div>';
    html += '</div>';
  }
  el.innerHTML = html;
  $('#moveCount').textContent = state.moves.length + ' ходов';
}

function genMoveBtn(idx, info) {
  const san = state.moves[idx].san;
  const cls = info ? CLASSES[info.classification] : null;
  return `<button class="move-btn ${info ? 'active-'+info.classification : ''}" data-ply="${idx+1}">
    <span>${san}</span><span class="${info ? 'cls-'+info.classification : ''}">${cls ? cls.short : ''}</span>
  </button>`;
}

function renderSummary() {
  const p = $('#summaryPanel');
  if (!state.analysis) {
    p.innerHTML = `<div class="panel-head"><h2>Точность</h2></div><div class="mi-empty">Данные появятся после анализа</div>`;
    return;
  }
  const w = state.analysis.summary.w, b = state.analysis.summary.b;
  
  p.innerHTML = `
    <div class="acc-grid">
      <div class="acc-card">
        <div class="acc-top"><span class="dot white"></span>Белые<span class="acc-num" id="wAccNum">0.0%</span></div>
        <div class="acc-track"><span id="wAccBar" style="width:0%; background: var(--accent)"></span></div>
        <div class="acc-sub">ACPL <span id="wAcplNum">0</span></div>
      </div>
      <div class="acc-card">
        <div class="acc-top"><span class="dot black"></span>Чёрные<span class="acc-num" id="bAccNum">0.0%</span></div>
        <div class="acc-track"><span id="bAccBar" style="width:0%; background: #8fa3bd"></span></div>
        <div class="acc-sub">ACPL <span id="bAcplNum">0</span></div>
      </div>
    </div>
    
    <div class="stats-table">
      <div class="stat-row header">
        <span class="stat-name">Тип хода</span>
        <span class="stat-col">Белые</span>
        <span class="stat-col">Чёрные</span>
      </div>
      ${genStatRow('Блестящий', w.counts.brilliant, b.counts.brilliant, 'brilliant')}
      ${genStatRow('Замечательный', w.counts.great, b.counts.great, 'great')}
      ${genStatRow('Лучший', w.counts.best, b.counts.best, 'best')}
      ${genStatRow('Ошибка', w.counts.mistake, b.counts.mistake, 'mistake')}
      ${genStatRow('Упущенный шанс', w.counts.miss, b.counts.miss, 'miss')}
      ${genStatRow('Зевок', w.counts.blunder, b.counts.blunder, 'blunder')}
    </div>
  `;
  renderPlayers();
}

function genStatRow(label, wCount, bCount, cls) {
  return `
    <div class="stat-row">
      <span class="stat-name cls-${cls}">${label}</span>
      <span class="stat-val">${wCount}</span>
      <span class="stat-val">${bCount}</span>
    </div>
  `;
}

function animateAccuracy(targetW, targetB, acplW, acplB) {
  const duration = 1000;
  const start = performance.now();
  
  const wAccNum = $('#wAccNum'), bAccNum = $('#bAccNum');
  const wAccBar = $('#wAccBar'), bAccBar = $('#bAccBar');
  const wAcplNum = $('#wAcplNum'), bAcplNum = $('#bAcplNum');

  if (!wAccNum) return;

  function step(timestamp) {
    const progress = Math.min((timestamp - start) / duration, 1);
    const easeOut = 1 - Math.pow(1 - progress, 3);
    
    wAccNum.textContent = (targetW * easeOut).toFixed(1) + '%';
    bAccNum.textContent = (targetB * easeOut).toFixed(1) + '%';
    wAccBar.style.width = (targetW * easeOut) + '%';
    bAccBar.style.width = (targetB * easeOut) + '%';
    
    wAcplNum.textContent = Math.round(acplW * easeOut);
    bAcplNum.textContent = Math.round(acplB * easeOut);

    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function renderMoveInfo() {
  const box = $('#moveInfo');
  if (!state.game || !state.analysis) {
    box.innerHTML = '<div class="mi-empty">Выберите ход в списке</div>';
    return;
  }
  if (state.ply === 0) {
    box.innerHTML = '<div class="mi-empty">Стартовая позиция</div>';
    return;
  }

  const info = state.analysis.moves[state.ply - 1];
  const cls = CLASSES[info.classification];
  const num = Math.floor((info.ply - 1) / 2) + 1;
  const evalText = formatEval(info.evalAfterWhite);

  box.innerHTML = `
    <div class="mi-top">
      <div class="mi-class ${info.classification}">
        <span class="mi-symbol">${cls.short}</span>
        <span class="mi-label">${cls.label}</span>
      </div>
      <div class="mi-eval-box">${evalText}</div>
    </div>
    <div class="mi-played">
      <div><span class="mi-number">${num}${info.color === 'w' ? '.' : '...'}</span>${info.san}</div>
      <div class="mi-accuracy">Точность: <span>${info.accuracy.toFixed(0)}%</span></div>
    </div>
    <div class="mi-best-move">
      ${info.isBest ? 'Лучший ход по мнению движка' : `Лучше было: <span class="best-san">${info.bestSan || '—'}</span>`}
    </div>
  `;
}

function updateEvalBar() {
  const fill = $('#evalFill'), label = $('#evalLabel');
  if (!state.analysis) {
    fill.style.height = '50%'; label.textContent = '—';
    return;
  }
  const pt = state.analysis.points[state.ply];
  const pct = pt.mate !== null ? (pt.mate > 0 ? 100 : 0) : Math.max(0, Math.min(100, 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * Math.max(-1500, Math.min(1500, pt.cp)))) - 1)));
  fill.style.height = pct + '%';
  label.textContent = formatEval(pt);
}

function formatEval(ev) {
  if (!ev) return '—';
  if (ev.mate !== null) return (ev.mate > 0 ? '+M' : '−M') + Math.abs(ev.mate);
  if (Math.abs(ev.cp) >= 10000) return ev.cp > 0 ? '+#' : '−#';
  const v = (ev.cp || 0) / 100;
  return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2);
}

function toast(msg, type) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show ' + (type || '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.className = 'toast ' + (type || ''), 3500);
}
