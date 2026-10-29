import { CONFIG, CLASSES } from './config.js';
import { Engine } from './engine.js';
import { parsePgn, gameMetaFromHeaders, formatPgnDate, formatTimestamp, resultScore, resultLabel } from './pgn.js';
import { analyzeGame } from './analysis.js';
import { fetchRecentGames, timeClassRu } from './chesscom.js';
import { BoardView } from './board.js';
import { EvalGraph } from './graph.js';

const $ = (selector) => document.querySelector(selector);

const state = {
  game: null,
  moves: [],
  analysis: null,
  ply: 0,
  orientation: 'w',
  depth: CONFIG.ENGINE_DEFAULT_DEPTH,
  busy: false,
  runId: 0,
  username: '',
  chesscomGames: [],
  chesscomProfile: null,
};

let board;
let graph;
let engine;
let toastTimer = null;
let searchAbort = null;

init();

function init() {
  board = new BoardView($('#board'));
  graph = new EvalGraph($('#evalGraph'), (ply) => goToPly(ply));
  engine = new Engine();

  bindEvents();
  renderSummary();
  renderMoveInfo();
  setEngineState('idle');
}

/* ============================================================
   События
   ============================================================ */

function bindEvents() {
  $('#brandLink').addEventListener('click', (event) => {
    event.preventDefault();
    leaveAnalysis();
  });
  $('#newGameBtn').addEventListener('click', leaveAnalysis);
  $('#backBtn').addEventListener('click', leaveAnalysis);

  $('#chesscomForm').addEventListener('submit', (event) => {
    event.preventDefault();
    loadChesscomGames($('#usernameInput').value);
  });

  $('#dropZone').addEventListener('click', () => $('#fileInput').click());
  $('#dropZone').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      $('#fileInput').click();
    }
  });
  $('#fileInput').addEventListener('change', (event) => {
    const file = event.target.files && event.target.files[0];
    if (file) readPgnFile(file);
    event.target.value = '';
  });

  ['dragenter', 'dragover'].forEach((type) => {
    $('#dropZone').addEventListener(type, (event) => {
      event.preventDefault();
      $('#dropZone').classList.add('dragover');
    });
  });
  ['dragleave', 'drop'].forEach((type) => {
    $('#dropZone').addEventListener(type, (event) => {
      event.preventDefault();
      $('#dropZone').classList.remove('dragover');
    });
  });
  $('#dropZone').addEventListener('drop', (event) => {
    const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
    if (file) readPgnFile(file);
  });

  $('#pastePgnBtn').addEventListener('click', openPgnModal);
  $('#pgnCloseBtn').addEventListener('click', closePgnModal);
  $('#pgnCancelBtn').addEventListener('click', closePgnModal);
  $('#pgnAnalyzeBtn').addEventListener('click', analyzePgnFromModal);
  $('#pgnModal').addEventListener('click', (event) => {
    if (event.target === $('#pgnModal')) closePgnModal();
  });

  $('#reanalyzeBtn').addEventListener('click', () => startAnalysis(true));
  $('#cancelBtn').addEventListener('click', cancelAnalysis);
  $('#depthSelect').addEventListener('change', (event) => {
    state.depth = parseInt(event.target.value, 10) || CONFIG.ENGINE_DEFAULT_DEPTH;
  });

  $('#firstBtn').addEventListener('click', () => goToPly(0));
  $('#prevBtn').addEventListener('click', () => goToPly(state.ply - 1));
  $('#nextBtn').addEventListener('click', () => goToPly(state.ply + 1));
  $('#lastBtn').addEventListener('click', () => goToPly(state.moves.length));
  $('#flipBtn').addEventListener('click', () => board.flip());

  $('#moveList').addEventListener('click', (event) => {
    const button = event.target.closest('[data-ply]');
    if (!button) return;
    goToPly(parseInt(button.dataset.ply, 10));
  });

  document.addEventListener('keydown', (event) => {
    if (event.target.matches('input, textarea, select')) return;
    if (!$('#analysisView').classList.contains('hidden') && state.game) {
      if (event.key === 'ArrowLeft') { event.preventDefault(); goToPly(state.ply - 1); }
      if (event.key === 'ArrowRight') { event.preventDefault(); goToPly(state.ply + 1); }
      if (event.key === 'Home') { event.preventDefault(); goToPly(0); }
      if (event.key === 'End') { event.preventDefault(); goToPly(state.moves.length); }
      if (event.key === 'f' || event.key === 'F' || event.key === 'а' || event.key === 'А') board.flip();
    }
    if (event.key === 'Escape' && !$('#pgnModal').classList.contains('hidden')) closePgnModal();
  });
}

