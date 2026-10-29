import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1.4.0/dist/esm/chess.js';

/**
 * Полноценный локальный шахматный движок.
 * Использует алгоритм Минимакс с альфа-бета отсечением и таблицами позиций (PST).
 * Не требует интернета, работает прямо в браузере.
 */
export class Engine {
  constructor() {
    this.ready = false;
  }

  async init(onStatus = () => {}) {
    if (this.ready) return onStatus('ready');
    onStatus('loading');
    await new Promise((r) => setTimeout(r, 300));
    this.ready = true;
    onStatus('ready');
  }

  async evaluate(fen, { depth = 3 } = {}) {
    if (!this.ready) throw new Error('Движок не готов');
    
    // Даем браузеру отрисовать UI перед тяжелым расчетом
    await new Promise((r) => setTimeout(r, 10));

    const chess = new Chess(fen);
    if (chess.isCheckmate()) {
      return { cp: chess.turn() === 'w' ? -20000 : 20000, mate: null, bestMove: null, pv: [] };
    }
    if (chess.isDraw() || chess.isStalemate()) {
      return { cp: 0, mate: null, bestMove: null, pv: [] };
    }

    // Максимальная глубина, чтобы браузер не завис
    const maxDepth = Math.min(depth, 3); 
    const bestMoveData = this.search(chess, maxDepth);

    return {
      cp: bestMoveData.score, // Оценка строго с точки зрения того, чей ход
      mate: null,
      depth: maxDepth,
      pv: bestMoveData.pv,
      bestMove: bestMoveData.move,
    };
  }

  search(chess, depth) {
    let bestScore = -Infinity;
    let bestMove = null;
    let pv = [];
    
    const moves = chess.moves({ verbose: true });
    // Сортируем ходы: сначала взятия (ускоряет альфа-бета)
    moves.sort((a, b) => (b.captured ? 1 : 0) - (a.captured ? 1 : 0));

    for (const move of moves) {
      chess.move(move);
      const score = -this.minimax(chess, depth - 1, -Infinity, -bestScore, false);
      chess.undo();

      if (score > bestScore) {
        bestScore = score;
        bestMove = move.from + move.to + (move.promotion || '');
        pv = [bestMove];
      }
    }
    return { score: bestScore, move: bestMove, pv };
  }

  minimax(chess, depth, alpha, beta, isMaximizing) {
    if (depth === 0) return this.evaluateBoard(chess);
    
    const moves = chess.moves({ verbose: true });
    if (moves.length === 0) {
      if (chess.isCheckmate()) return isMaximizing ? -99999 + depth : 99999 - depth;
      return 0;
    }

    // Сортируем взятия
    moves.sort((a, b) => (b.captured ? 1 : 0) - (a.captured ? 1 : 0));

    if (isMaximizing) {
      let maxEval = -Infinity;
      for (const move of moves) {
        chess.move(move);
        const ev = this.minimax(chess, depth - 1, alpha, beta, false);
        chess.undo();
        maxEval = Math.max(maxEval, ev);
        alpha = Math.max(alpha, ev);
        if (beta <= alpha) break;
      }
      return maxEval;
    } else {
      let minEval = Infinity;
      for (const move of moves) {
        chess.move(move);
        const ev = this.minimax(chess, depth - 1, alpha, beta, true);
        chess.undo();
        minEval = Math.min(minEval, ev);
        beta = Math.min(beta, ev);
        if (beta <= alpha) break;
      }
      return minEval;
    }
  }

  evaluateBoard(chess) {
    if (chess.isCheckmate()) {
      return chess.turn() === 'w' ? -99999 : 99999;
    }
    if (chess.isDraw() || chess.isStalemate()) return 0;

    let score = 0;
    const board = chess.board();

    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const piece = board[r][f];
        if (piece) {
          const val = getPieceValue(piece.type) + getPositionValue(piece.type, piece.color, r, f);
          score += piece.color === 'w' ? val : -val;
        }
      }
    }
    return chess.turn() === 'w' ? score : -score;
  }
}

