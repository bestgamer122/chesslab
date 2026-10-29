import { CONFIG } from './config.js';

const PAD = { top: 12, right: 8, bottom: 20, left: 30 };

/** Интерактивный график преимущества: клик/наведение → переход к ходу. */
export class EvalGraph {
  constructor(canvas, onSeek) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onSeek = onSeek;
    this.points = [];
    this.current = 0;
    this.hoverIndex = null;
    this.width = 0;
    this.height = 0;

    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerLeave = this._onPointerLeave.bind(this);
    this._onClick = this._onClick.bind(this);
    this._draw = this._draw.bind(this);

    canvas.addEventListener('pointermove', this._onPointerMove);
    canvas.addEventListener('pointerleave', this._onPointerLeave);
    canvas.addEventListener('click', this._onClick);

    if ('ResizeObserver' in window) {
      this.resizeObserver = new ResizeObserver(() => this._draw());
      this.resizeObserver.observe(canvas);
    } else {
      window.addEventListener('resize', this._draw);
    }

    this._draw();
  }

  setData(points, current = 0) {
    this.points = Array.isArray(points) ? points : [];
    this.current = current;
    this.hoverIndex = null;
    this._draw();
  }

  setCurrent(index) {
    this.current = index;
    this._draw();
  }

  _size() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height || 170);
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.width = width;
    this.height = height;
  }

  _x(index) {
    const plotWidth = this.width - PAD.left - PAD.right;
    const count = Math.max(1, this.points.length - 1);
    return PAD.left + (index / count) * plotWidth;
  }

  _y(cp) {
    const plotHeight = this.height - PAD.top - PAD.bottom;
    const clamped = Math.max(-CONFIG.EVAL_CLAMP * 100, Math.min(CONFIG.EVAL_CLAMP * 100, cp || 0));
    const ratio = (clamped + CONFIG.EVAL_CLAMP * 100) / (CONFIG.EVAL_CLAMP * 200);
    return PAD.top + (1 - ratio) * plotHeight;
  }

  _indexFromX(x) {
    const plotWidth = this.width - PAD.left - PAD.right;
    const count = Math.max(1, this.points.length - 1);
    const ratio = (x - PAD.left) / plotWidth;
    return Math.max(0, Math.min(count, Math.round(ratio * count)));
  }

  _draw() {
    this._size();
    const ctx = this.ctx;
    const { width, height } = this;
    ctx.clearRect(0, 0, width, height);

    const mid = this._y(0);

    // фон
    ctx.fillStyle = 'rgba(255,255,255,0.015)';
    ctx.fillRect(PAD.left, PAD.top, width - PAD.left - PAD.right, height - PAD.top - PAD.bottom);

    if (!this.points.length) {
      ctx.fillStyle = '#8b97a8';
      ctx.font = '12px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('График оценки появится после анализа', width / 2, height / 2);
      return;
    }

    const plotBottom = height - PAD.bottom;
    const plotTop = PAD.top;

    // заливка
    const gradient = ctx.createLinearGradient(0, plotTop, 0, plotBottom);
    gradient.addColorStop(0, 'rgba(143, 191, 90, 0.28)');
    gradient.addColorStop(0.5, 'rgba(143, 191, 90, 0.04)');
    gradient.addColorStop(0.5, 'rgba(239, 107, 107, 0.04)');
    gradient.addColorStop(1, 'rgba(239, 107, 107, 0.24)');

    ctx.beginPath();
    ctx.moveTo(this._x(0), plotBottom);
    for (let i = 0; i < this.points.length; i++) {
      ctx.lineTo(this._x(i), this._y(this.points[i].cp));
    }
    ctx.lineTo(this._x(this.points.length - 1), plotBottom);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    // средняя линия
    ctx.beginPath();
    ctx.setLineDash([4, 5]);
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.moveTo(PAD.left, mid);
    ctx.lineTo(width - PAD.right, mid);
    ctx.stroke();
    ctx.setLineDash([]);

    // линия оценки
    ctx.beginPath();
    ctx.strokeStyle = '#d7e2ee';
    ctx.lineWidth = 1.6;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (let i = 0; i < this.points.length; i++) {
      const x = this._x(i);
      const y = this._y(this.points[i].cp);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // текущий ход
    if (this.current >= 0 && this.current < this.points.length) {
      const x = this._x(this.current);
      const y = this._y(this.points[this.current].cp);
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(255,255,255,0.28)';
      ctx.lineWidth = 1;
      ctx.moveTo(x, PAD.top);
      ctx.lineTo(x, plotBottom);
      ctx.stroke();

      ctx.beginPath();
      ctx.fillStyle = '#a6d46e';
      ctx.arc(x, y, 3.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(11,13,16,0.9)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    // подписи осей
    ctx.fillStyle = '#66717f';
    ctx.font = '9.5px Inter, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText('+6', PAD.left - 5, PAD.top + 2);
    ctx.fillText('0', PAD.left - 5, mid);
    ctx.fillText('−6', PAD.left - 5, plotBottom - 2);

    // номера ходов
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const step = Math.max(2, Math.ceil(this.points.length / 12));
    for (let i = 0; i < this.points.length; i += step) {
      const moveNumber = Math.ceil(i / 2);
      ctx.fillText(String(moveNumber), this._x(i), plotBottom + 5);
    }

    // подсказка при наведении
    if (this.hoverIndex !== null && this.hoverIndex < this.points.length) {
      const index = this.hoverIndex;
      const x = this._x(index);
      const point = this.points[index];
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1;
      ctx.moveTo(x, PAD.top);
      ctx.lineTo(x, plotBottom);
      ctx.stroke();

      const label = formatGraphEval(point);
      ctx.font = '10px Inter, sans-serif';
      const textWidth = ctx.measureText(label).width;
      const bx = Math.min(width - textWidth - 16, Math.max(PAD.left, x - textWidth / 2 - 6));
      ctx.fillStyle = 'rgba(20,24,30,0.95)';
      ctx.strokeStyle = 'rgba(255,255,255,0.14)';
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(bx, PAD.top + 2, textWidth + 12, 18, 5) : ctx.rect(bx, PAD.top + 2, textWidth + 12, 18);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#e9edf3';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, bx + (textWidth + 12) / 2, PAD.top + 11);
    }
  }

  _onPointerMove(event) {
    if (!this.points.length) return;
    const rect = this.canvas.getBoundingClientRect();
    this.hoverIndex = this._indexFromX(event.clientX - rect.left);
    this._draw();
  }

  _onPointerLeave() {
    this.hoverIndex = null;
    this._draw();
  }

  _onClick(event) {
    if (!this.points.length || !this.onSeek) return;
    const rect = this.canvas.getBoundingClientRect();
    this.onSeek(this._indexFromX(event.clientX - rect.left));
  }

  destroy() {
    this.canvas.removeEventListener('pointermove', this._onPointerMove);
    this.canvas.removeEventListener('pointerleave', this._onPointerLeave);
    this.canvas.removeEventListener('click', this._onClick);
    if (this.resizeObserver) this.resizeObserver.disconnect();
  }
}

function formatGraphEval(point) {
  if (point.mate !== null && point.mate !== undefined) {
    const mate = Math.abs(point.mate);
    return (point.mate > 0 ? '+M' : '−M') + Math.ceil(mate);
  }
  if (Math.abs(point.cp) >= 10000) return point.cp > 0 ? '+#' : '−#';
  const value = point.cp / 100;
  return (value > 0 ? '+' : value < 0 ? '−' : '') + Math.abs(value).toFixed(2);
}