/* ============================================================
   Загрузка партий
   ============================================================ */

async function loadChesscomGames(username) {
  const name = String(username || '').trim();
  if (!name) {
    setGamesState('Введите ник на Chess.com', 'error');
    return;
  }

  if (searchAbort) searchAbort.abort();
  searchAbort = new AbortController();

  const submit = $('#loadPlayerBtn');
  submit.disabled = true;
  submit.textContent = 'Ищем…';
  setGamesState('Загружаем партии с Chess.com…');
  $('#gamesList').innerHTML = '';

  try {
    const { profile, games } = await fetchRecentGames(name, { signal: searchAbort.signal });
    state.username = profile.username || name;
    state.chesscomProfile = profile;
    state.chesscomGames = games;

    renderPlayerBox(profile);
    renderGames(games);
  } catch (error) {
    if (error.name === 'AbortError') return;
    setGamesState(error.message || 'Не удалось загрузить партии', 'error');
  } finally {
    submit.disabled = false;
    submit.textContent = 'Найти';
  }
}

function renderPlayerBox(profile) {
  const box = $('#playerBox');
  box.classList.remove('hidden');
  const avatar = profile.avatar
    ? `<img class="player-avatar" src="${escapeAttr(profile.avatar)}" alt="" loading="lazy" onerror="this.remove()">`
    : `<span class="player-avatar-fallback">${escapeHtml((profile.username || '?').slice(0, 1).toUpperCase())}</span>`;
  const title = profile.title ? escapeHtml(profile.title) + ' · ' : '';
  box.innerHTML = avatar + '<div><strong>' + escapeHtml(profile.name || profile.username || '') + '</strong>' +
    '<span>@' + escapeHtml(profile.username || '') + ' · ' + title + (profile.followers || 0) + ' подписчиков</span></div>';
}

function renderGames(games) {
  const list = $('#gamesList');
  list.innerHTML = '';

  if (!games.length) {
    setGamesState('У игрока не найдено свежих партий. Попробуйте другой ник.');
    return;
  }

  setGamesState('Найдено партий: ' + games.length + '. Нажмите на любую для разбора.');

  const fragment = document.createDocumentFragment();
  for (const game of games) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'game-card';
    button.dataset.id = game.id;
    button.innerHTML =
      '<div class="gc-top"><span>' + escapeHtml(timeClassRu(game.timeClass)) +
      ' · ' + escapeHtml(String(game.timeControl || '')) + '</span><span>' +
      escapeHtml(formatTimestamp(game.endTime)) + '</span></div>' +
      '<div class="gc-line"><span class="dot white"></span><span class="gc-name">' +
      escapeHtml(game.white.name) + '</span><span class="gc-rating">' +
      escapeHtml(String(game.white.rating || '')) + '</span><span class="gc-score">' +
      resultScore(game.result) + '</span></div>' +
      '<div class="gc-line"><span class="dot black"></span><span class="gc-name">' +
      escapeHtml(game.black.name) + '</span><span class="gc-rating">' +
      escapeHtml(String(game.black.rating || '')) + '</span></div>';

    button.addEventListener('click', () => analyzeChesscomGame(game));
    fragment.appendChild(button);
  }
  list.appendChild(fragment);
}

function setGamesState(text, type) {
  const element = $('#gamesState');
  element.textContent = text || '';
  element.className = 'state-text' + (type === 'error' ? ' error' : '');
}

function analyzeChesscomGame(game) {
  try {
    const parsed = parsePgn(game.pgn);
    const meta = gameMetaFromHeaders(parsed.headers, {
      source: 'Chess.com',
      url: game.url,
      whiteName: game.white.name,
      blackName: game.black.name,
      whiteElo: game.white.rating,
      blackElo: game.black.rating,
      date: formatTimestamp(game.endTime),
      event: 'Chess.com · ' + timeClassRu(game.timeClass),
      result: game.result,
    });
    meta.white = { name: game.white.name, elo: game.white.rating || meta.white.elo };
    meta.black = { name: game.black.name, elo: game.black.rating || meta.black.elo };
    meta.result = game.result;
    meta.date = formatTimestamp(game.endTime);
    meta.event = 'Chess.com · ' + timeClassRu(game.timeClass);

    loadGame(parsed, meta, game.playerColor || 'w');
  } catch (error) {
    toast(error.message || 'Не удалось открыть партию', 'error');
  }
}

