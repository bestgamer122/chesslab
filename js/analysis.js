import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1.4.0/dist/esm/chess.js';

const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const abortError = () => { const e = new Error('AbortError'); e.name = 'AbortError'; return e; };

// Lichess/Chess.com Win Probability
export function winPercent(cp, mate) {
  if (mate !== null && mate !== undefined) return mate > 0 ? 100 : 0;
  const safe = clamp(cp || 0, -1500, 1500);
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * safe)) - 1);
}

export function whiteEval(fen, ev) {
  const turn = fen.split(' ')[1] || 'w';
  if (ev.mate !== null) {
    const m = turn === 'w' ? ev.mate : -ev.mate;
    return { cp: m > 0 ? 20000 : -20000, mate: m };
  }
  const cp = Number.isFinite(ev.cp) ? ev.cp : 0;
  return { cp: turn === 'w' ? cp : -cp, mate: null };
}

function getUci(m) { return m.from + m.to + (m.promotion || ''); }
function getSan(fen, uci) {
  if (!uci || uci.length < 4) return null;
  try {
    const c = new Chess(fen);
    const m = c.move({ from: uci.slice(0,2), to: uci.slice(2,4), promotion: uci[4] || undefined });
    return m ? m.san : null;
  } catch (_) { return null; }
}

function getPvSan(fen, pv) {
  const c = new Chess(fen), res = [];
  for (const uci of pv.slice(0, 7)) {
    try {
      const m = c.move({ from: uci.slice(0,2), to: uci.slice(2,4), promotion: uci[4] || undefined });
      if (m) res.push(m.san); else break;
    } catch (_) { break; }
  }
  return res;
}

function calcMaterial(fen, color) {
  let sc = 0;
  for (const ch of fen.split(' ')[0]) {
    const val = PIECE_VALUE[ch.toLowerCase()];
    if (val) sc += (ch === ch.toUpperCase() ? 1 : -1) * val;
  }
  return color === 'w' ? sc : -sc;
}

function isSacrifice(fen, square, mover) {
  try {
    const c = new Chess(fen), piece = c.get(square);
    if (!piece || piece.color !== mover || PIECE_VALUE[piece.type] < 3) return false;
    const opp = mover === 'w' ? 'b' : 'w';
    const att = c.attackers(square, opp), def = c.attackers(square, mover);
    if (!att.length) return false;
    if (!def.length) return true;
    let cheapest = 99;
    for (const a of att) { const p = c.get(a); if (p) cheapest = Math.min(cheapest, PIECE_VALUE[p.type]); }
    return cheapest < PIECE_VALUE[piece.type] && def.length <= att.length;
  } catch (_) { return false; }
}

// Lichess Accuracy Formula
function accuracyFromLoss(loss) { 
  return clamp(103.1668 * Math.exp(-0.04354 * loss) - 3.1669, 0, 100); 
}

function classifyMove({ isBest, cpLoss, winLoss, winBefore, winAfter, delivMate, missedMate, sac }) {
  if (delivMate) return 'best';
  if (missedMate) return 'miss';
  if (isBest && sac && winAfter >= 40) return 'brilliant';
  if (isBest && winBefore < 50 && winAfter - winBefore >= 15) return 'great';
  if (isBest) return 'best';
  if (winLoss < 2 && cpLoss < 30) return 'excellent';
  if (winLoss < 5 && cpLoss < 60) return 'good';
  if (winLoss < 10 && cpLoss < 120) return 'inaccuracy';
  if (winLoss < 20 && cpLoss < 250) return 'mistake';
  return 'blunder';
}

function emptyCounts() { return { brilliant:0, great:0, best:0, excellent:0, good:0, inaccuracy:0, mistake:0, blunder:0, miss:0 }; }

export async function analyzeGame({ moves, startFen, engine, depth, onProgress, isCancelled }) {
  const positions = [startFen, ...moves.map(m => m.after)];
  const evals = [];

  for (let i = 0; i < positions.length; i++) {
    if (isCancelled()) throw abortError();
    onProgress(i, positions.length);
    
    const fen = positions[i], c = new Chess(fen);
    let ev;
    if (c.isCheckmate()) ev = { cp: c.turn() === 'w' ? -20000 : 20000, mate: null, bestMove: null, pv: [] };
    else if (c.isDraw() || c.isStalemate()) ev = { cp: 0, mate: null, bestMove: null, pv: [] };
    else ev = await engine.evaluate(fen, { depth });
    
    evals.push(ev);
    onProgress(i + 1, positions.length);
    if (isCancelled()) throw abortError();
  }

  const moveStats = [], counts = { w: emptyCounts(), b: emptyCounts() }, lossSum = { w: 0, b: 0 }, cpLossSum = { w: 0, b: 0 }, mCount = { w: 0, b: 0 };

  for (let i = 0; i < moves.length; i++) {
    const m = moves[i], before = evals[i], after = evals[i + 1];
    const bW = whiteEval(m.before, before), aW = whiteEval(m.after, after);
    const sign = m.color === 'w' ? 1 : -1;
    
    const mateB = bW.mate === null ? null : bW.mate * sign;
    const mateA = aW.mate === null ? null : aW.mate * sign;
    const cpB = bW.cp * sign, cpA = aW.cp * sign;

    const winB = winPercent(cpB, mateB), winA = winPercent(cpA, mateA);
    const winLoss = clamp(winB - winA, 0, 100);
    const cpLoss = mateB !== null || mateA !== null ? (winLoss > 0 ? 1000 : 0) : clamp(cpB - cpA, 0, 1000);

    const playedUci = getUci(m), bestUci = before.bestMove;
    const isBest = bestUci === playedUci;
    const delivMate = /#/.test(m.san);
    const missedMate = !delivMate && mateB > 0 && !(mateA > 0) && winLoss >= 8;

    const matDelta = calcMaterial(m.after, m.color) - calcMaterial(m.before, m.color);
    const sac = isSacrifice(m.after, m.to, m.color) || matDelta <= -1.9;
    
    const classification = classifyMove({ isBest, cpLoss, winLoss, winBefore: winB, winAfter: winA, delivMate, missedMate, sac });

    counts[m.color][classification]++;
    lossSum[m.color] += winLoss; 
    cpLossSum[m.color] += cpLoss; 
    mCount[m.color]++;

    moveStats.push({
      ...m, ply: i + 1, uci: playedUci, evalBeforeWhite: bW, evalAfterWhite: aW,
      winBefore: winB, winAfter: winA, loss: winLoss, cpLoss, accuracy: accuracyFromLoss(winLoss),
      bestMove: bestUci, bestSan: getSan(m.before, bestUci), pvSan: getPvSan(m.before, before.pv),
      isBest, sacrifice: sac, materialDelta: matDelta, classification
    });
  }

  const points = evals.map((ev, i) => ({ ply: i, ...whiteEval(positions[i], ev) }));
  const summ = (col) => {
    const tot = mCount[col] || 1;
    return { accuracy: accuracyFromLoss(lossSum[col] / tot), acpl: Math.round(cpLossSum[col] / tot), counts: counts[col] };
  };

  return { moves: moveStats, summary: { w: summ('w'), b: summ('b') }, points, evaluations: evals, positions, depth };
}
