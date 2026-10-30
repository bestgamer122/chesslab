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

    this.initPromise = new Promise(async (resolve, reject) => {
      let isSettled = false;
      const timeout = setTimeout(() => {
        if (!isSettled) {
          isSettled = true;
          this.initPromise = null;
          this.ready = false;
          if (this.worker) this.worker.terminate();
          reject(new Error('Таймаут загрузки движка (15 сек)'));
        }
      }, 15000);

      try {
        const jsUrl = 'https://cdn.jsdelivr.net/npm/stockfish@16.0.0/src/stockfish-nnue-16-single.js';
        const wasmUrl = 'https://cdn.jsdelivr.net/npm/stockfish@16.0.0/src/stockfish-nnue-16-single.wasm';

        const [wasmRes, jsRes] = await Promise.all([fetch(wasmUrl), fetch(jsUrl)]);
        if (!wasmRes.ok || !jsRes.ok) throw new Error('Ошибка скачивания с CDN');

        const wasmBlob = await wasmRes.blob();
        const wasmBlobUrl = URL.createObjectURL(wasmBlob);
        const jsCode = await jsRes.text();

        const workerCode = `
          const originalFetch = self.fetch;
          self.fetch = function(url, options) {
            if (typeof url === 'string' && url.includes('.wasm')) {
              return originalFetch('${wasmBlobUrl}', options);
            }
            return originalFetch(url, options);
          };
          try {
            ${jsCode}
          } catch (e) {
            postMessage('__ERROR__ ' + e.message);
          }
        `;
        
        const blob = new Blob([workerCode], { type: 'application/javascript' });
        this.worker = new Worker(URL.createObjectURL(blob));
      } catch (err) {
        if (!isSettled) {
          isSettled = true;
          clearTimeout(timeout);
          this.initPromise = null;
          reject(new Error('Ошибка сети: ' + err.message));
        }
        return;
      }

      this.worker.onerror = (e) => {
        if (!isSettled) {
          isSettled = true;
          clearTimeout(timeout);
          this.initPromise = null;
          reject(new Error('Worker error: ' + e.message));
        }
      };

      this.worker.onmessage = (e) => {
        const line = String(e.data || '');
        if (line.startsWith('__ERROR__')) {
          if (!isSettled) {
            isSettled = true;
            clearTimeout(timeout);
            this.initPromise = null;
            reject(new Error(line));
          }
          return;
        }
        
        if (line === 'uciok') {
          const threads = Math.min(navigator.hardwareConcurrency || 2, 4);
          this.worker.postMessage('setoption name Threads value ' + threads);
          this.worker.postMessage('setoption name Hash value 128');
          this.worker.postMessage('setoption name UCI_LimitStrength value true');
          this.worker.postMessage('setoption name UCI_Elo value 1200');
          this.worker.postMessage('isready');
          return;
        }

        if (line === 'readyok') {
          if (!this.ready && !isSettled) {
            isSettled = true;
            clearTimeout(timeout);
            this.ready = true;
            if (this.onStatus) this.onStatus('ready');
            resolve();
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
      };

      this.worker.postMessage('uci');
    });

    return this.initPromise;
  }

  setElo(elo) {
    if (this.worker) {
      this.worker.postMessage('setoption name UCI_Elo value ' + elo);
    }
  }

  evaluate(fen, { depth = 18 } = {}) {
    const run = () => new Promise((resolve, reject) => {
      if (!this.ready) return reject(new Error('Движок не готов'));
      
      const info = { cp: null, mate: null, depth: 0, pv: [] };
      let isResolved = false;
      
      const timeout = setTimeout(() => {
        if (!isResolved) {
          this.worker.postMessage('stop');
          this.current = null;
          reject(new Error('Превышено время анализа позиции'));
        }
      }, 15000);

      this.current = {
        info,
        resolve: (val) => { isResolved = true; clearTimeout(timeout); resolve(val); },
        reject: (err) => { isResolved = true; clearTimeout(timeout); reject(err); }
      };

      this.worker.postMessage('position fen ' + fen);
      this.worker.postMessage('go depth ' + depth);
    });

    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  stop() {
    if (this.current) {
      this.current.reject(new Error('AbortError'));
      this.current = null;
    }
    this.queue = Promise.resolve();
    if (this.worker) this.worker.postMessage('stop');
  }
}
