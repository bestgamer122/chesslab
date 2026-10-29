import { CONFIG, CLASSES } from './config.js';
import { Engine } from './engine.js';
import { Settings } from './settings.js';
import { parsePgn, gameMetaFromHeaders, formatTimestamp, resultScore, resultLabel } from './pgn.js';
import { analyzeGame } from './analysis.js';
import { fetchRecentGames, timeClassRu } from './chesscom.js';
import { BoardView } from './board.js';
import { EvalGraph } from './graph.js';

const $ = (s) => document.querySelector(s);

const state = {
  game: null, moves: [], analysis: null, ply: 0, orientation: 'w',
  depth: 14, busy: false, runId: 0, searchAbort: null
};

const settings = new Settings();
let board, graph, engine, toastTimer;

init();

function init() {
  board = new BoardView($('#board'), settings);
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
  $('#brandLink').addEventListener('click', (e) => { e.preventDefault(); leaveAnalysis(); });
  $('#newGameBtn').addEventListener('click', leaveAnalysis);
  $('#backBtn').addEventListener('click', leaveAnalysis);

  $('#chesscomForm').addEventListener('submit', (e) => {
    e.preventDefault();
    loadChesscomGames($('#usernameInput').value);
  });

  $('#dropZone').addEventListener('click', () => $('#fileInput').click());
  $('#fileInput').addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) readPgnFile(e.target.files[0]);
    e.target.value = '';
  });

  $('#pastePgnBtn').addEventListener('click', () => { $('#pgnError').classList.add('hidden'); $('#pgnModal').classList.remove('hidden'); });
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
    $('#settingsModal').classList.remove('hidden');
  });
  
  $('#settingsCloseBtn').addEventListener('click', () => $('#settingsModal').classList.add('hidden'));
  $('#settingsSaveBtn').addEventListener('click', () => {
    const selectedTheme = $('#themeCustomSelect .select-option.selected').dataset.value;
    settings.save({
      boardTheme: selectedTheme,
      showCoords: $('#showCoordsCheckbox').checked,
      animations: $('#animationsCheckbox').checked,
    });
    board.updateStyles();
    board.setPosition(board.currentFen, { animate: false });
    $('#settingsModal').classList.add('hidden');
    toast('Настройки сохранены');
  });

  $('#reanalyzeBtn').addEventListener('click', () => startAnalysis(true));
  $('#cancelBtn').addEventListener('click', cancelAnalysis);

  $('#firstBtn').addEventListener('click', () => goToPly(0));
  $('#prevBtn').addEventListener('click', () => goToPly(state.ply - 1));
  $('#nextBtn').addEventListener('click', () => goToPly(state.ply + 1));
  $('#lastBtn').addEventListener('click', () => goToPly(state.moves.length));
  $('#flipBtn').addEventListener('click', () => board.flip());
  
  $('#moveList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-ply]');
    if (btn) goToPly(parseInt(btn.dataset.ply, 10));
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, select')) return;
    if (!$('#analysisView').classList.contains('hidden') && state.game) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); goToPly(state.ply - 1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); goToPly(state.ply + 1); }
      if (e.key === 'Home') { e.preventDefault(); goToPly(0); }
      if (e.key === 'End') { e.preventDefault(); goToPly(state.moves.length); }
    }
  });
}

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

function loadGame(parsed, meta, orientation) {
  cancelAnalysis(true);
  state.game = { ...parsed, meta };
  state.moves = parsed.moves;
  state.ply = 0;
  state.analysis = null;
  state.orientation = orientation || 'w';

  $('#homeView').classList.add('hidden');
  $('#analysisView').classList.remove('hidden');
  window.scrollTo(0, 0);

  renderGameMeta();
  renderPlayers();
  renderMoveList();
  graph.setData([], 0); 
  goToPly(0);
  
  setTimeout(() => startAnalysis(false), 200);
}

function leaveAnalysis() {
  cancelAnalysis(true);
  $('#analysisView').classList.add('hidden');
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
  $('#moveList').querySelectorAll('[data-ply]').forEach(b => b.classList.toggle('active', +b.dataset.ply === state.ply));
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
    <div class="panel-head"><h2>Точность</h2></div>
    <div class="acc-grid">
      <div class="acc-card">
        <div class="acc-top"><span class="dot white"></span>Белые<span class="acc-num">${w.accuracy.toFixed(1)}%</span></div>
        <div class="acc-track"><span style="width:${w.accuracy}%; background: var(--accent)"></span></div>
        <div class="acc-sub">ACPL ${w.acpl}</div>
      </div>
      <div class="acc-card">
        <div class="acc-top"><span class="dot black"></span>Чёрные<span class="acc-num">${b.accuracy.toFixed(1)}%</span></div>
        <div class="acc-track"><span style="width:${b.accuracy}%; background: #8fa3bd"></span></div>
        <div class="acc-sub">ACPL ${b.acpl}</div>
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
      ${genStatRow('Отлично', w.counts.excellent, b.counts.excellent, 'excellent')}
      ${genStatRow('Хорошо', w.counts.good, b.counts.good, 'good')}
      ${genStatRow('Неточность', w.counts.inaccuracy, b.counts.inaccuracy, 'inaccuracy')}
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

function renderMoveInfo() {
  const box = $('#moveInfo');
  if (!state.game || !state.analysis) {
    box.innerHTML = '<div class="mi-empty">Выберите ход в списке, чтобы увидеть разбор</div>';
    return;
  }
  if (state.ply === 0) {
    box.innerHTML = '<div class="mi-empty">Стартовая позиция</div>';
    return;
  }

  const info = state.analysis.moves[state.ply - 1];
  const cls = CLASSES[info.classification];
  const num = Math.floor((info.ply - 1) / 2) + 1;
  const moveStr = `${num}${info.color==='w'?'.':'...'} ${info.san}`;
  const evalText = formatEval(info.evalAfterWhite);

  box.innerHTML = `
    <div class="mi-top">
      <div class="mi-class ${info.classification}">
        <span class="mi-symbol">${cls.short}</span>
        <span class="mi-label">${cls.label}</span>
      </div>
      <div class="mi-eval-box">${evalText}</div>
    </div>
    <div class="mi-middle">
      <div class="mi-played">
        <span class="mi-number">${num}${info.color === 'w' ? '.' : '...'}</span>
        <span class="mi-san">${info.san}</span>
      </div>
      <div class="mi-best-move">
        ${info.isBest ? 'Лучший ход по мнению движка' : `Лучше было: <span class="best-san">${info.bestSan || '—'}</span>`}
      </div>
    </div>
    <div class="mi-bottom">
      <span>Точность хода:</span>
      <strong>${info.accuracy.toFixed(0)}%</strong>
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