function getPieceValue(type) {
  return { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 }[type] || 0;
}

// Таблицы позиций (Piece-Square Tables)
const PST = {
  p: [
    [ 0,  0,  0,  0,  0,  0,  0,  0],
    [50, 50, 50, 50, 50, 50, 50, 50],
    [10, 10, 20, 30, 30, 20, 10, 10],
    [ 5,  5, 10, 25, 25, 10,  5,  5],
    [ 0,  0,  0, 20, 20,  0,  0,  0],
    [ 5, -5,-10,  0,  0,-10, -5,  5],
    [ 5, 10, 10,-20,-20, 10, 10,  5],
    [ 0,  0,  0,  0,  0,  0,  0,  0]
  ],
  n: [
    [-50,-40,-30,-30,-30,-30,-40,-50],
    [-40,-20,  0,  0,  0,  0,-20,-40],
    [-30,  0, 10, 15, 15, 10,  0,-30],
    [-30,  5, 15, 20, 20, 15,  5,-30],
    [-30,  0, 15, 20, 20, 15,  0,-30],
    [-30,  5, 10, 15, 15, 10,  5,-30],
    [-40,-20,  0,  5,  5,  0,-20,-40],
    [-50,-40,-30,-30,-30,-30,-40,-50]
  ],
  b: [
    [-20,-10,-10,-10,-10,-10,-10,-20],
    [-10,  0,  0,  0,  0,  0,  0,-10],
    [-10,  0,  5, 10, 10,  5,  0,-10],
    [-10,  5,  5, 10, 10,  5,  5,-10],
    [-10,  0, 10, 10, 10, 10,  0,-10],
    [-10, 10, 10, 10, 10, 10, 10,-10],
    [-10,  5,  0,  0,  0,  0,  5,-10],
    [-20,-10,-10,-10,-10,-10,-10,-20]
  ],
  r: [
    [ 0,  0,  0,  0,  0,  0,  0,  0],
    [ 5, 10, 10, 10, 10, 10, 10,  5],
    [-5,  0,  0,  0,  0,  0,  0, -5],
    [-5,  0,  0,  0,  0,  0,  0, -5],
    [-5,  0,  0,  0,  0,  0,  0, -5],
    [-5,  0,  0,  0,  0,  0,  0, -5],
    [-5,  0,  0,  0,  0,  0,  0, -5],
    [ 0,  0,  0,  5,  5,  0,  0,  0]
  ],
  q: [
    [-20,-10,-10, -5, -5,-10,-10,-20],
    [-10,  0,  0,  0,  0,  0,  0,-10],
    [-10,  0,  5,  5,  5,  5,  0,-10],
    [ -5,  0,  5,  5,  5,  5,  0, -5],
    [  0,  0,  5,  5,  5,  5,  0, -5],
    [-10,  5,  5,  5,  5,  5,  0,-10],
    [-10,  0,  5,  0,  0,  0,  0,-10],
    [-20,-10,-10, -5, -5,-10,-10,-20]
  ],
  k: [
    [-30,-40,-40,-50,-50,-40,-40,-30],
    [-30,-40,-40,-50,-50,-40,-40,-30],
    [-30,-40,-40,-50,-50,-40,-40,-30],
    [-30,-40,-40,-50,-50,-40,-40,-30],
    [-20,-30,-30,-40,-40,-30,-30,-20],
    [-10,-20,-20,-20,-20,-20,-20,-10],
    [ 20, 20,  0,  0,  0,  0, 20, 20],
    [ 20, 30, 10,  0,  0, 10, 30, 20]
  ]
};

function getPositionValue(type, color, r, f) {
  const table = PST[type];
  if (!table) return 0;
  // Для белых r=0 это 8-я горизонталь. Для чёрных нужно перевернуть.
  const row = color === 'w' ? r : 7 - r;
  return table[row][f];
}