function readPgnFile(file) {
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    toast('Файл слишком большой (максимум 5 МБ)', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = parsePgn(String(reader.result || ''));
      const meta = gameMetaFromHeaders(parsed.headers, { source: 'PGN' });
      loadGame(parsed, meta, 'w');
    } catch (error) {
      toast(error.message || 'Ошибка чтения PGN', 'error');
    }
  };
  reader.onerror = () => toast('Не удалось прочитать файл', 'error');
  reader.readAsText(file);
}

/* ============================================================
   PGN-модалка
   ============================================================ */

function openPgnModal() {
  $('#pgnError').classList.add('hidden');
  $('#pgnError').textContent = '';
  $('#pgnModal').classList.remove('hidden');
  setTimeout(() => $('#pgnTextarea').focus(), 30);
}

function closePgnModal() {
  $('#pgnModal').classList.add('hidden');
}

function analyzePgnFromModal() {
  const text = $('#pgnTextarea').value;
  try {
    const parsed = parsePgn(text);
    const meta = gameMetaFromHeaders(parsed.headers, { source: 'PGN' });
    closePgnModal();
    loadGame(parsed, meta, 'w');
  } catch (error) {
    const box = $('#pgnError');
    box.textContent = error.message || 'Не удалось разобрать PGN';
    box.classList.remove('hidden');
  }
}

/* ============================================================
   Открытие партии
   ============================================================ */

function loadGame(parsed, meta, orientation) {
  cancelAnalysis(true);
  state.game = { ...parsed, meta };
  state.moves = parsed.moves;
  state.ply = 0;
  state.analysis = null;
  state.orientation = orientation || 'w';
  state.username = meta.white.name;

  showView('analysis');
  renderGameMeta();
  renderPlayers();
  renderMoveList();
  highlightMove();
  renderSummary();
  renderMoveInfo();
  graph.setData([], 0);
  board.setOrientation(state.orientation, false);
  updateBoard(false);
  updateEvalBar();
  updateMoveCounter();

  setTimeout(() => startAnalysis(false), 140);
}

