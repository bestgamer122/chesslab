import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1.4.0/dist/esm/chess.js';

/** Удаляет вложенные варианты (...) из текста ходов. */
function stripVariations(text) {
  let out = '';
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(') { depth++; continue; }
    if (ch === ')') { depth = Math.max(0, depth - 1); continue; }
    if (depth === 0) out += ch;
  }
  return out;
}

/**
 * Чистит PGN от комментариев, часов, NAG и вариантов,
 * сохраняя блок заголовков нетронутым.
 */
export function cleanPgn(raw) {
  let text = String(raw || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n');

  // Отделяем заголовки от ходов по первой пустой строке.
  let headers = '';
  let body = text;
  const split = text.search(/\n\s*\n/);
  if (split >= 0) {
    headers = text.slice(0, split + 1);
    body = text.slice(split + 1);
  }

  // Комментарии {…} и ;…, варианты, NAG.
  body = body.replace(/\{[^}]*\}/g, ' ');
  body = body.replace(/;[^\n]*/g, ' ');
  body = stripVariations(body);
  body = body.replace(/\$\d+/g, ' ');
  body = body.replace(/[ \t]+/g, ' ');
  body = body.replace(/\n{3,}/g, '\n\n');

  // Если в тексте несколько партий — берём первую.
  const secondGame = body.search(/\n\s*\[\s*Event\s+"/);
  if (secondGame > 0) body = body.slice(0, secondGame);

  return (headers ? headers.replace(/\s+$/, '') + '\n\n' : '') + body.trim();
}

/** Разбирает PGN и возвращает заголовки, стартовую позицию и ходы. */
export function parsePgn(raw) {
  if (!raw || !String(raw).trim()) {
    throw new Error('PGN пустой — вставьте текст партии.');
  }

  const cleaned = cleanPgn(raw);
  const chess = new Chess();

  try {
    chess.loadPgn(cleaned);
  } catch (error) {
    throw new Error('Не удалось разобрать PGN: ' + (error.message || 'неизвестная ошибка') + '. Проверьте, что это корректная партия.');
  }

  const moves = chess.history({ verbose: true });
  if (!moves.length) {
    throw new Error('В PGN не найдено ни одного хода.');
  }

  const headers = chess.getHeaders();
  const startFen = moves[0].before;

  return {
    headers,
    startFen,
    moves,
    finalFen: moves[moves.length - 1].after,
  };
}

/** «2026.10.28» → «28.10.2026». */
export function formatPgnDate(value) {
  if (!value) return '—';
  const match = String(value).match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (!match) return String(value);
  return match[3].padStart(2, '0') + '.' + match[2].padStart(2, '0') + '.' + match[1];
}

export function formatTimestamp(seconds) {
  if (!seconds) return '—';
  try {
    return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(seconds * 1000));
  } catch (_) {
    return '—';
  }
}

/** Приводит результат PGN к красивому виду. */
export function resultScore(result) {
  if (result === '1-0') return '1–0';
  if (result === '0-1') return '0–1';
  if (result === '1/2-1/2') return '½–½';
  return '*';
}

export function resultLabel(result) {
  if (result === '1-0') return 'Победа белых';
  if (result === '0-1') return 'Победа чёрных';
  if (result === '1/2-1/2') return 'Ничья';
  return 'Партия';
}

function cleanElo(value) {
  if (!value || value === '?' || value === '0') return null;
  const number = parseInt(value, 10);
  return Number.isFinite(number) ? number : null;
}

/** Собирает метаданные партии из PGN-заголовков. */
export function gameMetaFromHeaders(headers, fallback = {}) {
  const whiteName = headers.White || fallback.whiteName || 'Белые';
  const blackName = headers.Black || fallback.blackName || 'Чёрные';
  const ecoParts = [headers.ECO, headers.Opening].filter(Boolean);

  return {
    white: {
      name: whiteName,
      elo: cleanElo(headers.WhiteElo) || fallback.whiteElo || null,
    },
    black: {
      name: blackName,
      elo: cleanElo(headers.BlackElo) || fallback.blackElo || null,
    },
    result: headers.Result || fallback.result || '*',
    date: formatPgnDate(headers.Date || headers.UTCDate || fallback.date),
    event: headers.Event || fallback.event || 'Партия',
    eco: ecoParts.join(' · '),
    site: headers.Site || '',
    source: fallback.source || 'PGN',
    url: fallback.url || headers.Link || '',
  };
}
