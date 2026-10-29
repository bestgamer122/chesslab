export const CONFIG = {
  ENGINE_DEFAULT_DEPTH: 14,
  CHESSCOM_API: 'https://api.chess.com/pub',
  EVAL_CLAMP: 6
};

export const CLASSES = {
  brilliant: { label: 'Блестящий', short: '!!', color: '#2dd4bf' },
  great:     { label: 'Замечательный', short: '!', color: '#38bdf8' },
  best:      { label: 'Лучший', short: '★', color: '#a3e635' },
  excellent: { label: 'Отлично', short: '✓', color: '#86efac' },
  good:      { label: 'Хорошо', short: '·', color: '#cbd5e1' },
  inaccuracy:{ label: 'Неточность', short: '?!', color: '#fbbf24' },
  mistake:   { label: 'Ошибка', short: '?', color: '#fb923c' },
  miss:      { label: 'Упущенный шанс', short: '✗', color: '#f87171' },
  blunder:   { label: 'Зевок', short: '??', color: '#ef4444' },
};
