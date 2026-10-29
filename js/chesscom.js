import { CONFIG } from './config.js';

function buildUrl(path) {
  if (/^https?:\/\//i.test(path)) return path;
  return CONFIG.CHESSCOM_API + path;
}

async function api(path, signal) {
  let response;
  try {
    response = await fetch(buildUrl(path), {
      signal,
      headers: { Accept: 'application/json' },
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new Error('Не удалось связаться с Chess.com. Проверьте интернет.');
  }

  if (response.status === 404) {
    throw new Error('Игрок не найден на Chess.com. Проверьте ник.');
  }
  if (response.status === 429) {
    throw new Error('Chess.com временно ограничил запросы. Попробуйте через минуту.');
  }
  if (!response.ok) {
    throw new Error('Chess.com ответил ошибкой ' + response.status + '. Попробуйте позже.');
  }

  try {
    return await response.json();
  } catch (_) {
    throw new Error('Chess.com вернул некорректный ответ.');
  }
}

export function timeClassRu(value) {
  switch (value) {
    case 'bullet': return 'Пуля';
    case 'blitz': return 'Блиц';
    case 'rapid': return 'Рапид';
    case 'daily': return 'По переписке';
    default: return 'Шахматы';
  }
}

function normalizeGame(game, username) {
  const whiteWin = game.white && game.white.result === 'win';
  const blackWin = game.black && game.black.result === 'win';
  let result = '1/2-1/2';
  if (whiteWin && !blackWin) result = '1-0';
  if (blackWin && !whiteWin) result = '0-1';

  return {
    id: game.url || (game.end_time + '-' + game.white.username + '-' + game.black.username),
    pgn: game.pgn,
    url: game.url,
    white: {
      name: game.white.username,
      rating: game.white.rating || null,
      result: game.white.result,
    },
    black: {
      name: game.black.username,
      rating: game.black.rating || null,
      result: game.black.result,
    },
    result,
    timeClass: game.time_class,
    timeControl: game.time_control,
    endTime: game.end_time,
    rated: !!game.rated,
    eco: game.eco || '',
    playerColor: game.white.username.toLowerCase() === username.toLowerCase() ? 'w'
      : game.black.username.toLowerCase() === username.toLowerCase() ? 'b' : null,
  };
}

/**
 * Загружает профиль и последние партии игрока.
 * Берём максимум два последних месячных архива — этого хватает для 24 партий.
 */
export async function fetchRecentGames(username, { signal, limit = CONFIG.CHESSCOM_MAX_GAMES } = {}) {
  const name = String(username || '').trim();
  if (!/^[a-zA-Z0-9_-]{2,30}$/.test(name)) {
    throw new Error('Ник должен содержать 2–30 символов: буквы, цифры, _ или -.');
  }

  const profile = await api('/player/' + encodeURIComponent(name.toLowerCase()), signal);
  const archives = await api('/player/' + encodeURIComponent(name.toLowerCase()) + '/games/archives', signal);

  const urls = Array.isArray(archives.archives) ? archives.archives.slice(-2).reverse() : [];
  if (!urls.length) {
    return { profile, games: [] };
  }

  const games = [];
  for (const url of urls) {
    const data = await api(url, signal);
    if (Array.isArray(data.games)) {
      for (const game of data.games) {
        if (game.rules === 'chess' && game.pgn) {
          games.push(normalizeGame(game, name));
        }
      }
    }
    if (games.length >= limit) break;
  }

  games.sort((a, b) => (b.endTime || 0) - (a.endTime || 0));
  return { profile, games: games.slice(0, limit) };
}
