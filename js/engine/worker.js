/*
 * Локальный воркер для загрузки Stockfish.
 * Позволяет обойти ограничения CORS браузера при работе с CDN.
 */
const params = new URL(self.location.href).searchParams;
const engineUrl = params.get('url');

if (!engineUrl) {
  postMessage('__ERROR__ Не передан URL движка');
} else {
  try {
    importScripts(engineUrl);
  } catch (error) {
    postMessage('__ERROR__ ' + (error && error.message ? error.message : String(error)));
  }
}
