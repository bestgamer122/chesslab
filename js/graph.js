import { CONFIG } from './config.js';

export class EvalGraph {
  constructor(canvas, onSeek) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.onSeek = onSeek; this.points = []; this.current = 0; this.hoverIndex = null;
    
    canvas.addEventListener('pointermove', e => {
      if (!this.points.length) return;
      const r = canvas.getBoundingClientRect();
      this.hoverIndex = this._getIdx(e.clientX - r.left);
      this._draw();
    });
    canvas.addEventListener('pointerleave', () => { this.hoverIndex = null; this._draw(); });
    canvas.addEventListener('click', e => {
      if (!this.points.length || !this.onSeek) return;
      const r = canvas.getBoundingClientRect();
      this.onSeek(this._getIdx(e.clientX - r.left));
    });
    new ResizeObserver(() => this._draw()).observe(canvas);
    this._draw();
  }

  setData(points, cur = 0) { this.points = points || []; this.current = cur; this.hoverIndex = null; this._draw(); }
  setCurrent(idx) { this.current = idx; this._draw(); }

  _getIdx(x) {
    const pad = 10, w = this.canvas.clientWidth - pad * 2;
    const ratio = Math.max(0, Math.min(1, (x - pad) / w));
    return Math.round(ratio * Math.max(1, this.points.length - 1));
  }

  _draw() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth, h = 170;
    this.canvas.width = w * dpr; this.canvas.height = h * dpr;
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const padX = 10, padY = 10;
    const plotW = w - padX * 2, plotH = h - padY * 2;
    const midY = padY + plotH / 2;

    // Фон
    ctx.fillStyle = 'rgba(255,255,255,0.02)';
    ctx.fillRect(padX, padY, plotW, plotH);

    if (!this.points.length) return;

    const getX = i => padX + (i / Math.max(1, this.points.length - 1)) * plotW;
    const getY = cp => {
      const c = Math.max(-CONFIG.EVAL_CLAMP * 100, Math.min(CONFIG.EVAL_CLAMP * 100, cp || 0));
      return padY + plotH * (1 - (c + CONFIG.EVAL_CLAMP * 100) / (CONFIG.EVAL_CLAMP * 200));
    };

    // Градиент
    const grad = ctx.createLinearGradient(0, padY, 0, padY + plotH);
    grad.addColorStop(0, 'rgba(143, 191, 90, 0.3)');
    grad.addColorStop(0.5, 'rgba(143, 191, 90, 0)');
    grad.addColorStop(1, 'rgba(239, 107, 107, 0.3)');

    ctx.beginPath();
    ctx.moveTo(getX(0), padY + plotH);
    for (let i = 0; i < this.points.length; i++) ctx.lineTo(getX(i), getY(this.points[i].cp));
    ctx.lineTo(getX(this.points.length - 1), padY + plotH);
    ctx.fillStyle = grad; ctx.fill();

    // Линия
    ctx.beginPath();
    ctx.strokeStyle = '#d7e2ee'; ctx.lineWidth = 2; ctx.lineJoin = 'round';
    for (let i = 0; i < this.points.length; i++) {
      if (i === 0) ctx.moveTo(getX(i), getY(this.points[i].cp));
      else ctx.lineTo(getX(i), getY(this.points[i].cp));
    }
    ctx.stroke();

    // Текущая позиция
    const cx = getX(this.current), cy = getY(this.points[this.current]?.cp);
    ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.fillStyle = '#a6d46e'; ctx.fill();

    // Ховер
    if (this.hoverIndex !== null) {
      const hx = getX(this.hoverIndex);
      ctx.beginPath(); ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1;
      ctx.moveTo(hx, padY); ctx.lineTo(hx, padY + plotH); ctx.stroke();
    }
  }
}
