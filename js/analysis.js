import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1.4.0/dist/esm/chess.js';

const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function abortError() {
  const error = new Error('Анализ отменён');
  error.name = 'AbortError';
  return error;
}

/** Вероятность победы (0–100) по оценке в сантипешках. */
export function winPercent(cp, mate = null) {
  if (mate !== null && mate !== undefined) return mate > 0 ? 100 : 0;
  const safe = clamp(cp || 0, -1500, 1500);
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * safe)) - 1);
}

/** Переводит оценку движка (от стороны, которая ходит) в оценку белых. */
export function whiteEval(fen, evaluation) {
  const turn = (fen.split(' ')[1] || 'w');
  if (evaluation.mate !== null && evaluation.mate !== undefined) {
    const whiteMate = turn === 'w' ? evaluation.mate : -evaluation.mate;
    return {
      cp: whiteMate > 0 ? 20000 : -20000,
      mate: whiteMate === 0 ? -0.001 : whiteMate,
    };
  }
  const cp = Number.isFinite(evaluation.cp) ? evaluation.cp : 0;
  return { cp: turn === 'w' ? cp : -cp, mate: null };
}

function uciOf(move) {
  return move.from + move.to + (move.promotion || '');
}

function sanForUci(fen, uci) {
  if (!uci || uci.length < 4) return null;
  try {
    const chess = new Chess(fen);
    const move = chess.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci[4] || undefined,
    });
    return move ? move.san : null;
  } catch (_) {
    return null;
  }
}

function pvToSan(fen, pv, limit = 7) {
  if (!Array.isArray(pv) || !pv.length) return [];
  const chess = new Chess(fen);
  const result = [];
  for (const uci of pv.slice(0, limit)) {
    try {
      const move = chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci[4] || undefined,
      });
      if (!move) break;
      result.push(move.san);
    } catch (_) {
      break;
    }
  }
  return result;
}

function materialBalance(fen, color) {
  const board = fen.split(' ')[0] || '';
  let score = 0;
  for (const char of board) {
    const lower = char.toLowerCase();
    const value = PIECE_VALUE[lower];
    if (!value) continue;
    const isWhite = char === char.toUpperCase();
    const sign = isWhite ? 1 : -1;
    score += sign * value;
  }
  return color === 'w' ? score : -score;
}

/** Эвристика жертвы: фигура под боем и защитников не больше, чем атакующих. */
function isHangingSacrifice(fenAfter, square, mover) {
  try {
    const chess = new Chess(fenAfter);
    const piece = chess.get(square);
    if (!piece || piece.color !== mover) return false;
    const value = PIECE_VALUE[piece.type] || 0;
    if (value < 3) return false;

    const opponent = mover === 'w' ? 'b' : 'w';
    const attackers = chess.attackers(square, opponent);
    if (!attackers.length) return false;

    const defenders = chess.attackers(square, mover);
    if (defenders.length === 0) return true;

    let cheapestAttacker = 99;
    for (const attackerSquare of attackers) {
      const attacker = chess.get(attackerSquare);
      if (attacker) cheapestAttacker = Math.min(cheapestAttacker, PIECE_VALUE[attacker.type] || 0);
    }
    return cheapestAttacker < value && defenders.length <= attackers.length;
  } catch (_) {
    return false;
  }
}

/** Точность одного хода по потерянному проценту вероятности победы. */
function moveAccuracy(loss) {
  const raw = 103.1668 * Math.exp(-0.04354 * loss) - 3.1669;
  return clamp(raw, 0, 100);
}

function classifyMove({ isBest, loss, winBefore, winAfter, deliveredMate, missedMate, sacrifice }) {
  if (deliveredMate) return 'best';
  if (missedMate) return 'miss';
  if (isBest && sacrifice && winAfter >= 45) return 'brilliant';
  if (isBest && winBefore < 50 && winAfter - winBefore >= 12) return 'great';
  if (isBest) return 'best';
  if (loss < 2) return 'excellent';
  if (loss < 5) return 'good';
  if (loss < 10) return 'inaccuracy';
  if (loss < 18) return 'mistake';
  return 'blunder';
}

function emptyCounts() {
  return {
    brilliant: 0, great: 0, best: 0, excellent: 0, good: 0,
    inaccuracy: 0, mistake: 0, blunder: 0, miss: 0,
  };
}

/**
 * Оценивает все позиции партии и классифицирует ходы.
 */
