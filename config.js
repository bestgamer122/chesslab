/**
 * Общие настройки ChessLab.
 * Все внешние зависимости подключаются с CDN — сборка не требуется.
 */
export const CONFIG = {
  ENGINE_CDN: 'https://cdn.jsdelivr.net/npm/stockfish.js@10.0.2/stockfish.js',
  ENGINE_SHIM: 'js/engine/sf-shim.js', // <--- Добавили эту строку
  ENGINE_DEFAULT_DEPTH: 12,
  ENGINE_TIMEOUT_MS: 90000,

  CHESSCOM_API: 'https://api.chess.com/pub',
  CHESSCOM_MAX_GAMES: 24,
  CHESSCOM_CACHE_MS: 10 * 60 * 1000,

  EVAL_CLAMP: 6,
};

export const CLASSES = {
  brilliant: { label: 'Блестящий ход', short: 'Блестящий', symbol: '!!', color: '#2dd4bf' },
  great:     { label: 'Отличный ход',  short: 'Отличный',  symbol: '!',  color: '#60a5fa' },
  best:      { label: 'Лучший ход',    short: 'Лучший',    symbol: '★',  color: '#a3e635' },
  excellent: { label: 'Отлично',       short: 'Отлично',   symbol: '✓',  color: '#86efac' },
  good:      { label: 'Хорошо',        short: 'Хорошо',    symbol: '·',  color: '#cbd5e1' },
  inaccuracy:{ label: 'Неточность',    short: 'Неточность',symbol: '?!', color: '#fbbf24' },
  mistake:   { label: 'Ошибка',        short: 'Ошибка',    symbol: '?',  color: '#fb923c' },
  blunder:   { label: 'Зевок',         short: 'Зевок',     symbol: '??', color: '#f87171' },
  miss:      { label: 'Упущенный мат', short: 'Упущенный мат', symbol: '✗', color: '#f87171' },
};

export const CLASS_KEYS = Object.keys(CLASSES);
