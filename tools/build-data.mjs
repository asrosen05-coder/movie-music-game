// Builds data/movies.json and data/songs.json from the catalog, the reviewed Apple matches
// (tools/cache/matches.json) and the Wikipedia cross-check (tools/cache/wiki.json).
//
// A song is kept only when it has an Apple match AND a recorded source. Movies left without
// songs are dropped, along with any alsoIn references to them.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { movies, songs } from './catalog.mjs';
import { manualSources, rejectedMatches } from './review.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(here, p), 'utf8'));
const matches = read('cache/matches.json');
const wiki = read('cache/wiki.json');
const wikiSongs = read('cache/wiki-songs.json'); // second pass: the song's own article

const keyOf = (s) => `${s[0]} | ${s[1]} | ${s[2]}`;
const dropped = [];
const kept = [];
const seenTracks = new Set();

for (const s of songs) {
  const [title, artist, movieId, alsoIn, scene] = s;
  const key = keyOf(s);
  const m = matches[key];
  const w = wiki[key];
  if (!m || !m.trackId) { dropped.push(`${title} — no Apple match`); continue; }
  if (rejectedMatches[key]) { dropped.push(`${title} — match rejected in review: ${rejectedMatches[key]}`); continue; }
  if (seenTracks.has(m.trackId)) { dropped.push(`${title} — duplicate Apple track`); continue; }
  const source = (w && w.source) ? `Wikipedia, "${w.source}"`
    : wikiSongs[key] ? `Wikipedia, "${wikiSongs[key]}"`
    : manualSources[key];
  if (!source) { dropped.push(`${title} (${movieId}) — no confirmed source`); continue; }
  seenTracks.add(m.trackId);
  kept.push({ s, m, source });
}

const usedMovies = new Set(kept.map(({ s }) => s[2]));
const outMovies = movies
  .filter(([id]) => usedMovies.has(id))
  .map(([id, title, year, description]) => ({ id, title, year, description }));

const outSongs = kept.map(({ s, m, source }, i) => {
  const [title, artist, movieId, alsoIn, scene] = s;
  const also = alsoIn.filter((id) => usedMovies.has(id));
  return {
    id: `song-${String(i + 1).padStart(3, '0')}`,
    title,
    artist,
    movieId,
    ...(also.length ? { alsoIn: also } : {}),
    appleTrackId: m.trackId,
    previewUrl: m.previewUrl,
    artworkUrl: m.artworkUrl,
    appleMusicUrl: m.appleMusicUrl,
    notes: `${scene} Source: ${source}. Audio: Apple preview of "${m.trackName}" by ${m.artistName} from "${m.collectionName}".`,
  };
});

const lines = (arr) => `[\n${arr.map((o) => `  ${JSON.stringify(o)}`).join(',\n')}\n]\n`;
fs.writeFileSync(path.join(root, 'data/movies.json'), lines(outMovies));
fs.writeFileSync(path.join(root, 'data/songs.json'), lines(outSongs));

console.log(`${outMovies.length} movies, ${outSongs.length} songs written.`);
console.log(`${outSongs.filter((s) => s.alsoIn).length} songs carry alsoIn.`);
if (dropped.length) {
  console.log(`Dropped ${dropped.length}:`);
  for (const d of dropped) console.log(`  - ${d}`);
}
