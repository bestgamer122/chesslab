import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1.4.0/dist/esm/chess.js';

const PIECES = {
  p: 'P', n: 'N', b: 'B', r: 'R', q: 'Q', k: 'K'
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
    this.playerColor = 'w';
    
    this.userArrows = [];
    this.premove = null;

    // Для Drag & Drop
    this.pointerDownSquare = null;
    this.draggedSquare = null;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.isDragging = false;
    this.dragGhost = null;

    this.renderGrid();
    this.updateStyles();
    this.bindEvents();
  }

  setInteractive(state) {
    this.interactive = state;
    if (!state) this.clearSelection();
  }

  setPlayerColor(color) {
    this.playerColor = color;
    if (this.orientation !== color) {
      this.orientation = color;
      this.renderGrid(); 
      this.setPosition(this.currentFen, { animate: false });
    }
  }

  renderGrid() {
    this.el.innerHTML = '<svg id="arrowLayer" class="arrow-layer"></svg><svg id="userArrowLayer" class="arrow-layer"></svg>';
    this.squares = [];
    
    const rows = this.orientation === 'w' ? [8,7,6,5,4,3,2,1] : [1,2,3,4,5,6,7,8];
    const cols = this.orientation === 'w' ? ['a','b','c','d','e','f','g','h'] : ['h','g','f','e','d','c','b','a'];

    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const sq = document.createElement('div');
        sq.className = `square ${(r + f) % 2 === 0 ? 'light' : 'dark'}`;
        sq.dataset.sq = cols[f] + rows[r];
        
        const fileLabel = document.createElement('span');
        fileLabel.className = 'coord file';
        fileLabel.textContent = cols[f];
        const rankLabel = document.createElement('span');
        rankLabel.className = 'coord rank';
        rankLabel.textContent = rows[r];

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

  getSquareEl(sq) {
    return this.el.querySelector(`.square[data-sq="${sq}"]`);
  }

  clearSelection() {
    this.el.querySelectorAll('.square').forEach(s => s.classList.remove('selected', 'hint'));
    this.selectedSq = null;
  }

  // ================= DRAG & DROP & CLICKS =================
  bindEvents() {
    this.el.addEventListener('pointerdown', this._onPointerDown.bind(this));
    this.el.addEventListener('pointermove', this._onPointerMove.bind(this));
    this.el.addEventListener('pointerup', this._onPointerUp.bind(this));
    this.el.addEventListener('pointercancel', this._onPointerUp.bind(this));
    
    // Рисование стрелок ПКМ
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
    let startSq = null;
    this.el.addEventListener('mousedown', (e) => {
      if (e.button !== 2) return;
      startSq = e.target.closest('.square')?.dataset.sq;
    });
    this.el.addEventListener('mouseup', (e) => {
      if (e.button !== 2 || !startSq) return;
      const endSq = e.target.closest('.square')?.dataset.sq;
      if (startSq === endSq || !endSq) {
        this.userArrows = [];
      } else {
        const exists = this.userArrows.findIndex(a => a.from === startSq && a.to === endSq);
        if (exists > -1) this.userArrows.splice(exists, 1);
        else this.userArrows.push({ from: startSq, to: endSq, color: '#8fbf5a' });
      }
      this.drawUserArrows();
      startSq = null;
    });
  }

  _onPointerDown(e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return; 
    
    const sqEl = e.target.closest('.square');
    if (!sqEl) return;
    
    this.pointerDownSquare = sqEl.dataset.sq;
    this.dragStartX = e.clientX;
    this.dragStartY = e.clientY;
    this.isDragging = false;

    const chess = new Chess(this.currentFen);
    const piece = chess.get(this.pointerDownSquare);
    const isMyTurn = chess.turn() === this.playerColor;

    if (piece && piece.color === this.playerColor) {
      if (!this.interactive && isMyTurn) return; 
      this.draggedSquare = this.pointerDownSquare;
      this.el.setPointerCapture(e.pointerId);
    }
  }

  _onPointerMove(e) {
    if (!this.draggedSquare) return;

    const dx = e.clientX - this.dragStartX;
    const dy = e.clientY - this.dragStartY;

    if (!this.isDragging && Math.hypot(dx, dy) > 5) {
      this.isDragging = true;
      this._startVisualDrag(this.draggedSquare, e);
    }

    if (this.isDragging) {
      this._updateVisualDrag(e);
    }
  }

  _onPointerUp(e) {
    if (!this.pointerDownSquare) return;

    if (this.isDragging) {
      this._endVisualDrag(e);
    } else {
      // Обычный клик (даже если на пустую клетку)
      const targetEl = document.elementFromPoint(e.clientX, e.clientY)?.closest('.square');
      if (targetEl) {
        this._handleSquareClick(targetEl.dataset.sq);
      }
    }

    this.pointerDownSquare = null;
    this.draggedSquare = null;
    this.isDragging = false;
    if (this.el.hasPointerCapture(e.pointerId)) {
      this.el.releasePointerCapture(e.pointerId);
    }
  }

  _startVisualDrag(sq, e) {
    this.selectedSq = sq;
    const sqEl = this.getSquareEl(sq);
    const pieceEl = sqEl.querySelector('.piece');
    
    if (!pieceEl) return;

    this.dragGhost = pieceEl.cloneNode(true);
    this.dragGhost.className = 'piece drag-ghost';
    this.dragGhost.style.width = sqEl.offsetWidth + 'px';
    this.dragGhost.style.height = sqEl.offsetHeight + 'px';
    
    document.body.appendChild(this.dragGhost);
    pieceEl.style.opacity = '0.3';
    
    const chess = new Chess(this.currentFen);
    const moves = chess.moves({ square: sq, verbose: true });
    moves.forEach(m => this.getSquareEl(m.to)?.classList.add('hint'));
    
    this._updateVisualDrag(e);
  }

  _updateVisualDrag(e) {
    if (!this.dragGhost) return;
    const size = this.dragGhost.offsetWidth;
    this.dragGhost.style.left = (e.clientX - size / 2) + 'px';
    this.dragGhost.style.top = (e.clientY - size / 2) + 'px';
  }

  _endVisualDrag(e) {
    if (this.dragGhost) {
      this.dragGhost.remove();
      this.dragGhost = null;
    }
    
    const sqEl = this.getSquareEl(this.selectedSq);
    if (sqEl) {
       const p = sqEl.querySelector('.piece');
       if (p) p.style.opacity = '1';
    }
    
    const targetEl = document.elementFromPoint(e.clientX, e.clientY)?.closest('.square');
    
    // Вызываем логику хода
    if (targetEl) {
      this._handleSquareClick(targetEl.dataset.sq);
    } else {
      this.clearSelection();
    }
  }

  _handleSquareClick(sq) {
    if (!this.onMove) return;

    const chess = new Chess(this.currentFen);
    const isMyTurn = chess.turn() === this.playerColor;

    // Логика премува
    if (!this.interactive && !isMyTurn) {
      if (this.selectedSq) {
         this.premove = { from: this.selectedSq, to: sq };
         this.onMove({ ...this.premove, isPremove: true });
         this.clearSelection();
         this.setPosition(this.currentFen, { animate: false }); 
      } else {
         const piece = chess.get(sq);
         if (piece && piece.color === this.playerColor) {
            this.selectedSq = sq;
            this.getSquareEl(sq).classList.add('selected');
         }
      }
      return;
    }

    if (!this.interactive) return;

    if (this.selectedSq) {
      if (this.selectedSq === sq) {
        this.clearSelection();
        return;
      }
      
      try {
        const move = chess.move({ from: this.selectedSq, to: sq, promotion: 'q' });
        if (move) {
          this.premove = null;
          this.onMove(move);
          this.clearSelection();
        } else {
          this.clearSelection();
          this._selectSquare(sq, chess);
        }
      } catch (_) {
        this.clearSelection();
        this._selectSquare(sq, chess);
      }
    } else {
      this._selectSquare(sq, chess);
    }
  }

  _selectSquare(sq, chess) {
    const piece = chess.get(sq);
    if (piece && piece.color === this.playerColor) {
      this.selectedSq = sq;
      this.getSquareEl(sq).classList.add('selected');
      
      const moves = chess.moves({ square: sq, verbose: true });
      moves.forEach(m => {
        const el = this.getSquareEl(m.to);
        if (el) el.classList.add('hint');
      });
    }
  }

  // ================= ОТРИСОВКА =================
  setPosition(fen, { from = null, to = null, best = null, animate = true } = {}) {
    const isAnimated = animate && this.settings.get('animations');
    const oldRect = (from && isAnimated) ? this.getSquareEl(from)?.getBoundingClientRect() : null;

    this.currentFen = fen;
    const chess = new Chess(fen);
    
    this.squares.forEach(sq => {
      sq.classList.remove('last-move', 'check', 'premove');
      const existing = sq.querySelector('.piece');
      if (existing) existing.remove();
    });

    const board = chess.board();
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const piece = board[r][f];
        if (!piece) continue;
        
        const sqName = 'abcdefgh'[f] + (8 - r);
        const sq = this.getSquareEl(sqName);
        if (!sq) continue;

        const p = document.createElement('div');
        p.className = `piece ${piece.color}`;
        p.dataset.sq = sqName;
        
        const pName = piece.color + PIECES[piece.type];
        p.innerHTML = `<img src="https://lichess1.org/assets/piece/cburnett/${pName}.svg" draggable="false" alt="${pName}">`;
        
        sq.appendChild(p);
      }
    }

    if (from && to) {
      this.getSquareEl(from)?.classList.add('last-move');
      this.getSquareEl(to)?.classList.add('last-move');
    }

    if (this.premove) {
      this.getSquareEl(this.premove.from)?.classList.add('premove');
      this.getSquareEl(this.premove.to)?.classList.add('premove');
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
    this.drawUserArrows();
  }

  drawUserArrows() {
    const svg = this.el.querySelector('#userArrowLayer');
    svg.innerHTML = '';

    this.userArrows.forEach(arrow => {
      const sqFrom = this.getSquareEl(arrow.from);
      const sqTo = this.getSquareEl(arrow.to);
      if (!sqFrom || !sqTo) return;

      const x1 = sqFrom.offsetLeft + sqFrom.offsetWidth / 2;
      const y1 = sqFrom.offsetTop + sqFrom.offsetHeight / 2;
      const x2 = sqTo.offsetLeft + sqTo.offsetWidth / 2;
      const y2 = sqTo.offsetTop + sqTo.offsetHeight / 2;

      const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      defs.innerHTML = `
        <marker id="userArrowhead" markerWidth="4" markerHeight="4" refX="2" refY="2" orient="auto">
          <polygon points="0 0, 4 2, 0 4" fill="${arrow.color}" opacity="0.7"/>
        </marker>
      `;
      svg.appendChild(defs);

      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', x1); line.setAttribute('y1', y1);
      line.setAttribute('x2', x2); line.setAttribute('y2', y2);
      line.setAttribute('stroke', arrow.color);
      line.setAttribute('stroke-width', sqFrom.offsetWidth * 0.15);
      line.setAttribute('marker-end', 'url(#userArrowhead)');
      line.setAttribute('stroke-linecap', 'round');
      line.setAttribute('opacity', '0.7');
      svg.appendChild(line);
    });
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

    const x1 = (sqFrom.offsetLeft + sqFrom.offsetWidth / 2);
    const y1 = (sqFrom.offsetTop + sqFrom.offsetHeight / 2);
    const x2 = (sqTo.offsetLeft + sqTo.offsetWidth / 2);
    const y2 = (sqTo.offsetTop + sqTo.offsetHeight / 2);

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
    this.renderGrid();
    this.setPosition(this.currentFen, { animate: false });
  }
}
