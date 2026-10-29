import { CONFIG } from './config.js';

async function api(path, signal) {
  const res = await fetch(CONFIG.CHESSCOM_API + path, { signal, headers: { Accept: 'application/json' } });
  if (res.status === 404) throw new Error('Игрок не найден');
  if (res.status === 429) throw new Error('Слишком много запросов');
  if (!res.ok) throw new Error('Ошибка API ' + res.status);
  return res.json();
}

export function timeClassRu(v) {
  return ({ bullet: 'Пуля', blitz: 'Блиц', rapid: 'Рапид', daily: 'Дейли' })[v] || 'Шахматы';
}

export async function fetchRecentGames(username, { signal, limit = 24 } = {}) {
  const name = username.trim().toLowerCase();
  if (!/^[a-z0-9_-]{2,30}$/.test(name)) throw new Error('Некорректный ник');

  const profile = await api('/player/' + name, signal);
  const arcs = await api('/player/' + name + '/games/archives', signal);
  const urls = (arcs.archives || []).slice(-2).reverse();
  
  if (!urls.length) return { profile, games: [] };

  const games = [];
  for (const url of urls) {
    const data = await api(url.replace(CONFIG.CHESSCOM_API, ''), signal);
    for (const g of (data.games || [])) {
      if (g.rules !== 'chess' || !g.pgn) continue;
      let result = '1/2-1/2';
      if (g.white.result === 'win') result = '1-0';
      if (g.black.result === 'win') result = '0-1';

      games.push({
        id: g.url, pgn: g.pgn, url: g.url, result, timeClass: g.time_class, endTime: g.end_time,
        white: { name: g.white.username, rating: g.white.rating },
        black: { name: g.black.username, rating: g.black.rating },
        playerColor: g.white.username.toLowerCase() === name ? 'w' : 'b'
      });
    }
    if (games.length >= limit) break;
  }

  return { profile, games: games.sort((a,b) => b.endTime - a.endTime).slice(0, limit) };
}
