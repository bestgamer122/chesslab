import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1.4.0/dist/esm/chess.js';

const PIECES = {
  p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚',
  P: '♙', N: '♘', B: '♗', R: '♖', Q: '♕', K: '♔'
};

export class BoardView {
  constructor(element, settings) {
    this.el = element;
    this.settings = settings;
    this.orientation = 'w';
    this.currentFen = new Chess().fen();
    this.squares = [];
    
    this.renderGrid();
    this.updateStyles();
  }

  renderGrid() {
    this.el.innerHTML = '';
    this.el.innerHTML = '<svg id="arrowLayer"></svg>';
    
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const sq = document.createElement('div');
        sq.className = `square ${(r + f) % 2 === 0 ? 'light' : 'dark'}`;
        
        // Координаты
        const fileLabel = document.createElement('span');
        fileLabel.className = 'coord file';
        fileLabel.textContent = 'abcdefgh'[f];
        
        const rankLabel = document.createElement('span');
        rankLabel.className = 'coord rank';
        rankLabel.textContent = 8 - r;

        sq.appendChild(fileLabel);
        sq.appendChild(rankLabel);
        
        this.el.appendChild(sq);
        this.squares.push(sq);
      }
    }
  }

  updateStyles() {
    this.el.className = `chessboard theme-${this.settings.get('boardTheme')} style-${this.settings.get('pieceStyle')}`;
    const showCoords = this.settings.get('showCoords');
    this.el.querySelectorAll('.coord').forEach(c => c.style.display = showCoords ? '' : 'none');
  }

  setPosition(fen, { from, to, best, animate = true } = {}) {
    this.currentFen = fen;
    const chess = new Chess(fen);
    const board = chess.board();
    
    // Отрисовка фигур
    let index = 0;
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const piece = board[r][f];
        const sq = this.squares[index];
        
        sq.classList.remove('last-move', 'check');
        
        // Очищаем старые фигуры
        const existing = sq.querySelector('.piece');
        if (existing) existing.remove();
        
        // Добавляем новую
        if (piece) {
          const p = document.createElement('div');
          p.className = `piece ${piece.color}`;
          p.textContent = PIECES[piece.color === 'w' ? piece.type.toUpperCase() : piece.type];
          
          if (!animate || !this.settings.get('animations')) p.style.transition = 'none';
          else p.style.transition = 'transform 0.2s ease-in-out';

          sq.appendChild(p);
        }
        index++;
      }
    }

    // Подсветка
    if (from && to) {
      this.getSquareEl(from)?.classList.add('last-move');
      this.getSquareEl(to)?.classList.add('last-move');
    }

    // Шах
    if (chess.inCheck()) {
      const turn = chess.turn();
      // Находим короля
      for (let r = 0; r < 8; r++) {
        for (let f = 0; f < 8; f++) {
          const p = board[r][f];
          if (p && p.type === 'k' && p.color === turn) {
            const sqName = 'abcdefgh'[f] + (8 - r);
            this.getSquareEl(sqName)?.classList.add('check');
          }
        }
      }
    }

    this.drawArrow(best);
  }

  getSquareEl(sq) {
    const f = 'abcdefgh'.indexOf(sq[0]);
    const r = 8 - parseInt(sq[1], 10);
    if (f === -1 || isNaN(r)) return null;
    
    // Учитываем переворот доски
    let index;
    if (this.orientation === 'w') index = r * 8 + f;
    else index = (7 - r) * 8 + (7 - f);
    
    return this.squares[index];
  }

  drawArrow(best) {
    const svg = this.el.querySelector('#arrowLayer');
    svg.innerHTML = '';
    if (!best || best.length < 4) return;

    const from = best.slice(0, 2);
    const to = best.slice(2, 4);
    
    const sqFrom = this.getSquareEl(from);
    const sqTo = this.getSquareEl(to);
    if (!sqFrom || !sqTo) return;

    const rectFrom = sqFrom.getBoundingClientRect();
    const rectTo = sqTo.getBoundingClientRect();
    const rectBoard = this.el.getBoundingClientRect();

    const x1 = (rectFrom.left - rectBoard.left) + rectFrom.width / 2;
    const y1 = (rectFrom.top - rectBoard.top) + rectFrom.height / 2;
    const x2 = (rectTo.left - rectBoard.left) + rectTo.width / 2;
    const y2 = (rectTo.top - rectBoard.top) + rectTo.height / 2;

    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    defs.innerHTML = `
      <marker id="arrowhead" markerWidth="4" markerHeight="4" refX="2" refY="2" orient="auto">
        <polygon points="0 0, 4 2, 0 4" fill="rgba(143, 191, 90, 0.8)" />
      </marker>
    `;
    svg.appendChild(defs);

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', x1);
    line.setAttribute('y1', y1);
    line.setAttribute('x2', x2);
    line.setAttribute('y2', y2);
    line.setAttribute('stroke', 'rgba(143, 191, 90, 0.8)');
    line.setAttribute('stroke-width', rectFrom.width * 0.15);
    line.setAttribute('marker-end', 'url(#arrowhead)');
    line.setAttribute('stroke-linecap', 'round');
    svg.appendChild(line);
  }

  flip() {
    this.orientation = this.orientation === 'w' ? 'b' : 'w';
    this.el.style.transform = this.orientation === 'b' ? 'rotate(180deg)' : 'none';
    this.el.querySelectorAll('.piece').forEach(p => {
      p.style.transform = this.orientation === 'b' ? 'rotate(180deg)' : 'none';
    });
  }
}
