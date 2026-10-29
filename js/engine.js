import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1.4.0/dist/esm/chess.js';

/**
 * Локальный движок анализа.
 * Не требует воркеров, CDN и интернета. Работает прямо в основном потоке.
 */
export class Engine {
  constructor() {
    this.ready = false;
  }

  async init(onStatus = () => {}) {
    if (this.ready) return onStatus('ready');
    onStatus('loading');
    // Имитация инициализации для совместимости
    await new Promise((r) => setTimeout(r, 300));
    this.ready = true;
    onStatus('ready');
  }

  async evaluate(fen, { depth = 12 } = {}) {
    if (!this.ready) throw new Error('Движок не готов');
    // Уступаем поток, чтобы UI не зависал
    await new Promise((r) => setTimeout(r, 5));
    
    const chess = new Chess(fen);
    if (chess.isCheckmate()) return { cp: -20000, mate: null, depth: 1, pv: [], bestMove: null };
    if (chess.isDraw() || chess.isStalemate()) return { cp: 0, mate: null, depth: 1, pv: [], bestMove: null };

    const moves = chess.moves({ verbose: true });
    let bestScore = -Infinity;
    let bestMoveUci = null;
    let bestPv = [];

    // Простой поиск на 2 полухода (достаточно для оценки зевков)
    for (const move of moves) {
      chess.move(move);
      let score = -evaluateBoard(chess);
      
      // Противник ищет свой лучший ответ
      if (depth >= 2) {
        const oppMoves = chess.moves({ verbose: true });
        if (oppMoves.length > 0) {
          let worstScore = Infinity;
          for (const oppMove of oppMoves) {
            chess.move(oppMove);
            const s = evaluateBoard(chess);
            if (s < worstScore) worstScore = s;
            chess.undo();
          }
          score = -worstScore;
        }
      }
      
      chess.undo();

      if (score > bestScore) {
        bestScore = score;
        bestMoveUci = move.from + move.to + (move.promotion || '');
        bestPv = [bestMoveUci];
      }
    }

    // Ограничиваем оценку
    let cpScore = Math.round(bestScore);
    if (cpScore > 20000) cpScore = 20000;
    if (cpScore < -20000) cpScore = -20000;

    return {
      cp: cpScore,
      mate: null,
      depth: depth,
      pv: bestPv,
      bestMove: bestMoveUci,
    };
  }

  stop() {
    // Мгновенная остановка не требуется, так как просчет быстрый
  }
}

// Оценочная функция
function evaluateBoard(chess) {
  const values = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };
  let score = 0;
  const board = chess.board();

  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const piece = board[r][f];
      if (piece) {
        let val = values[piece.type] || 0;
        // Бонус за центр
        if (f >= 2 && f <= 5 && r >= 2 && r <= 5) val += 10;
        // Бонус за продвижение пешек
        if (piece.type === 'p') {
          if (piece.color === 'w') val += (6 - r) * 5;
          else val += (r - 1) * 5;
        }
        score += piece.color === 'w' ? val : -val;
      }
    }
  }
  return score;
}