export async function analyzeGame({
  moves,
  startFen,
  engine,
  depth,
  onProgress = () => {},
  isCancelled = () => false,
}) {
  const positions = [startFen, ...moves.map((move) => move.after)];
  const evaluations = [];

  for (let index = 0; index < positions.length; index++) {
    if (isCancelled()) throw abortError();

    onProgress(index, positions.length);
    const fen = positions[index];
    const chess = new Chess(fen);

    let evaluation;
    if (chess.isCheckmate()) {
      evaluation = {
        cp: chess.turn() === 'w' ? -20000 : 20000,
        mate: null,
        bestMove: null,
        pv: [],
        terminal: 'mate',
      };
    } else if (chess.isDraw() || chess.isStalemate() || chess.isInsufficientMaterial()) {
      evaluation = { cp: 0, mate: null, bestMove: null, pv: [], terminal: 'draw' };
    } else {
      evaluation = await engine.evaluate(fen, { depth });
    }

    evaluations.push(evaluation);
    onProgress(index + 1, positions.length);

    if (isCancelled()) throw abortError();
  }

  return buildAnalysis({ moves, positions, evaluations, depth });
}

function buildAnalysis({ moves, positions, evaluations, depth }) {
  const moveAnalyses = [];
  const counts = { w: emptyCounts(), b: emptyCounts() };
  const lossSum = { w: 0, b: 0 };
  const cpLossSum = { w: 0, b: 0 };
  const moveCount = { w: 0, b: 0 };

  for (let index = 0; index < moves.length; index++) {
    const move = moves[index];
    const before = evaluations[index];
    const after = evaluations[index + 1];

    const beforeWhite = whiteEval(move.before, before);
    const afterWhite = whiteEval(move.after, after);

    const sign = move.color === 'w' ? 1 : -1;
    const mateBeforeMover = beforeWhite.mate === null ? null : beforeWhite.mate * sign;
    const mateAfterMover = afterWhite.mate === null ? null : afterWhite.mate * sign;
    const cpBeforeMover = beforeWhite.cp * sign;
    const cpAfterMover = afterWhite.cp * sign;

    const winBefore = winPercent(cpBeforeMover, mateBeforeMover);
    const winAfter = winPercent(cpAfterMover, mateAfterMover);
    const loss = clamp(winBefore - winAfter, 0, 100);

    let cpLoss;
    if (mateBeforeMover !== null || mateAfterMover !== null) {
      cpLoss = loss > 0 ? 1000 : 0;
    } else {
      cpLoss = clamp(cpBeforeMover - cpAfterMover, 0, 1000);
    }

    const playedUci = uciOf(move);
    const bestUci = before.bestMove || null;
    const isBest = !!bestUci && bestUci === playedUci;
    const deliveredMate = /#/.test(move.san);
    const missedMate = !deliveredMate
      && mateBeforeMover !== null && mateBeforeMover > 0
      && !(mateAfterMover !== null && mateAfterMover > 0)
      && loss >= 8;

    const materialDelta = materialBalance(move.after, move.color) - materialBalance(move.before, move.color);
    const sacrifice = isHangingSacrifice(move.after, move.to, move.color) || materialDelta <= -1.9;

    const classification = classifyMove({
      isBest, loss, winBefore, winAfter, deliveredMate, missedMate, sacrifice,
    });

    counts[move.color][classification] += 1;
    lossSum[move.color] += loss;
    cpLossSum[move.color] += cpLoss;
    moveCount[move.color] += 1;

    moveAnalyses.push({
      ...move,
      ply: index + 1,
      uci: playedUci,
      evalBeforeWhite: beforeWhite,
      evalAfterWhite: afterWhite,
      winBefore,
      winAfter,
      loss,
      cpLoss,
      accuracy: moveAccuracy(loss),
      bestMove: bestUci,
      bestSan: bestUci ? sanForUci(move.before, bestUci) : null,
      pvSan: pvToSan(move.before, before.pv),
      isBest,
      sacrifice,
      materialDelta,
      classification,
    });
  }

  const points = evaluations.map((evaluation, index) => {
    const white = whiteEval(positions[index], evaluation);
    return { ply: index, cp: white.cp, mate: white.mate };
  });

  function summarize(color) {
    const total = moveCount[color] || 1;
    const averageLoss = lossSum[color] / total;
    const accuracy = clamp(103.1668 * Math.exp(-0.04354 * averageLoss) - 3.1669, 0, 100);
    return {
      accuracy,
      acpl: Math.round(cpLossSum[color] / total),
      counts: counts[color],
      moves: moveCount[color],
    };
  }

  return {
    moves: moveAnalyses,
    summary: { w: summarize('w'), b: summarize('b') },
    points,
    evaluations,
    positions,
    depth,
  };
}
