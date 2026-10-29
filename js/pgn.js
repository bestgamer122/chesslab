import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1.4.0/dist/esm/chess.js';

function stripVariations(text) {
  let out = '', depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0) out += ch;
  }
  return out;
}

export function cleanPgn(raw) {
  let text = String(raw || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  let headers = '', body = text;
  const split = text.search(/\n\s*\n/);
  if (split >= 0) {
    headers = text.slice(0, split + 1);
    body = text.slice(split + 1);
  }
  body = body.replace(/\{[^}]*\}/g, ' ').replace(/;[^\n]*/g, ' ').replace(/\$\d+/g, ' ');
  body = stripVariations(body).replace(/[ \t]+/g, ' ');
  return (headers ? headers.trim() + '\n\n' : '') + body.trim();
}

export function parsePgn(raw) {
  if (!raw || !String(raw).trim()) throw new Error('PGN пустой');
  const chess = new Chess();
  try {
    chess.loadPgn(cleanPgn(raw));
  } catch (e) {
    throw new Error('Ошибка в PGN: ' + e.message);
  }
  const moves = chess.history({ verbose: true });
  if (!moves.length) throw new Error('В PGN нет ходов');
  return { headers: chess.getHeaders(), startFen: moves[0].before, moves };
}

export function formatTimestamp(seconds) {
  if (!seconds) return '—';
  try { return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(seconds * 1000)); } catch (_) { return '—'; }
}

export function resultScore(r) { return r === '1-0' ? '1–0' : r === '0-1' ? '0–1' : r === '1/2-1/2' ? '½–½' : '*'; }
export function resultLabel(r) { return r === '1-0' ? 'Победа белых' : r === '0-1' ? 'Победа чёрных' : r === '1/2-1/2' ? 'Ничья' : 'Партия'; }

export function gameMetaFromHeaders(h, fallback = {}) {
  return {
    white: { name: h.White || fallback.whiteName || 'Белые', elo: parseInt(h.WhiteElo) || fallback.whiteElo || null },
    black: { name: h.Black || fallback.blackName || 'Чёрные', elo: parseInt(h.BlackElo) || fallback.blackElo || null },
    result: h.Result || fallback.result || '*',
    date: h.Date ? h.Date.replace(/\./g, '.') : (fallback.date || '—'),
    event: h.Event || fallback.event || 'Партия',
    eco: [h.ECO, h.Opening].filter(Boolean).join(' · '),
    source: fallback.source || 'PGN'
  };
}
