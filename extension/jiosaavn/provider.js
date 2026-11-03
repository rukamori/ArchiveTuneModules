const API = 'https://www.jiosaavn.com/api.php';
const REFERER = 'https://www.jiosaavn.com/';
const BASE_PARAMS = {_format: 'json', _marker: '0', api_version: '4', ctx: 'web6dot0'};
const ENTITIES = {amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' '};
const SOURCE_SUFFIX = /\s*\(From\s+"[^"]*"\)\s*$/i;

function decode(value) {
  return String(value ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === '#') {
      const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  }).replace(/\s+/g, ' ').trim();
}

async function call(name, params) {
  const query = new URLSearchParams(Object.assign({__call: name}, BASE_PARAMS, params));
  const response = await fetch(API + '?' + query.toString(), {headers: {Accept: 'application/json', Referer: REFERER}});
  if (!response.ok) throw new Error('JioSaavn request failed with HTTP ' + response.status);
  try {
    return JSON.parse(await response.text());
  } catch (_) {
    throw new Error('JioSaavn returned an unreadable response');
  }
}

function names(list) {
  return (Array.isArray(list) ? list : []).map(artist => decode(artist?.name)).filter(Boolean);
}

function toTracks(song) {
  if (!song || song.type !== 'song' || typeof song.id !== 'string' || !song.id) return [];
  const info = song.more_info || {};
  const credits = info.artistMap || {};
  let artists = names(credits.primary_artists).concat(names(credits.featured_artists));
  if (!artists.length) artists = names((credits.artists || []).filter(artist => artist?.role === 'singer'));
  if (!artists.length) artists = decode(song.subtitle).split(' - ')[0].split(/\s*,\s*/).filter(Boolean);
  const title = decode(song.title);
  if (!title || !artists.length) return [];
  const duration = Number(info.duration);
  const track = {id: song.id, title, artists: Array.from(new Set(artists))};
  const album = decode(info.album);
  if (album) track.album = album;
  if (Number.isFinite(duration) && duration > 0) track.duration = duration;
  if (song.explicit_content === '1') track.explicit = true;
  else if (song.explicit_content === '0') track.explicit = false;
  const plain = title.replace(SOURCE_SUFFIX, '');
  return plain && plain !== title ? [track, Object.assign({}, track, {title: plain})] : [track];
}

async function searchTracks(query, limit) {
  const size = Math.max(1, Math.min(Number(limit) || 10, 50));
  const data = await call('search.getResults', {q: String(query ?? ''), n: String(size), p: '1'});
  if (Array.isArray(data) && data.length === 0) return [];
  if (!data || !Array.isArray(data.results)) throw new Error('JioSaavn returned an invalid search response');
  return data.results.slice(0, size).flatMap(toTracks);
}

async function getTrackStreamUrl(trackId, quality) {
  const id = String(trackId);
  const details = await call('song.getDetails', {pids: id});
  const song = (Array.isArray(details?.songs) ? details.songs : []).find(item => item?.id === id) ?? details?.[id];
  const info = song?.more_info;
  const encrypted = info?.encrypted_media_url;
  if (typeof encrypted !== 'string' || !encrypted) throw new Error('JioSaavn has no stream for this track');
  const requested = String(quality ?? '320') === '96' ? 96 : 320;
  const bitrate = requested === 320 && String(info['320kbps']) !== 'true' ? 96 : requested;
  const token = await call('song.generateAuthToken', {url: encrypted, bitrate: String(bitrate)});
  const url = token?.status === 'success' && typeof token.auth_url === 'string' ? token.auth_url : '';
  const encoded = Number(url.match(/_(\d+)\.mp4(?:[?#]|$)/)?.[1]);
  if (!/^https:\/\//.test(url) || encoded !== bitrate) throw new Error('JioSaavn did not return the requested stream');
  const expires = Number(url.match(/[?&]Expires=(\d+)/)?.[1]);
  const stream = {
    url,
    headers: {Referer: REFERER},
    mimeType: 'audio/mp4',
    codecs: 'mp4a.40.2',
    bitrate: bitrate * 1000,
    sampleRate: 44100,
    variant: 'aac-' + bitrate,
    provider: 'JioSaavn',
  };
  if (Number.isFinite(expires) && expires > 0) stream.expiresAtMs = expires * 1000;
  return stream;
}

module.exports = {searchTracks, getTrackStreamUrl};
