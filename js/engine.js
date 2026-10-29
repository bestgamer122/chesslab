export class Engine {
  constructor() {
    this.worker = null;
    this.ready = false;
    this.initPromise = null;
    this.current = null;
    this.queue = Promise.resolve();
    this.onStatus = null;
    this._resolve = null;
  }

  async init(onStatus = () => {}) {
    if (this.ready) return onStatus('ready');
    if (this.initPromise) return this.initPromise;

    this.onStatus = onStatus;
    onStatus('loading');

    this.initPromise = new Promise(async (resolve, reject) => {
      this._resolve = resolve;
      
      try {
        // Скачиваем wasm с CDN, так как гитхаб не позволяет >25мб
        const wasmCdn = 'https://cdn.jsdelivr.net/gh/nmrugg/stockfish.js@v16.0.0/stockfish-16-single.wasm';
        const res = await fetch(wasmCdn);
        if (!res.ok) throw new Error('Не удалось скачать WASM с CDN: ' + res.status);
        
        const wasmBlob = await res.blob();
        const wasmBlobUrl = URL.createObjectURL(wasmBlob);

        const workerCode = `
          const originalFetch = self.fetch;
          self.fetch = function(url, options) {
            if (typeof url === 'string' && url.includes('.wasm')) {
              return originalFetch('${wasmBlobUrl}', options);
            }
            return originalFetch(url, options);
          };
          try {
            importScripts('js/stockfish-19-single.js');
          } catch (e) {
            postMessage('__ERROR__ ' + e.message);
          }
        `;
        
        const blob = new Blob([workerCode], { type: 'application/javascript' });
        this.worker = new Worker(URL.createObjectURL(blob));
      } catch (err) {
        return reject(new Error('Ошибка инициализации: ' + err.message));
      }

      this.worker.onerror = (e) => reject(new Error('Ошибка воркера: ' + e.message));
      this.worker.onmessage = (e) => {
        const line = String(e.data || '');
        if (line.startsWith('__ERROR__')) return reject(new Error(line));
        this._handleLine(line);
      };

      this.worker.postMessage('uci');
    });

    return this.initPromise;
  }

  _handleLine(line) {
    if (line === 'uciok') {
      this.worker.postMessage('setoption name Threads value 1');
      this.worker.postMessage('setoption name Hash value 64');
      this.worker.postMessage('isready');
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

  evaluate(fen, { depth = 12 } = {}) {
    const run = () => new Promise((resolve, reject) => {
      if (!this.ready) return reject(new Error('Движок не готов'));
      const info = { cp: null, mate: null, depth: 0, pv: [] };
      this.current = { info, resolve, reject };
      this.worker.postMessage('position fen ' + fen);
      this.worker.postMessage('go depth ' + depth);
    });
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  stop() {
    if (!this.current) return;
    this.current = null;
    this.worker.postMessage('stop');
  }
}
