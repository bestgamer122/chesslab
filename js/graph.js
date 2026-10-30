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

  setData(points, cur = 0) { 
    this.points = points || []; 
    this.current = cur; 
    this.hoverIndex = null; 
    this.canvas.width = 1; 
    this.canvas.width = Math.max(300, this.canvas.clientWidth) * (window.devicePixelRatio || 1);
    this._draw(); 
  }
  
  setCurrent(idx) { this.current = idx; this._draw(); }

  _getIdx(x) {
    const pad = 10, w = Math.max(300, this.canvas.clientWidth) - pad * 2;
    const ratio = Math.max(0, Math.min(1, (x - pad) / w));
    return Math.round(ratio * Math.max(1, this.points.length - 1));
  }

  _draw() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(300, this.canvas.clientWidth); 
    const h = this.canvas.clientHeight || 150;
    
    if (this.canvas.width !== w * dpr) {
      this.canvas.width = w * dpr; 
      this.canvas.height = h * dpr;
    }

    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const padX = 8, padY = 8;
    const plotW = w - padX * 2, plotH = h - padY * 2;
    const midY = padY + plotH / 2;

    // Сетка
    ctx.strokeStyle = 'rgba(255,255,255,0.03)'; 
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padX, midY); ctx.lineTo(w - padX, midY);
    ctx.moveTo(padX, padY + plotH * 0.25); ctx.lineTo(w - padX, padY + plotH * 0.25);
    ctx.moveTo(padX, padY + plotH * 0.75); ctx.lineTo(w - padX, padY + plotH * 0.75);
    ctx.stroke();

    if (!this.points.length) return;

    const getX = i => padX + (i / Math.max(1, this.points.length - 1)) * plotW;
    const getY = cp => {
      const c = Math.max(-CONFIG.EVAL_CLAMP * 100, Math.min(CONFIG.EVAL_CLAMP * 100, cp || 0));
      return padY + plotH * (1 - (c + CONFIG.EVAL_CLAMP * 100) / (CONFIG.EVAL_CLAMP * 200));
    };

    // Красивый плавный градиент без красного уебизма
    const grad = ctx.createLinearGradient(0, padY, 0, padY + plotH);
    grad.addColorStop(0, 'rgba(143, 191, 90, 0.15)');
    grad.addColorStop(1, 'rgba(143, 191, 90, 0)');

    ctx.beginPath();
    ctx.moveTo(getX(0), padY + plotH);
    
    for (let i = 1; i < this.points.length; i++) {
      const x0 = getX(i - 1), y0 = getY(this.points[i - 1].cp);
      const x1 = getX(i), y1 = getY(this.points[i].cp);
      const cpX = (x0 + x1) / 2;
      ctx.bezierCurveTo(cpX, y0, cpX, y1, x1, y1);
    }
    
    ctx.lineTo(getX(this.points.length - 1), padY + plotH);
    ctx.fillStyle = grad; 
    ctx.fill();

    // Сама линия
    ctx.beginPath();
    ctx.strokeStyle = '#a6d46e'; 
    ctx.lineWidth = 2; 
    ctx.lineJoin = 'round';
    
    ctx.moveTo(getX(0), getY(this.points[0].cp));
    for (let i = 1; i < this.points.length; i++) {
      const x0 = getX(i - 1), y0 = getY(this.points[i - 1].cp);
      const x1 = getX(i), y1 = getY(this.points[i].cp);
      const cpX = (x0 + x1) / 2;
      ctx.bezierCurveTo(cpX, y0, cpX, y1, x1, y1);
    }
    ctx.stroke();

    // Текущий ход (Светящаяся точка)
    const cx = getX(this.current), cy = getY(this.points[this.current]?.cp);
    ctx.beginPath(); 
    ctx.arc(cx, cy, 4, 0, Math.PI * 2); 
    ctx.fillStyle = '#fff'; 
    ctx.fill();
    ctx.shadowColor = '#a6d46e';
    ctx.shadowBlur = 10;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Ховер
    if (this.hoverIndex !== null) {
      const hx = getX(this.hoverIndex);
      ctx.beginPath(); 
      ctx.strokeStyle = 'rgba(255,255,255,0.15)'; 
      ctx.lineWidth = 1;
      ctx.moveTo(hx, padY); 
      ctx.lineTo(hx, padY + plotH); 
      ctx.stroke();
    }
  }
}
