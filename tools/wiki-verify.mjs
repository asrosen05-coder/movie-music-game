// Cross-checks every catalog song against Wikipedia: the song title must appear in the film's
// article or its soundtrack article, with the artist named nearby. It also runs the alsoIn
// cross-check: every dataset movie's articles are scanned for every song, so a song heard in
// two dataset movies is flagged if it lacks alsoIn.
//
// Pages are fetched 20 titles per request (Wikipedia throttles one-page-per-call scraping)
// and cached in tools/cache/wiki-pages.json. Output: tools/cache/wiki.json + a report.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { movies, songs } from './catalog.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(here, 'cache', 'wiki-pages.json');
const OUT = path.join(here, 'cache', 'wiki.json');
fs.mkdirSync(path.dirname(CACHE), { recursive: true });
let pages = {};
try { pages = JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch { /* fresh */ }
if (!pages.__v2) pages = { __v2: true }; // older cache format
const API = 'https://en.wikipedia.org/w/api.php';
const UA = { 'User-Agent': 'NameThatMovie-data-check/1.0 (https://github.com/asrosen05-coder/movie-music-game)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** title -> { title (resolved), text } | null. Batched, cached. */
async function fetchPages(titles) {
  const missing = [...new Set(titles)].filter((t) => !(t in pages));
  for (let i = 0; i < missing.length; i += 20) {
    const batch = missing.slice(i, i + 20);
    const params = new URLSearchParams({
      action: 'query', format: 'json', formatversion: '2', redirects: '1',
      prop: 'revisions', rvprop: 'content', rvslots: 'main', titles: batch.join('|'),
    });
    let data;
    for (let attempt = 0; ; attempt++) {
      await sleep(1500);
      const res = await fetch(`${API}?${params}`, { headers: UA });
      if (res.status === 429 && attempt < 6) {
        const wait = Number(res.headers.get('retry-after')) * 1000 || 30000;
        console.warn(`  throttled; waiting ${wait / 1000}s`);
        await sleep(wait);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
      break;
    }
    // Follow normalization and redirects back to the titles we asked for.
    const alias = new Map();
    for (const n of data.query.normalized || []) alias.set(n.from, n.to);
    for (const r of data.query.redirects || []) alias.set(r.from, r.to);
    const resolve = (t) => { let x = t; for (let k = 0; k < 3 && alias.has(x); k++) x = alias.get(x); return x; };
    const byTitle = new Map(data.query.pages.map((p) => [p.title, p]));
    for (const t of batch) {
      const p = byTitle.get(resolve(t));
      const text = p && !p.missing && p.revisions ? p.revisions[0].slots.main.content : null;
      pages[t] = text ? { title: p.title, text: text.replace(/\r/g, '') } : null;
    }
    fs.writeFileSync(CACHE, JSON.stringify(pages));
    process.stdout.write(`  fetched ${Math.min(i + 20, missing.length)}/${missing.length} pages\r`);
  }
  return titles.map((t) => pages[t]);
}

const norm = (s) => String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[’‘]/g, "'").toLowerCase();
const flat = (s) => ` ${norm(s).replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim()} `;
const coreTitle = (t) => flat(t.replace(/\(.*?\)/g, ' '));
const STOP = new Set(['the', 'and', 'feat', 'with', 'his', 'her', 'cast']);
const artistWords = (a) => flat(a).trim().split(' ').filter((w) => w.length >= 3 && !STOP.has(w));

const isDisambig = (text) => /\{\{\s*(disambiguation|dab|hndis|geodis)|may refer to:/i.test(text.slice(0, 3000));

function candidatesFor([, title, year]) {
  const bare = title.replace(/\.\.\.$/, '');
  return {
    film: [`${title} (${year} film)`, `${title} (film)`, title, `${bare} (${year} film)`],
    soundtrack: [`${title} (soundtrack)`, `${title} (${year} soundtrack)`, `${title} (${year} film soundtrack)`,
      `${title} (film soundtrack)`, `${title} (Original Motion Picture Soundtrack)`, `Music of ${title}`,
      `${title}: Original Motion Picture Soundtrack`, `${title} (album)`],
  };
}

function confirms(page, songTitle, artist) {
  const text = flat(page.text);
  const t = coreTitle(songTitle);
  const aw = artistWords(artist);
  let i = text.indexOf(t);
  while (i !== -1) {
    const window = text.slice(Math.max(0, i - 500), i + t.length + 500);
    if (aw.some((w) => window.includes(` ${w} `))) return true;
    i = text.indexOf(t, i + 1);
  }
  return false;
}

// Fetch everything in batches up front.
const cands = new Map(movies.map((m) => [m[0], candidatesFor(m)]));
await fetchPages([...cands.values()].flatMap((c) => [...c.film, ...c.soundtrack]));
console.log('');

const articles = new Map();
for (const m of movies) {
  const [id, title, year] = m;
  const c = cands.get(id);
  const found = [];
  for (const t of c.film) {
    const p = pages[t];
    if (p && !isDisambig(p.text) && p.text.includes(String(year)) && /\{\{\s*infobox film/i.test(p.text)) { found.push(p); break; }
  }
  for (const t of c.soundtrack) {
    const p = pages[t];
    if (p && !isDisambig(p.text) && !found.some((f) => f.title === p.title) && flat(p.text).includes(flat(title).trim().split(' ').slice(0, 2).join(' '))) found.push(p);
  }
  articles.set(id, found);
}

const report = {};
const unconfirmed = [];
const crossHits = [];
let ok = 0;
for (const s of songs) {
  const [title, artist, movieId, alsoIn] = s;
  const hit = articles.get(movieId).find((p) => confirms(p, title, artist));
  const also = {};
  for (const a of alsoIn) {
    const p = articles.get(a).find((pg) => confirms(pg, title, artist));
    also[a] = p ? p.title : null;
  }
  // Cross-check: any other dataset movie whose articles also list this song.
  const elsewhere = [];
  for (const [otherId, arts] of articles) {
    if (otherId === movieId || alsoIn.includes(otherId)) continue;
    const p = arts.find((pg) => confirms(pg, title, artist));
    if (p) elsewhere.push(`${otherId} (${p.title})`);
  }
  if (elsewhere.length) crossHits.push(`${title} — ${artist} [${movieId}] also listed for: ${elsewhere.join(', ')}`);
  report[`${title} | ${artist} | ${movieId}`] = { source: hit ? hit.title : null, articles: articles.get(movieId).map((p) => p.title), alsoIn: also, elsewhere };
  if (hit) ok++;
  else unconfirmed.push(`${title} — ${artist}  (${movieId}; checked: ${articles.get(movieId).map((p) => p.title).join(', ') || 'NO ARTICLE FOUND'})`);
}
fs.writeFileSync(OUT, JSON.stringify(report, null, 1));
console.log(`${ok}/${songs.length} songs confirmed on Wikipedia.`);
console.log(`\nUnconfirmed (${unconfirmed.length}):`);
for (const u of unconfirmed) console.log(`  - ${u}`);
console.log(`\nalsoIn entries not confirmed on the other movie's pages:`);
for (const [k, v] of Object.entries(report)) for (const [a, src] of Object.entries(v.alsoIn)) if (!src) console.log(`  - ${k} -> ${a}`);
console.log(`\nCross-check: songs also listed on another dataset movie's pages (${crossHits.length}):`);
for (const c of crossHits) console.log(`  - ${c}`);
