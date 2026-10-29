/*
 * Классический Web Worker-шим для Stockfish.
 * Принудительно используем ASM.js версию (без WASM).
 */
const params = new URL(self.location.href).searchParams;
// Явно указываем на ASM.js сборку
const engineUrl = params.get('src') || 'https://cdn.jsdelivr.net/npm/stockfish.js@10.0.2/stockfish.js?wasm=0';

try {
  importScripts(engineUrl);
} catch (error) {
  postMessage('__ENGINE_LOAD_ERROR__ ' + (error && error.message ? error.message : String(error)));
}
