import { CONFIG } from './config.js';

export class Engine {
  constructor() {
    this.worker = null;
    this.ready = false;
    this.initPromise = null;
    this.current = null;
    this.queue = Promise.resolve();
    this.onStatus = null;
    this._init = null;
    this._blobUrl = null;
  }

  async init(onStatus = () => {}) {
    if (this.ready) return onStatus('ready');
    if (this.initPromise) return this.initPromise;

    this.onStatus = onStatus;
    onStatus('loading');

    this.initPromise = new Promise(async (resolve, reject) => {
      this._init = { resolve, reject, settled: false };

      // Пытаемся скачать движок с разных CDN
      let engineCode = null;
      for (const url of CONFIG.ENGINE_URLS) {
        try {
          const res = await fetch(url);
          if (res.ok) {
            engineCode = await res.text();
            break;
          }
        } catch (_) { /* пробуем следующий */ }
      }

      if (!engineCode) {
        return this._failInit(new Error('Не удалось скачать движок ни с одного сервера.'));
      }

      // Запускаем из памяти (Blob) — 100% защита от CORS
      const shimCode = `
        const engineCode = ${JSON.stringify(engineCode)};
        const blob = new Blob([engineCode], {type: 'application/javascript'});
        importScripts(URL.createObjectURL(blob));
      `;
      try {
        this._blobUrl = URL.createObjectURL(new Blob([shimCode], { type: 'application/javascript' }));
        this.worker = new Worker(this._blobUrl);
      } catch (err) {
        return this._failInit(new Error('Ошибка Web Worker: ' + err.message));
      }

      this.worker.onerror = (e) => this._failInit(new Error('Ошибка движка: ' + e.message));
      this.worker.onmessage = (e) => this._handleLine(String(e.data || ''));

      // Таймаут инициализации
      setTimeout(() => {
        if (!this.ready) this._failInit(new Error('Движок не ответил. Возможно, заблокирован провайдером.'));
      }, 60000);

      this._send('uci');
    });

    return this.initPromise;
  }

  _failInit(error) {
    if (!this._init || this._init.settled) return;
    this._init.settled = true;
    this.ready = false;
    this.initPromise = null;
    try { this.worker && this.worker.terminate(); } catch (_) {}
    this.worker = null;
    if (this.onStatus) this.onStatus('error');
    this._init.reject(error);
  }

  _handleLine(line) {
    if (line === 'uciok') {
      this._send('setoption name Threads value 1');
      this._send('setoption name Hash value 32');
      this._send('setoption name MultiPV value 1');
      this._send('isready');
      return;
    }

    if (line === 'readyok') {
      if (!this.ready) {
        this.ready = true;
        if (this._init) {
          this._init.settled = true;
          this._init.resolve();
          this._init = null;
        }
        if (this.onStatus) this.onStatus('ready');
      }
      return;
    }

    if (line.startsWith('bestmove')) {
      const current = this.current;
      if (!current) return;
      this.current = null;
      if (current.cancelled) return current.reject(new Error('AbortError'));

      const parts = line.split(/\s+/);
      const best = parts[1];
      current.resolve({
        cp: current.info.cp,
        mate: current.info.mate,
        depth: current.info.depth,
        pv: current.info.pv,
        bestMove: best && best !== '(none)' ? best : null,
      });
      return;
    }

    if (!this.current || !line.startsWith('info')) return;
    const info = this.current.info;
    
    const depthM = line.match(/\bdepth\s+(\d+)/);
    if (depthM) info.depth = parseInt(depthM[1], 10);

    const scoreM = line.match(/\bscore\s+(cp|mate)\s+(-?\d+)/);
    if (scoreM) {
      if (scoreM[1] === 'cp') { info.cp = parseInt(scoreM[2], 10); info.mate = null; }
      else { info.mate = parseInt(scoreM[2], 10); info.cp = null; }
    }

    const pvM = line.match(/\bpv\s+(.+)$/);
    if (pvM) info.pv = pvM[1].trim().split(/\s+/).slice(0, 12);
  }

  _send(cmd) { if (this.worker) this.worker.postMessage(cmd); }

  evaluate(fen, { depth = CONFIG.ENGINE_DEFAULT_DEPTH } = {}) {
    const run = () => new Promise((resolve, reject) => {
      if (!this.ready) return reject(new Error('Движок не готов'));
      
      const info = { cp: null, mate: null, depth: 0, pv: [] };
      this.current = { info, resolve, reject, cancelled: false };

      this._send('position fen ' + fen);
      this._send('go depth ' + depth);
    });
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  stop() {
    if (!this.current) return;
    const c = this.current;
    c.cancelled = true;
    this._send('stop');
    setTimeout(() => {
      if (this.current === c) {
        this.current = null;
        c.reject(new Error('AbortError'));
      }
    }, 1000);
  }
}
