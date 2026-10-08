// Requests the first byte of every preview and artwork URL in data/songs.json and requires 200/206.
import fs from 'node:fs';

const songs = JSON.parse(fs.readFileSync(new URL('../data/songs.json', import.meta.url), 'utf8'));
const urls = songs.flatMap((s) => [[s.id, 'preview', s.previewUrl], [s.id, 'artwork', s.artworkUrl]]);
const failures = [];
let done = 0;

async function check([id, kind, url]) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { Range: 'bytes=0-0' } });
      await res.arrayBuffer();
      if (res.status === 200 || res.status === 206) return;
      if (attempt === 2) failures.push(`${id} ${kind} HTTP ${res.status} ${url}`);
    } catch (err) {
      if (attempt === 2) failures.push(`${id} ${kind} ${err.message} ${url}`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

const queue = urls.slice();
await Promise.all(Array.from({ length: 6 }, async () => {
  while (queue.length) {
    await check(queue.shift());
    done++;
  }
}));
console.log(`${done - failures.length}/${done} URLs OK.`);
for (const f of failures) console.log(`  FAIL ${f}`);
process.exitCode = failures.length ? 1 : 0;
