/*
 * ChessLab Local Engine
 * Легковесный шахматный движок на чистом JavaScript.
 * Работает локально в Web Worker, не требует интернета.
 */

importScripts('https://cdn.jsdelivr.net/npm/chess.js@1.4.0/dist/cjs/chess.js');

let currentFen = '';
let currentDepth = 12;

self.onmessage = function(e) {
    const cmd = e.data;
    
    if (cmd === 'uci') {
        self.postMessage('id name ChessLab Local');
        self.postMessage('uciok');
    } else if (cmd === 'isready') {
        self.postMessage('readyok');
    } else if (cmd.startsWith('position fen ')) {
        currentFen = cmd.replace('position fen ', '').trim();
    } else if (cmd.startsWith('go depth ')) {
        currentDepth = parseInt(cmd.replace('go depth ', ''), 10) || 12;
        calculateBestMove();
    } else if (cmd === 'stop') {
        // Мгновенная остановка
    }
};

function calculateBestMove() {
    try {
        const chess = new Chess(currentFen);
        const moves = chess.moves({ verbose: true });
        
        if (moves.length === 0) {
            self.postMessage('bestmove (none)');
            return;
        }

        let bestMove = null;
        let bestScore = -Infinity;

        // Поиск на 2-3 полухода (достаточно для точной оценки)
        for (const move of moves) {
            chess.move(move);
            let score = -evaluateBoard(chess);

            // Противник ищет свой лучший ход
            if (currentDepth >= 2) {
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
                bestMove = move.from + move.to + (move.promotion || '');
            }
        }

        // Нормализация оценки для UCI
        let cpScore = Math.round(bestScore);
        if (cpScore > 20000) cpScore = 20000;
        if (cpScore < -20000) cpScore = -20000;

        self.postMessage(`info depth ${currentDepth} score cp ${cpScore} pv ${bestMove}`);
        self.postMessage(`bestmove ${bestMove}`);
    } catch (err) {
        self.postMessage('bestmove (none)');
    }
}

function evaluateBoard(chess) {
    if (chess.isCheckmate()) return -99999;
    if (chess.isDraw()) return 0;

    const pieceValues = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };
    let score = 0;
    const board = chess.board();

    for (let r = 0; r < 8; r++) {
        for (let f = 0; f < 8; f++) {
            const piece = board[r][f];
            if (piece) {
                let val = pieceValues[piece.type] || 0;
                
                // Бонус за контроль центра
                if (f > 1 && f < 6 && r > 1 && r < 6) val += 15;
                
                // Бонус за продвижение пешек
                if (piece.type === 'p') {
                    if (piece.color === 'w') val += (6 - r) * 10;
                    else val += (r - 1) * 10;
                }

                score += piece.color === 'w' ? val : -val;
            }
        }
    }
    return score;
}
