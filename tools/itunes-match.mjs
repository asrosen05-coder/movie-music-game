// Matches every catalog song to Apple's original studio recording via the iTunes Search API.
// Apple throttles around 20 requests a minute (HTTP 403), so requests are spaced ~3s apart,
// back off on 403, and every response is cached to disk the moment it arrives.
//
//   node tools/itunes-match.mjs          match all songs (cached responses are reused)
//   node tools/itunes-match.mjs --retry  ignore cached "no match" results and try again
//   node tools/itunes-match.mjs --rechoose  re-pick every song (cached responses make this fast)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { songs, movies } from './catalog.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(here, 'cache');
const RESPONSES = path.join(CACHE_DIR, 'itunes-responses.json');
const MATCHES = path.join(CACHE_DIR, 'matches.json');
const SPACING_MS = 3200;

fs.mkdirSync(CACHE_DIR, { recursive: true });
const responses = readJson(RESPONSES, {});
const matches = readJson(MATCHES, {});
const retry = process.argv.includes('--retry');
// Re-pick every song from cached responses, e.g. after changing the filters or ranking.
const rechoose = process.argv.includes('--rechoose');
const movieTitle = (id) => movies.find((m) => m[0] === id)[1];

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function save(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 1));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let lastRequest = 0;
async function getJson(url) {
  if (responses[url]) return responses[url];
  for (let attempt = 0; attempt < 6; attempt++) {
    const wait = lastRequest + SPACING_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequest = Date.now();
    let res;
    try {
      res = await fetch(url);
    } catch (err) {
      console.warn(`  network error, retrying: ${err.message}`);
      await sleep(10000);
      continue;
    }
    if (res.status === 403 || res.status === 429) {
      const backoff = 30000 * (attempt + 1);
      console.warn(`  throttled (${res.status}); backing off ${backoff / 1000}s`);
      await sleep(backoff);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const data = JSON.parse((await res.text()).replace(/\r/g, ''));
    responses[url] = data;
    save(RESPONSES, responses);
    return data;
  }
  throw new Error(`Gave up after repeated throttling: ${url}`);
}

// --- Normalizing

export function ascii(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’‘`]/g, "'")
    .replace(/&/g, ' and ')
    .toLowerCase();
}

function words(s) {
  // Collapse dotted initials first, so "M.I.A." is one word ("mia") rather than none.
  return ascii(s)
    .replace(/\b([a-z0-9])\.(?=[a-z0-9]\b)/g, '$1')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOP.has(w));
}
const STOP = new Set(['the', 'and', 'feat', 'featuring', 'with', 'his', 'her', 'of', 'cast']);

/** Title without parentheticals/brackets/" - " suffixes, as comparable letters only. */
function coreTitle(s) {
  return ascii(s)
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/\s+-\s+.*$/, ' ')
    .replace(/[^a-z0-9]+/g, '');
}

/**
 * The result's artist must share a real word with the expected artist, and one side's name
 * must be contained in the other's ("Kermit" in "Kermit the Frog", "John Travolta" in
 * "John Travolta & Jeff Conaway"), so "Donna Summer" can't match a cast album that merely
 * mentions "Summer". An empty normalized name (e.g. non-Latin script) never matches.
 */
export function artistMatches(expected, actual) {
  const exp = words(expected);
  const act = words(actual);
  if (!exp.length || !act.length) return false;
  const actSet = new Set(act);
  const expSet = new Set(exp);
  if (!act.some((w) => expSet.has(w))) return false;
  // The first credited name on each side, e.g. "Joe Cocker" from "Joe Cocker & Jennifer Warnes".
  const lead = (s) => words(String(s).split(/,|&| and | feat\.? | with | x /i)[0]);
  const expLead = lead(expected);
  const actLead = lead(actual);
  return expLead.every((w) => actSet.has(w)) || actLead.every((w) => expSet.has(w));
}

// Checked against the track name and the album name.
const REJECT = /\b(live|remix|remixed|re-?recorded|re-?record|acoustic|karaoke|cover|tribute|sped ?up|slowed|reverb|lullaby|instrumental version|in the style of|made famous|originally performed|demo|rehearsal|piano version|orchestral version|string quartet|8-bit|workout|club mix|extended mix|dub|reprise|taylor's version|nightcore|unplugged|commentary|broadway|original cast|musical|sing-?a-?long|sing along|edits)\b/;
// Checked against the track name only.
const REJECT_TRACK = /\b(alternate|alternative version|extended|12" version|12 inch|12"|new version|re-?imagined|\d{4} version|single version 2|mixed|demo version|version 2|edit version|promo)\b|\b(19|20)\d\d (re-?recording|version)\b/;

const wholeWord = (word, text) => new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text);

function rejectReason(r, song) {
  const text = ascii(`${r.trackName} ${r.collectionName || ''}`);
  const title = ascii(song.title);
  const m = text.match(REJECT);
  // A word that is part of the real title (e.g. "Live and Let Die") is fine. Whole words only:
  // "live" must not be excused by "Stayin' Alive".
  if (m && !wholeWord(m[1], title)) return `"${m[1]}" version`;
  const t = ascii(r.trackName).match(REJECT_TRACK);
  if (t && !wholeWord(t[0].trim(), title)) return `"${t[0]}" version`;
  if (!artistMatches(song.artist, r.artistName)) return `artist "${r.artistName}"`;
  const want = coreTitle(song.title);
  const got = coreTitle(r.trackName);
  if (!(got === want || (got.startsWith(want) && got.length - want.length <= 3) || (want.startsWith(got) && got.length >= 6 && want.length - got.length <= 4))) {
    return `title "${r.trackName}"`;
  }
  return null;
}

/**
 * Prefer the film's own soundtrack album, then the original studio album: a plain track name,
 * no compilation, earliest release date.
 */
function rank(r, song) {
  let score = 0;
  const coll = ascii(r.collectionName || '');
  const track = ascii(r.trackName);
  const movieWords = words(song.movieTitle || '').filter((w) => w.length > 2);
  if (movieWords.length && movieWords.every((w) => wholeWord(w, coll))) score += 6;
  else if (movieWords.length && movieWords.every((w) => wholeWord(w, track))) score += 3; // "(From "Top Gun")"
  if (coreTitle(r.trackName) === coreTitle(song.title)) score += 2;
  const extras = (r.trackName.match(/\(.*?\)|\[.*?\]/g) || []).join(' ').toLowerCase();
  if (extras && !/remaster|from |theme from|soundtrack|mono|stereo/.test(extras)) score -= 2;
  if (/remaster/.test(track) && !/remaster/.test(coll)) score -= 0.5;
  if (/hits|best of|collection|essential|anthology|greatest|now that|ultimate|platinum|number ones|\bvol\b|snapshot|masters|gold/.test(coll)) score -= 1.5;
  if (r.collectionArtistName && /various/i.test(r.collectionArtistName) && score < 6) score -= 2;
  const year = Number((r.releaseDate || '9999').slice(0, 4));
  return { score, year };
}

function choose(results, song) {
  const candidates = [];
  const rejected = [];
  for (const r of results) {
    if (!r.previewUrl || r.kind !== 'song') continue;
    const reason = rejectReason(r, song);
    if (reason) rejected.push(`${r.trackName} — ${r.artistName} [${r.collectionName}]: ${reason}`);
    else candidates.push(r);
  }
  candidates.sort((a, b) => {
    const ra = rank(a, song), rb = rank(b, song);
    return rb.score - ra.score || ra.year - rb.year;
  });
  return { best: candidates[0] || null, candidates, rejected };
}

function summarize(r) {
  return {
    trackId: r.trackId,
    trackName: r.trackName,
    artistName: r.artistName,
    collectionName: r.collectionName,
    releaseDate: r.releaseDate,
    previewUrl: r.previewUrl,
    artworkUrl: (r.artworkUrl100 || '').replace('100x100bb', '600x600bb'),
    appleMusicUrl: (r.trackViewUrl || '').split('?')[0],
  };
}

const enc = encodeURIComponent;

async function matchSong(song) {
  if (song.trackId) {
    const data = await getJson(`https://itunes.apple.com/lookup?id=${song.trackId}&entity=song&country=US`);
    const r = data.results.find((x) => x.trackId === song.trackId && x.previewUrl);
    return r ? { via: 'pinned', ...summarize(r) } : null;
  }

  const term = song.term || `${song.title} ${song.artist}`;
  const search = await getJson(`https://itunes.apple.com/search?term=${enc(term)}&entity=song&limit=25&country=US`);
  let { best, candidates, rejected } = choose(search.results || [], song);
  if (best) return { via: 'search', ...summarize(best), alternatives: candidates.slice(1, 4).map(summarize).map((c) => `${c.trackName} [${c.collectionName}, ${c.releaseDate?.slice(0, 4)}] ${c.trackId}`) };

  // Search only surfaced covers: go through the artist's own catalog and pin the track.
  const artistTerm = song.artist.split(/,| & | feat\. | and /)[0];
  const artists = await getJson(`https://itunes.apple.com/search?term=${enc(artistTerm)}&entity=musicArtist&limit=5&country=US`);
  for (const a of (artists.results || []).filter((x) => artistMatches(song.artist, x.artistName)).slice(0, 2)) {
    const catalog = await getJson(`https://itunes.apple.com/lookup?id=${a.artistId}&entity=song&limit=200&country=US`);
    ({ best, candidates } = choose(catalog.results || [], song));
    if (best) return { via: `artist ${a.artistId}`, ...summarize(best) };
  }
  return { via: 'none', rejected: rejected.slice(0, 8) };
}

const keyOf = (s) => `${s[0]} | ${s[1]} | ${s[2]}`;

for (const [i, s] of songs.entries()) {
  const key = keyOf(s);
  const [title, artist, movieId, , , opts = {}] = s;
  if (!rechoose) {
    if (matches[key] && (!retry || matches[key].via !== 'none') && !opts.trackId) continue;
    if (matches[key] && opts.trackId && matches[key].trackId === opts.trackId) continue;
  }
  process.stdout.write(`[${i + 1}/${songs.length}] ${title} — ${artist} … `);
  try {
    const m = await matchSong({ title, artist, movieId, movieTitle: movieTitle(movieId), ...opts });
    matches[key] = m || { via: 'none' };
    console.log(m && m.trackId ? `${m.trackName} / ${m.artistName} [${m.collectionName}] (${m.via})` : 'NO MATCH');
  } catch (err) {
    console.log(`ERROR ${err.message}`);
    continue;
  }
  save(MATCHES, matches);
}
const missing = songs.filter((s) => !matches[keyOf(s)] || !matches[keyOf(s)].trackId);
console.log(`\nDone. ${songs.length - missing.length} matched, ${missing.length} without a match.`);
for (const s of missing) console.log(`  - ${s[0]} — ${s[1]}`);
