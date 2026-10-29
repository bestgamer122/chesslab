import { CONFIG } from './config.js';

/**
 * Обёртка над UCI-движком Stockfish.
 * Использует локальный worker.js и перебирает зеркала CDN в случае блокировки.
 */
export class Engine {
  constructor() {
    this.worker = null;
    this.ready = false;
    this.initPromise = null;
    this.current = null;
    this.queue = Promise.resolve();
    this.onStatus = null;
    this._init = null;
    this._initTimer = null;
    this._cdnIndex = 0;
  }

  async init(onStatus = () => {}) {
    if (this.ready) return onStatus('ready');
    if (this.initPromise) return this.initPromise;

    this.onStatus = onStatus;
    onStatus('loading');

    this.initPromise = new Promise((resolve, reject) => {
      this._init = { resolve, reject, settled: false };
      this._tryLoadEngine();
    });

    return this.initPromise;
  }

  _tryLoadEngine() {
    if (this._init?.settled) return;
    
    // Если все зеркала перебраны и не сработали
    if (this._cdnIndex >= CONFIG.ENGINE_URLS.length) {
      return this._failInit(new Error('Движок заблокирован провайдером на всех доступных серверах.'));
    }

    const url = CONFIG.ENGINE_URLS[this._cdnIndex];
    try { this.worker && this.worker.terminate(); } catch (_) {}
    try { clearTimeout(this._initTimer); } catch (_) {}

    try {
      this.worker = new Worker('js/engine/worker.js?url=' + encodeURIComponent(url));
    } catch (e) {
      this._cdnIndex++;
      return this._tryLoadEngine();
    }

    // Если воркер выдал ошибку сети или 404
    this.worker.onerror = () => {
      this._cdnIndex++;
      this._tryLoadEngine();
    };

    this.worker.onmessage = (e) => {
      const line = String(e.data || '');
      if (line.startsWith('__ERROR__')) {
        this._cdnIndex++;
        return this._tryLoadEngine(); // Пробуем следующий CDN
      }
      this._handleLine(line);
    };

    // Если за 8 секунд сервер не ответил, переключаемся на резервный
    this._initTimer = setTimeout(() => {
      this._cdnIndex++;
      this._tryLoadEngine();
    }, 8000);

    this._send('uci');
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
    this._init = null;
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
        clearTimeout(this._initTimer);
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