function showView(name) {
  $('#homeView').classList.toggle('hidden', name !== 'home');
  $('#analysisView').classList.toggle('hidden', name !== 'analysis');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function leaveAnalysis() {
  cancelAnalysis(true);
  showView('home');
}

/* ============================================================
   Анализ
   ============================================================ */

async function startAnalysis(isManual) {
  if (!state.game || state.busy) return;

  const runId = ++state.runId;
  state.busy = true;

  state.analysis = null;
  renderSummary();
  renderMoveList();
  highlightMove();
  renderMoveInfo();
  graph.setData([], 0);
  updateEvalBar();
  updateBoard(false);

  showProgress(true);
  setProgress(0, 'Запускаем движок…');
  $('#cancelBtn').classList.remove('hidden');
  $('#reanalyzeBtn').disabled = true;
  $('#depthSelect').disabled = true;

  try {
    await engine.init((status) => setEngineState(status));
    if (runId !== state.runId) return;

    const analysis = await analyzeGame({
      moves: state.moves,
      startFen: state.game.startFen,
      engine,
      depth: state.depth,
      isCancelled: () => runId !== state.runId,
      onProgress: (done, total) => {
        if (runId !== state.runId) return;
        const percent = total > 0 ? done / total : 0;
        setProgress(percent, 'Анализ позиции ' + done + ' из ' + total + ' · глубина ' + state.depth);
      },
    });

    if (runId !== state.runId) return;

    state.analysis = analysis;
    renderSummary();
    renderMoveList();
    highlightMove();
    renderMoveInfo();
    graph.setData(analysis.points, state.ply);
    updateEvalBar();
    updateBoard(false);
    if (isManual) toast('Анализ завершён');
  } catch (error) {
    if (error.name === 'AbortError' || runId !== state.runId) return;
    console.error(error);
    setEngineState('error');
    toast(error.message || 'Ошибка анализа', 'error');
  } finally {
    if (runId === state.runId) {
      state.busy = false;
      showProgress(false);
      $('#cancelBtn').classList.add('hidden');
      $('#reanalyzeBtn').disabled = false;
      $('#depthSelect').disabled = false;
    }
  }
}

function cancelAnalysis(silent = false) {
  const wasBusy = state.busy;
  state.runId++;
  state.busy = false;
  engine.stop();
  showProgress(false);
  $('#cancelBtn').classList.add('hidden');
  $('#reanalyzeBtn').disabled = false;
  $('#depthSelect').disabled = false;
  if (wasBusy && !silent) toast('Анализ остановлен');
}

function showProgress(visible) {
  $('#progressWrap').classList.toggle('hidden', !visible);
}

function setProgress(fraction, label) {
  const percent = Math.max(0, Math.min(100, Math.round(fraction * 100)));
  $('#progressBar').style.width = percent + '%';
  $('#progressPct').textContent = percent + '%';
  if (label) $('#progressLabel').textContent = label;
}

function setEngineState(status) {
  const pill = $('#enginePill');
  const text = $('#enginePillText');
  pill.classList.remove('is-loading', 'is-ready', 'is-error');
  if (status === 'loading') {
    pill.classList.add('is-loading');
    text.textContent = 'Stockfish · загрузка';
  } else if (status === 'ready') {
    pill.classList.add('is-ready');
    text.textContent = 'Stockfish · готов';
  } else if (status === 'error') {
    pill.classList.add('is-error');
    text.textContent = 'Stockfish · ошибка';
  } else {
    text.textContent = 'Stockfish · ожидание';
  }
}

/* ============================================================
   Навигация по партии
   ============================================================ */

function goToPly(ply, animate = true) {
  if (!state.game) return;
  state.ply = Math.max(0, Math.min(state.moves.length, ply));
  updateBoard(animate);
  highlightMove();
  renderMoveInfo();
  updateEvalBar();
  updateMoveCounter();
  if (state.analysis) graph.setCurrent(state.ply);
}

function updateBoard(animate = true) {
  if (!state.game) return;
  const fen = state.ply === 0 ? state.game.startFen : state.moves[state.ply - 1].after;
  const lastMove = state.ply > 0 ? state.moves[state.ply - 1] : null;
  const currentInfo = state.analysis ? state.analysis.moves[state.ply] : null;
  const best = currentInfo && currentInfo.bestMove ? currentInfo.bestMove : null;

  board.setFen(fen, {
    from: lastMove ? lastMove.from : null,
    to: lastMove ? lastMove.to : null,
    best,
    animate,
  });
}

function updateMoveCounter() {
  const total = Math.ceil(state.moves.length / 2);
  const current = Math.ceil(state.ply / 2);
  $('#moveCounter').textContent = 'Ход ' + current + ' / ' + total;
}

function highlightMove() {
  const buttons = $('#moveList').querySelectorAll('[data-ply]');
  let active = null;
  buttons.forEach((button) => {
    const isActive = parseInt(button.dataset.ply, 10) === state.ply;
    button.classList.toggle('active', isActive);
    if (isActive) active = button;
  });
  if (active) active.scrollIntoView({ block: 'nearest' });
}

/* ============================================================
   Рендер: мета, игроки, ходы
   ============================================================ */

function renderGameMeta() {
  if (!state.game) return;
  const meta = state.game.meta;
  const score = resultScore(meta.result);
  const parts = [];
  if (meta.event) parts.push(escapeHtml(meta.event));
  if (meta.date && meta.date !== '—') parts.push(escapeHtml(meta.date));
  if (meta.eco) parts.push(escapeHtml(meta.eco));
  parts.push(escapeHtml(meta.source || 'PGN'));

  $('#gameMeta').innerHTML =
    '<div class="gm-line"><span class="result-chip" title="' + escapeAttr(resultLabel(meta.result)) + '">' + score + '</span>' +
    '<strong>' + escapeHtml(meta.white.name) + '</strong><span class="vs">vs</span><strong>' +
    escapeHtml(meta.black.name) + '</strong></div>' +
    '<div class="gm-sub">' + parts.join(' · ') + '</div>';
}

function renderPlayers() {
  if (!state.game) return;
  const { meta } = state.game;

  $('#whiteName').textContent = meta.white.name;
  $('#blackName').textContent = meta.black.name;
  $('#whiteElo').textContent = meta.white.elo ? '(' + meta.white.elo + ')' : '';
  $('#blackElo').textContent = meta.black.elo ? '(' + meta.black.elo + ')' : '';

  const whiteAcc = $('#whiteAcc');
  const blackAcc = $('#blackAcc');

  if (state.analysis) {
    whiteAcc.textContent = state.analysis.summary.w.accuracy.toFixed(1) + '%';
    blackAcc.textContent = state.analysis.summary.b.accuracy.toFixed(1) + '%';
    whiteAcc.className = 'pc-acc ' + accuracyClass(state.analysis.summary.w.accuracy);
    blackAcc.className = 'pc-acc ' + accuracyClass(state.analysis.summary.b.accuracy);
  } else {
    whiteAcc.textContent = '—';
    blackAcc.textContent = '—';
    whiteAcc.className = 'pc-acc';
    blackAcc.className = 'pc-acc';
  }
}

function accuracyClass(value) {
  if (value >= 85) return 'good';
  if (value < 60) return 'bad';
  return '';
}

function renderMoveList() {
  const container = $('#moveList');
  if (!state.game) {
    container.innerHTML = '';
    $('#moveCount').textContent = '';
    return;
  }

  const analyses = state.analysis ? state.analysis.moves : [];
  let html = '';

  for (let index = 0; index < state.moves.length; index += 2) {
    const number = index / 2 + 1;
    html += '<div class="move-row"><span class="move-no">' + number + '.</span>';
    html += moveButtonHtml(index, analyses[index]);
    html += index + 1 < state.moves.length ? moveButtonHtml(index + 1, analyses[index + 1]) : '<span></span>';
    html += '</div>';
  }

  container.innerHTML = html;
  $('#moveCount').textContent = state.moves.length + ' полуходов';
}

function moveButtonHtml(index, info) {
  const move = state.moves[index];
  const cls = info ? CLASSES[info.classification] : null;
  const symbol = cls ? cls.symbol : '';
  const className = info ? ' cls-' + info.classification : '';
  const title = cls
    ? cls.label + ' · оценка ' + formatEval(info.evalAfterWhite) + (info.bestSan && !info.isBest ? ' · лучше ' + info.bestSan : '')
    : 'Ход ' + (index + 1);

  return '<button type="button" class="move-btn' + className + '" data-ply="' + (index + 1) + '" title="' + escapeAttr(title) + '">' +
    '<span class="san">' + escapeHtml(move.san) + '</span>' +
    '<span class="mcls">' + symbol + '</span></button>';
}

/* ============================================================
   Рендер: сводка, инфо о ходе, график
   ============================================================ */

function renderSummary() {
  const panel = $('#summaryPanel');

  if (!state.analysis) {
    panel.innerHTML = '<div class="summary-head"><h3>Точность</h3><span class="verdict">ещё не считали</span></div>' +
      '<div class="summary-empty">Нажмите «Анализировать», чтобы Stockfish разобрал партию и посчитал точность каждого игрока.</div>';
    return;
  }

  const { w, b } = state.analysis.summary;
  const diff = w.accuracy - b.accuracy;
  let verdict = 'Равная игра';
  if (diff > 3) verdict = 'Белые точнее на ' + diff.toFixed(1) + '%';
  if (diff < -3) verdict = 'Чёрные точнее на ' + Math.abs(diff).toFixed(1) + '%';

  panel.innerHTML =
    '<div class="summary-head"><h3>Точность</h3><span class="verdict">' + escapeHtml(verdict) + '</span></div>' +
    '<div class="acc-grid">' +
      accuracyCard('Белые', w, 'white') +
      accuracyCard('Чёрные', b, 'black') +
    '</div>' +
    '<div class="cls-row">' +
      classPill('Зевки', w.counts.blunder + b.counts.blunder, 'blunder') +
      classPill('Ошибки', w.counts.mistake + b.counts.mistake, 'mistake') +
      classPill('Неточности', w.counts.inaccuracy + b.counts.inaccuracy, 'inaccuracy') +
      classPill('Блестящие', w.counts.brilliant + b.counts.brilliant, 'brilliant') +
    '</div>';
}

function accuracyCard(name, summary, color) {
  const width = Math.max(2, Math.min(100, summary.accuracy));
  return '<div class="acc-card ' + (color === 'black' ? 'black-side' : '') + '">' +
    '<div class="acc-top"><span class="dot ' + color + '"></span><span>' + name + '</span>' +
    '<span class="acc-num">' + summary.accuracy.toFixed(1) + '%</span></div>' +
    '<div class="acc-track"><span style="width:' + width + '%"></span></div>' +
    '<div class="acc-sub">ACPL ' + summary.acpl + ' · зевков ' + summary.counts.blunder +
    ' · ошибок ' + summary.counts.mistake + '</div></div>';
}

function classPill(label, count, key) {
  return '<span class="cls-pill"><b class="cls-' + key + '">' + count + '</b> ' + label + '</span>';
}

function renderMoveInfo() {
  const box = $('#moveInfo');
  if (!state.game) {
    box.innerHTML = '<div class="mi-empty">Загрузите партию, чтобы увидеть разбор.</div>';
    return;
  }

  if (!state.analysis) {
    box.innerHTML = '<div class="mi-empty">Выберите ход в списке или запустите анализ, чтобы увидеть оценку, классификацию и лучшие продолжения.</div>';
    return;
  }

  if (state.ply === 0) {
    const first = state.analysis.moves[0];
    const bestSan = first && first.bestSan ? first.bestSan : '—';
    box.innerHTML =
      '<div class="mi-head"><span class="chip chip-neutral">Стартовая позиция</span>' +
      '<span class="mi-eval">' + formatEval(state.analysis.points[0]) + '</span></div>' +
      '<div class="mi-move">Ход белых</div>' +
      '<div class="mi-best">Движок предлагает: <b>' + escapeHtml(bestSan) + '</b></div>';
    return;
  }

  const info = state.analysis.moves[state.ply - 1];
  const cls = CLASSES[info.classification];
  const moveNumber = Math.floor((info.ply - 1) / 2) + 1;
  const notation = moveNumber + (info.color === 'w' ? '.' : '...') + ' ' + info.san;

  const bestLine = info.isBest
    ? 'Это лучший ход по мнению движка.'
    : 'Лучше было: <b>' + escapeHtml(info.bestSan || info.bestMove || '—') + '</b>';

  const pv = info.pvSan && info.pvSan.length ? info.pvSan.join(' ') : '';

  box.innerHTML =
    '<div class="mi-head">' +
      '<span class="chip cls-' + info.classification + '" style="border-color:' + cls.color + '33">' +
        '<span style="color:' + cls.color + '">' + cls.symbol + '</span> ' + cls.label +
      '</span>' +
      '<span class="mi-eval">' + formatEval(info.evalBeforeWhite) + ' → ' + formatEval(info.evalAfterWhite) + '</span>' +
    '</div>' +
    '<div class="mi-move">' + escapeHtml(notation) + '</div>' +
    '<div class="mi-best">' + bestLine + '</div>' +
    (pv ? '<div class="mi-pv">' + escapeHtml(pv) + '</div>' : '') +
    '<div class="mi-stats">Точность хода ' + info.accuracy.toFixed(0) + '% · потеря ' +
      info.loss.toFixed(1) + '% вероятности победы</div>';
}

function updateEvalBar() {
  const fill = $('#evalFill');
  const label = $('#evalLabel');

  if (!state.analysis || !state.analysis.points[state.ply]) {
    fill.style.height = '50%';
    label.textContent = '—';
    return;
  }

  const point = state.analysis.points[state.ply];
  const percent = point.mate !== null
    ? (point.mate > 0 ? 100 : 0)
    : Math.max(0, Math.min(100, 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * Math.max(-1500, Math.min(1500, point.cp)))) - 1)));

  fill.style.height = percent + '%';
  label.textContent = formatEval(point);
}

/* ============================================================
   Форматирование
   ============================================================ */

function formatEval(evaluation) {
  if (!evaluation) return '—';
  if (evaluation.mate !== null && evaluation.mate !== undefined) {
    const mate = Math.abs(evaluation.mate);
    if (mate < 1) return '#';
    return (evaluation.mate > 0 ? '+M' : '−M') + Math.ceil(mate);
  }
  if (Math.abs(evaluation.cp) >= 10000) {
    return evaluation.cp > 0 ? '+#' : '−#';
  }
  const value = (evaluation.cp || 0) / 100;
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return sign + Math.abs(value).toFixed(2);
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

function toast(message, type) {
  const element = $('#toast');
  element.textContent = message;
  element.className = 'toast show' + (type === 'error' ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    element.className = 'toast' + (type === 'error' ? ' error' : '');
  }, 3800);
}
