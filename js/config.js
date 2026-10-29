/**
 * Настройки приложения.
 */
export const CONFIG = {
  // Список зеркал для загрузки движка (если один заблокирован, сработает другой)
  ENGINE_URLS: [
    'https://cdn.jsdelivr.net/npm/stockfish.js@10.0.2/stockfish.js',
    'https://unpkg.com/stockfish.js@10.0.2/stockfish.js',
    'https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js'
  ],
  ENGINE_DEFAULT_DEPTH: 12,
  CHESSCOM_API: 'https://api.chess.com/pub',
  EVAL_CLAMP: 6
};

export const CLASSES = {
  brilliant: { label: 'Блестящий ход', short: '!!', color: '#2dd4bf' },
  great:     { label: 'Отличный ход',  short: '!',  color: '#60a5fa' },
  best:      { label: 'Лучший ход',    short: '★',  color: '#a3e635' },
  excellent: { label: 'Отлично',       short: '✓',  color: '#86efac' },
  good:      { label: 'Хорошо',        short: '·',  color: '#cbd5e1' },
  inaccuracy:{ label: 'Неточность',    short: '?!', color: '#fbbf24' },
  mistake:   { label: 'Ошибка',        short: '?',  color: '#fb923c' },
  blunder:   { label: 'Зевок',         short: '??', color: '#f87171' },
  miss:      { label: 'Упущенный мат', short: '✗',  color: '#f87171' },
};
