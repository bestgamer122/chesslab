import { CONFIG } from './config.js';

/**
 * Обёртка над UCI-движком Stockfish.
 * Загружает движок через fetch и создает Blob Worker.
 * Это 100% исключает ошибки с CORS, MIME-типами и путями.
 */
export class Engine {
  constructor() {
    this.worker = null;
    this.ready = false;
    this.initPromise = null;
    this.current = null;
    this.queue = Promise.resolve();
    this.onStatus = null;
    this.lastError = null;
    this._init = null;
    this._initTimer = null;
    this._blobUrl = null;
  }

  async init(onStatus = () => {}) {
    if (this.ready) {
      onStatus('ready');
      return;
    }
    if (this.initPromise) return this.initPromise;

    this.onStatus = onStatus;
    onStatus('loading');
    this.lastError = null;

    this.initPromise = new Promise(async (resolve, reject) => {
      this._init = { resolve, reject, settled: false };

      this._initTimer = setTimeout(() => {
        this._failInit(new Error('Движок не ответил за 60 секунд. Проверьте интернет.'));
      }, 60000); // Увеличили таймаут до 60 сек для медленного интернета

      try {
        // Создаем код шима прямо в памяти, чтобы не зависеть от файла sf-shim.js
        const shimCode = `
          const engineUrl = '${CONFIG.ENGINE_CDN}';
          try {
            importScripts(engineUrl);
          } catch (error) {
            postMessage('__ENGINE_LOAD_ERROR__ ' + (error && error.message ? error.message : String(error)));
          }
        `;
        const blob = new Blob([shimCode], { type: 'application/javascript' });
        this._blobUrl = URL.createObjectURL(blob);
        this.worker = new Worker(this._blobUrl);
      } catch (error) {
        this._failInit(new Error('Ошибка инициализации движка: ' + error.message));
        return;
      }

      this.worker.onerror = (event) => {
        const message = event && event.message ? event.message : 'не удалось загрузить движок';
        this._failInit(new Error('Ошибка загрузки движка: ' + message));
      };

      this.worker.onmessage = (event) => {
        const data = event.data;
        const line = typeof data === 'string' ? data : String(data == null ? '' : data);
        this._handleLine(line);
      };

      this._send('uci');
    });

    return this.initPromise;
  }

  _failInit(error) {
    if (!this._init || this._init.settled) return;
    this._init.settled = true;
    clearTimeout(this._initTimer);
    this.lastError = error;
    this.ready = false;
    this.initPromise = null;
    try { this.worker && this.worker.terminate(); } catch (_) { /* ignore */ }
    this.worker = null;
    if (this.onStatus) this.onStatus('error');
    const reject = this._init.reject;
    this._init = null;
    reject(error);
  }

  _handleLine(line) {
    if (line.startsWith('__ENGINE_LOAD_ERROR__')) {
      this._failInit(new Error('Не удалось загрузить Stockfish. ' + line.replace('__ENGINE_LOAD_ERROR__', '').trim()));
      return;
    }

    if (line === 'uciok') {
      this._send('setoption name Threads value 1');
      this._send('setoption name Hash value 32');
      this._send('setoption name MultiPV value 1');
      this._send('setoption name UCI_Variant value chess');
      this._send('isready');
      return;
    }

    if (line === 'readyok') {
      if (!this.ready) {
        this.ready = true;
        clearTimeout(this._initTimer);
        if (this._init) {
          this._init.settled = true;
          const resolve = this._init.resolve;
          this._init = null;
          if (this.onStatus) this.onStatus('ready');
          resolve();
        }
      }
      return;
    }

    if (line.startsWith('bestmove')) {
      const current = this.current;
      if (!current) return;
      this.current = null;
      clearTimeout(current.timer);
      if (current.cancelled) {
        current.reject(this._abortError());
        return;
      }
      const parts = line.split(/\s+/);
      const best = parts[1];
      current.resolve({
        cp: current.info.cp,
        mate: current.info.mate,
        depth: current.info.depth,
        pv: current.info.pv,
        bestMove: best && best !== '(none)' ? best : null,
        engineLine: line,
      });
      return;
    }

    if (!this.current || !line.startsWith('info')) return;

    const info = this.current.info;
    const depthMatch = line.match(/\bdepth\s+(\d+)/);
    if (depthMatch) info.depth = parseInt(depthMatch[1], 10);

    const multipvMatch = line.match(/\bmultipv\s+(\d+)/);
    if (multipvMatch && multipvMatch[1] !== '1') return;

    const scoreMatch = line.match(/\bscore\s+(cp|mate)\s+(-?\d+)/);
    if (!scoreMatch) return;

    if (scoreMatch[1] === 'cp') {
      info.cp = parseInt(scoreMatch[2], 10);
      info.mate = null;
    } else {
      info.mate = parseInt(scoreMatch[2], 10);
      info.cp = null;
    }

    const pvMatch = line.match(/\bpv\s+(.+)$/);
    if (pvMatch) info.pv = pvMatch[1].trim().split(/\s+/).slice(0, 12);
  }

  _send(command) {
    if (this.worker) this.worker.postMessage(command);
  }

  _abortError() {
    const error = new Error('Анализ отменён');
    error.name = 'AbortError';
    return error;
  }

  evaluate(fen, { depth = CONFIG.ENGINE_DEFAULT_DEPTH } = {}) {
    const run = () => new Promise((resolve, reject) => {
      if (!this.ready || !this.worker) {
        reject(new Error('Движок ещё не готов'));
        return;
      }

      const info = { cp: null, mate: null, depth: 0, pv: [] };

      const timer = setTimeout(() => {
        if (this.current && this.current.info === info) {
          this._send('stop');
        }
      }, CONFIG.ENGINE_TIMEOUT_MS);

      this.current = {
        info,
        timer,
        cancelled: false,
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      };

      this._send('position fen ' + fen);
      this._send('go depth ' + depth);
    });

    const promise = this.queue.then(run, run);
    this.queue = promise.catch(() => {});
    return promise;
  }

  stop() {
    if (!this.current) return;
    const current = this.current;
    current.cancelled = true;
    this._send('stop');
    setTimeout(() => {
      if (this.current === current) {
        this.current = null;
        clearTimeout(current.timer);
        current.reject(this._abortError());
      }
    }, 2500);
  }

  destroy() {
    try { this.worker && this.worker.terminate(); } catch (_) { /* ignore */ }
    this.worker = null;
    this.ready = false;
    this.initPromise = null;
    this.current = null;
    if (this._blobUrl) {
      URL.revokeObjectURL(this._blobUrl);
      this._blobUrl = null;
    }
  }
}
