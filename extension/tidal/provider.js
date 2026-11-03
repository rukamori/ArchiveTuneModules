const API = 'https://api.tidal.com/v1';
const QUALITIES = ['HI_RES_LOSSLESS', 'LOSSLESS', 'HIGH', 'LOW'];
const LOSSY_BITRATES = {HIGH: 320000, LOW: 96000};
let session = null;

function configurationError(message) {
  const error = new Error(message);
  error.code = 'VERIFY_REQUIRED';
  return error;
}

function setting(context, key) {
  const value = context?.settings?.[key]?.value;
  return typeof value === 'string' ? value.trim() : '';
}

function credentials(context) {
  const config = {
    accessToken: setting(context, 'accessToken').replace(/^Bearer\s+/i, ''),
    countryCode: setting(context, 'countryCode').toUpperCase(),
  };
  if (config.countryCode && !/^[A-Z]{2}$/.test(config.countryCode)) throw configurationError('TIDAL country code must be two letters');
  if (!config.accessToken) throw configurationError('TIDAL access token is not configured');
  return config;
}

function decodeBase64(value) {
  const text = String(value).replace(/-/g, '+').replace(/_/g, '/');
  return new TextDecoder().decode(Uint8Array.from(atob(text + '='.repeat((4 - text.length % 4) % 4)), c => c.charCodeAt(0)));
}

function tokenExpiry(token) {
  try {
    const exp = Number(JSON.parse(decodeBase64(token.split('.')[1])).exp);
    return Number.isFinite(exp) && exp > 0 ? exp * 1000 : null;
  } catch (_) {
    return null;
  }
}

async function accountCountry(accessToken) {
  const response = await fetch(API + '/sessions', {headers: {Authorization: 'Bearer ' + accessToken, Accept: 'application/json'}});
  if (response.status === 401) throw configurationError('TIDAL rejected the access token');
  if (!response.ok) throw new Error('TIDAL session lookup failed with HTTP ' + response.status);
  const country = (await response.json())?.countryCode;
  if (typeof country !== 'string' || !/^[A-Za-z]{2}$/.test(country)) throw new Error('TIDAL session has no country');
  return country.toUpperCase();
}

async function authorize(config) {
  const expiry = tokenExpiry(config.accessToken);
  if (expiry !== null && expiry <= Date.now() + 60000) throw configurationError('TIDAL access token is expired');
  const key = JSON.stringify(config);
  if (session?.key === key) return session;
  const countryCode = config.countryCode || await accountCountry(config.accessToken);
  session = {key, accessToken: config.accessToken, countryCode};
  return session;
}

async function api(context, path, params) {
  const auth = await authorize(credentials(context));
  const query = new URLSearchParams(Object.assign({}, params, {countryCode: auth.countryCode}));
  const url = API + path + '?' + query.toString();
  const response = await fetch(url, {headers: {Authorization: 'Bearer ' + auth.accessToken, Accept: 'application/json'}});
  if (response.status === 401) {
    session = null;
    throw configurationError('TIDAL rejected the access token');
  }
  if (!response.ok) throw new Error('TIDAL request failed with HTTP ' + response.status);
  return {url, data: await response.json()};
}

function toTrack(item) {
  if (!item || item.id == null || typeof item.title !== 'string') return null;
  if (item.allowStreaming === false || item.streamReady === false) return null;
  const version = typeof item.version === 'string' ? item.version.trim() : '';
  const base = item.title.trim();
  const title = version && !base.toLowerCase().includes(version.toLowerCase()) ? base + ' (' + version + ')' : base;
  const artists = (Array.isArray(item.artists) && item.artists.length ? item.artists : [item.artist])
    .map(artist => typeof artist?.name === 'string' ? artist.name.trim() : '').filter(Boolean);
  if (!title || !artists.length) return null;
  const track = {id: String(item.id), title, artists: Array.from(new Set(artists))};
  if (typeof item.album?.title === 'string' && item.album.title.trim()) track.album = item.album.title.trim();
  if (Number(item.duration) > 0) track.duration = Number(item.duration);
  if (typeof item.explicit === 'boolean') track.explicit = item.explicit;
  if (typeof item.isrc === 'string' && item.isrc) track.isrc = item.isrc;
  return track;
}

