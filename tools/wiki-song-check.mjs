// Second pass for songs the film pages didn't confirm: look for the film's title in the
// song's own Wikipedia article (usually its "In popular culture" or "Use in media" section).
import fs from 'node:fs';
import { movies, songs } from './catalog.mjs';

const wiki = JSON.parse(fs.readFileSync(new URL('./cache/wiki.json', import.meta.url), 'utf8'));
const UA = { 'User-Agent': 'NameThatMovie-data-check/1.0 (https://github.com/asrosen05-coder/movie-music-game)' };
const todo = songs.filter((s) => !wiki[`${s[0]} | ${s[1]} | ${s[2]}`]?.source);
const flat = (s) => String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ');
const out = {};
for (const [title, artist, movieId] of todo) {
  const movie = movies.find((m) => m[0] === movieId);
  const bareArtist = artist.replace(/^The /, '');
  const titles = [title, `${title} (song)`, `${title} (${artist} song)`, `${title} (${bareArtist} song)`];
  const params = new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', redirects: '1', prop: 'revisions', rvprop: 'content', rvslots: 'main', titles: titles.join('|') });
  await new Promise((r) => setTimeout(r, 1500));
  const data = await (await fetch(`https://en.wikipedia.org/w/api.php?${params}`, { headers: UA })).json();
  const hits = (data.query.pages || []).filter((p) => p.revisions).filter((p) => {
    const text = flat(p.revisions[0].slots.main.content);
    return text.includes(flat(movie[1]).trim()) && text.includes(flat(artist.split(/[&,]/)[0]).trim().split(' ').pop());
  }).map((p) => p.title);
  out[`${title} | ${artist} | ${movieId}`] = hits[0] || null;
  console.log(`${hits[0] ? 'OK  ' : 'MISS'} ${title} — ${movie[1]}${hits[0] ? `  (Wikipedia, "${hits[0]}")` : ''}`);
}
fs.writeFileSync(new URL('./cache/wiki-songs.json', import.meta.url), JSON.stringify(out, null, 1));
