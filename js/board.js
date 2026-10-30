import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1.4.0/dist/esm/chess.js';

const PIECES = {
  p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚',
  P: '♟', N: '♞', B: '♝', R: '♜', Q: '♛', K: '♚'
};

export class BoardView {
  constructor(element, settings, onMove = null) {
    this.el = element;
    this.settings = settings;
    this.onMove = onMove;
    this.orientation = 'w';
    this.currentFen = new Chess().fen();
    this.squares = [];
    this.selectedSq = null;
    this.interactive = false;
    
    this.renderGrid();
    this.updateStyles();
  }

  setInteractive(state) {
    this.interactive = state;
    if (!state) {
      this.clearSelection();
    }
  }

  renderGrid() {
    this.el.innerHTML = '<svg id="arrowLayer"></svg>';
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const sq = document.createElement('div');
        sq.className = `square ${(r + f) % 2 === 0 ? 'light' : 'dark'}`;
        sq.dataset.sq = 'abcdefgh'[f] + (8 - r);
        
        const fileLabel = document.createElement('span');
        fileLabel.className = 'coord file';
        fileLabel.textContent = 'abcdefgh'[f];
        const rankLabel = document.createElement('span');
        rankLabel.className = 'coord rank';
        rankLabel.textContent = 8 - r;

        sq.appendChild(fileLabel);
        sq.appendChild(rankLabel);
        
        sq.addEventListener('click', () => this._handleSquareClick(sq.dataset.sq));
        
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

  getSquareEl(sq) {
    return this.el.querySelector(`.square[data-sq="${sq}"]`);
  }

  clearSelection() {
    this.el.querySelectorAll('.square').forEach(s => s.classList.remove('selected', 'hint'));
    this.selectedSq = null;
  }

  _handleSquareClick(sq) {
    if (!this.interactive || !this.onMove) return;
    
    const chess = new Chess(this.currentFen);
    
    if (this.selectedSq) {
      if (this.selectedSq === sq) {
        this.clearSelection();
        return;
      }
      
      // Пробуем сделать ход
      const move = chess.move({ from: this.selectedSq, to: sq, promotion: 'q' });
      if (move) {
        this.onMove(move);
        this.clearSelection();
      } else {
        // Если ход невозможен, выделяем другую фигуру
        this.clearSelection();
        this._selectSquare(sq, chess);
      }
    } else {
      this._selectSquare(sq, chess);
    }
  }

  _selectSquare(sq, chess) {
    const piece = chess.get(sq);
    if (piece && piece.color === chess.turn()) {
      this.selectedSq = sq;
      this.getSquareEl(sq).classList.add('selected');
      
      // Показываем возможные ходы
      const moves = chess.moves({ square: sq, verbose: true });
      moves.forEach(m => {
        const el = this.getSquareEl(m.to);
        if (el) el.classList.add('hint');
      });
    }
  }

  setPosition(fen, { from = null, to = null, best = null, animate = true } = {}) {
    const isAnimated = animate && this.settings.get('animations');
    const oldRect = (from && isAnimated) ? this.getSquareEl(from)?.getBoundingClientRect() : null;

    this.currentFen = fen;
    const chess = new Chess(fen);
    const board = chess.board();
    
    let index = 0;
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const piece = board[r][f];
        const sq = this.squares[index];
        
        sq.classList.remove('last-move', 'check', 'selected', 'hint');
        const existing = sq.querySelector('.piece');
        if (existing) existing.remove();
        
        if (piece) {
          const p = document.createElement('div');
          p.className = `piece ${piece.color}`;
          p.dataset.sq = sq.dataset.sq;
          p.textContent = PIECES[piece.color === 'w' ? piece.type.toUpperCase() : piece.type];
          sq.appendChild(p);
        }
        index++;
      }
    }

    if (from && to) {
      this.getSquareEl(from)?.classList.add('last-move');
      this.getSquareEl(to)?.classList.add('last-move');
    }

    if (chess.inCheck()) {
      const turn = chess.turn();
      for (let r = 0; r < 8; r++) {
        for (let f = 0; f < 8; f++) {
          const p = board[r][f];
          if (p && p.type === 'k' && p.color === turn) {
            this.getSquareEl('abcdefgh'[f] + (8 - r))?.classList.add('check');
          }
        }
      }
    }

    if (from && to && isAnimated && oldRect) {
      const newEl = this.el.querySelector(`.piece[data-sq="${to}"]`);
      if (newEl) {
        const newRect = this.getSquareEl(to)?.getBoundingClientRect();
        if (newRect) {
          const dx = oldRect.left - newRect.left;
          const dy = oldRect.top - newRect.top;
          
          newEl.style.transition = 'none';
          newEl.style.transform = `translate(${dx}px, ${dy}px)`;
          
          requestAnimationFrame(() => {
            newEl.style.transition = 'transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)';
            newEl.style.transform = 'translate(0, 0)';
          });
        }
      }
    }

    this.drawArrow(best);
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

    const rectBoard = this.el.getBoundingClientRect();
    const cx = rectBoard.width / 2;
    const cy = rectBoard.height / 2;

    let x1 = (sqFrom.offsetLeft + sqFrom.offsetWidth / 2);
    let y1 = (sqFrom.offsetTop + sqFrom.offsetHeight / 2);
    let x2 = (sqTo.offsetLeft + sqTo.offsetWidth / 2);
    let y2 = (sqTo.offsetTop + sqTo.offsetHeight / 2);

    if (this.orientation === 'b') {
      x1 = cx - (x1 - cx); y1 = cy - (y1 - cy);
      x2 = cx - (x2 - cx); y2 = cy - (y2 - cy);
    }

    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    defs.innerHTML = `
      <marker id="arrowhead" markerWidth="4" markerHeight="4" refX="2" refY="2" orient="auto">
        <polygon points="0 0, 4 2, 0 4" fill="rgba(143, 191, 90, 0.8)" />
      </marker>
    `;
    svg.appendChild(defs);

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', x1); line.setAttribute('y1', y1);
    line.setAttribute('x2', x2); line.setAttribute('y2', y2);
    line.setAttribute('stroke', 'rgba(143, 191, 90, 0.8)');
    line.setAttribute('stroke-width', sqFrom.offsetWidth * 0.15);
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
    const best = this.el.dataset.lastBest || null;
    if (best) this.drawArrow(best);
  }
}
