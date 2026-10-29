/*
 * Шим для загрузки Stockfish в Web Worker.
 */
const params = new URL(self.location.href).searchParams;
const engineUrl = params.get('src') || 'https://cdn.jsdelivr.net/npm/stockfish.js@10.0.2/stockfish.js';

try {
  importScripts(engineUrl);
} catch (error) {
  postMessage('__ENGINE_LOAD_ERROR__ ' + (error && error.message ? error.message : String(error)));
}