async function searchTracks(query, limit, context) {
  const size = Math.max(1, Math.min(Number(limit) || 10, 50));
  const {data} = await api(context, '/search/tracks', {query: String(query ?? ''), limit: String(size), offset: '0'});
  if (!data || !Array.isArray(data.items)) throw new Error('TIDAL returned an invalid search response');
  return data.items.map(toTrack).filter(Boolean).slice(0, size);
}

function urlExpiry(url) {
  const match = url.match(/[?&](?:Expires|expires|exp)=(\d{9,13})(?:&|$)/) || url.match(/[?&]token=(\d{9,13})~/);
  if (!match) return null;
  const value = Number(match[1]) < 10000000000 ? Number(match[1]) * 1000 : Number(match[1]);
  return value > Date.now() + 60000 && value <= Date.now() + 86400000 ? value : null;
}

function mimeType(value) {
  const type = String(value || '').toLowerCase();
  if (type === 'audio/flac' || type === 'audio/x-flac') return 'audio/flac';
  if (type === 'audio/mp4' || type === 'audio/m4a' || type === 'audio/aac') return 'audio/mp4';
  return type;
}

async function getTrackStreamUrl(trackId, quality, context) {
  const requested = QUALITIES.includes(quality) ? quality : 'LOSSLESS';
  const id = encodeURIComponent(String(trackId));
  const {url: source, data: info} = await api(context, '/tracks/' + id + '/playbackinfopostpaywall',
    {audioquality: requested, playbackmode: 'STREAM', assetpresentation: 'FULL'});
  if (!info || typeof info.manifest !== 'string') throw new Error('TIDAL returned no playback manifest');
  if (info.assetPresentation && info.assetPresentation !== 'FULL') throw new Error('TIDAL returned a preview instead of the full track');
  const actual = typeof info.audioQuality === 'string' && info.audioQuality ? info.audioQuality : requested;
  const manifest = decodeBase64(info.manifest);
  const sampleRate = Number(info.sampleRate) > 0 ? Number(info.sampleRate) : undefined;
  const upstream = {sourceId: String(info.trackId ?? trackId)};
  if (info.manifestMimeType === 'application/vnd.tidal.bts') {
    const bts = JSON.parse(manifest);
    if (bts.encryptionType && bts.encryptionType !== 'NONE') throw new Error('TIDAL returned an encrypted stream');
    const url = Array.isArray(bts.urls) ? bts.urls.find(value => typeof value === 'string' && /^https?:\/\//.test(value)) : null;
    if (!url) throw new Error('TIDAL manifest has no stream URL');
    const codecs = typeof bts.codecs === 'string' ? bts.codecs : '';
    const stream = {
      url,
      mimeType: mimeType(bts.mimeType) || (codecs === 'flac' ? 'audio/flac' : 'audio/mp4'),
      codecs,
      bitrate: LOSSY_BITRATES[actual] || 0,
      variant: 'tidal-' + actual.toLowerCase() + (codecs ? '-' + codecs : ''),
      provider: 'TIDAL',
      track: upstream,
    };
    if (sampleRate) stream.sampleRate = sampleRate;
    const expiry = urlExpiry(url);
    if (expiry) stream.expiresAtMs = expiry;
    return stream;
  }
  if (info.manifestMimeType === 'application/dash+xml') {
    if (/<(?:[A-Za-z0-9_-]+:)?ContentProtection\b/i.test(manifest)) throw new Error('TIDAL returned a protected stream');
    const codecs = manifest.match(/codecs\s*=\s*"([^"]+)"/i)?.[1] || '';
    const rate = sampleRate || Number(manifest.match(/audioSamplingRate\s*=\s*"(\d+)"/i)?.[1]) || undefined;
    const stream = {
      url: source,
      inlineManifest: manifest,
      mimeType: 'application/dash+xml',
      codecs,
      bitrate: LOSSY_BITRATES[actual] || 0,
      variant: 'tidal-' + actual.toLowerCase() + (codecs ? '-' + codecs : '') + '-dash',
      provider: 'TIDAL',
      track: upstream,
    };
    if (rate) stream.sampleRate = rate;
    return stream;
  }
  throw new Error('TIDAL returned an unsupported manifest type');
}

module.exports = {searchTracks, getTrackStreamUrl};
