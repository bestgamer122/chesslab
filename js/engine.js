/**
 * Обертка для локального движка (js/stockfish.js).
 */
export class Engine {
  constructor() {
    this.worker = null;
    this.ready = false;
    this.initPromise = null;
    this.current = null;
    this.queue = Promise.resolve();
    this.onStatus = null;
  }

  async init(onStatus = () => {}) {
    if (this.ready) return onStatus('ready');
    if (this.initPromise) return this.initPromise;

    this.onStatus = onStatus;
    onStatus('loading');

    this.initPromise = new Promise((resolve, reject) => {
      try {
        this.worker = new Worker('js/stockfish.js');
      } catch (err) {
        return reject(new Error('Не удалось запустить движок: ' + err.message));
      }

      this.worker.onerror = (e) => {
        reject(new Error('Ошибка движка: ' + e.message));
      };

      this.worker.onmessage = (e) => {
        const line = String(e.data || '');
        this._handleLine(line);
      };

      this._send('uci');
    });

    return this.initPromise;
  }

  _handleLine(line) {
    if (line === 'uciok') {
      this._send('isready');
      return;
    }

    if (line === 'readyok') {
      if (!this.ready) {
        this.ready = true;
        this.initPromise = null;
        if (this.onStatus) this.onStatus('ready');
        if (this._resolve) {
          this._resolve();
          this._resolve = null;
        }
      }
      return;
    }

    if (line.startsWith('bestmove')) {
      const current = this.current;
      if (!current) return;
      this.current = null;
      
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

  evaluate(fen, { depth = 12 } = {}) {
    const run = () => new Promise((resolve, reject) => {
      if (!this.ready) return reject(new Error('Движок не готов'));
      const info = { cp: null, mate: null, depth: 0, pv: [] };
      this.current = { info, resolve, reject };
      
      this._send('position fen ' + fen);
      this._send('go depth ' + depth);
    });
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  stop() {
    if (!this.current) return;
    this.current = null;
    this._send('stop');
  }
}
