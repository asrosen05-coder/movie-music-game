# Handoff: Name That Movie (Movie Soundtrack Quiz)

**Repo:** `C:\Projects\Movie Music Game\movie-music-game` → `github.com/asrosen05-coder/movie-music-game`
**Live:** https://asrosen05-coder.github.io/movie-music-game/ (GitHub Pages from `main`, once enabled)
**Built from:** [Name That Episode](https://github.com/asrosen05-coder/office-music-game) — same rules, design and code; the subject changed from *Office* episodes to movies.

## What this is
A mobile-first, client-side-only web game. You hear Apple's 30-second preview of a song that was in a movie, then pick the movie from 4 options. A game is 10 random songs, with 1 skip and 1 song reveal. At the end you can share an emoji breakdown. No backend, no score persistence, no ads (Apple previews in a plain `<audio>` element, never YouTube).

## Run it locally
```
python -m http.server 8765      # then open http://localhost:8765
npm test                        # Node logic tests (node --test), no dependencies
```
`file://` won't work because `fetch()` of the JSON files fails there.

## Releasing (important)
Every asset URL in `index.html` carries `?v=N`: the import-map entries, the `app.js` script tag and the stylesheet link. **Bump N on every release** (currently `v=1`). Otherwise phones keep cached old code (GitHub Pages caches ~10 minutes) and run it against new data. Data files are fetched with `cache: 'no-cache'`. A new JS module also needs an import-map entry.

## Architecture (vanilla HTML/CSS/JS, ES modules, no build step)
```
index.html        screens, popover, result + quit sheets, toast, SVG sprite, versioned import map
css/styles.css    tokens (light + dark), type scale, layout, components, reduced-motion/-transparency/-contrast
js/data.js        fetch (no-cache) + validate; bad songs skipped with a warning, bad movies fatal; formatMovieLabel
js/quiz.js        pure rules, no DOM: scoring, options (respecting alsoIn), clock, skip, reveal, summary
js/player.js      <audio> player for Apple previews: blocked/paused detection, preloading, preview-URL refresh
js/share.js       share text builder (pure) + native share sheet / clipboard fallback
js/motion.js      springs, momentum projection, rubber-band, count-up, haptics
js/sheet.js       draggable bottom sheet
js/ui.js          all DOM rendering
js/app.js         flow controller
tests/            Node logic tests (17)
tools/            dataset pipeline (see Data)
package.json      only for `"type": "module"` and npm scripts; there are no dependencies
```
Rename map from the reference: episode → movie, `episodeId` → `movieId`, `episodes.json` → `movies.json`, `formatEpisodeCode` → `formatMovieLabel` ("Title (Year)"). Final-screen ranks are movie-themed.

## Rules
- **Options:** 4 per question, the correct movie plus 3 random distinct movies, labelled "Title (Year)". A song's `alsoIn` movies are never offered. Each option's ⓘ shows an original 1–2 sentence premise.
- **Scoring:** `200 + 800 · 0.5^(t/8)`: 1000 instant, 600 at 8s, floors near 200. Wrong and skip score 0, tracked separately. The clock starts on the first `playing` event and pauses while backgrounded or while the End Quiz sheet is open.
- **Lifelines:** one skip, one song reveal (title + artist, never the movie, free, marked 👁️).
- **Share:** 🟩 correct, 🟥 wrong, 🟪 skipped, one line per song title (👁️ if revealed), score, play link. Never movie titles.

## Data
**176 movies (1971–2025), 273 songs, 30 with `alsoIn`.** Every movie has at least one song.

| Decade | Movies |
| --- | --- |
| 1970s | 14 |
| 1980s | 42 |
| 1990s | 43 |
| 2000s | 40 |
| 2010s | 28 |
| 2020s | 9 |

### Schema
- `data/movies.json`: `{ id, title, year, description }`, id = slug + year (`dirty-dancing-1987`).
- `data/songs.json`: `{ id, title, artist, movieId, alsoIn?, appleTrackId, previewUrl, artworkUrl, appleMusicUrl, notes }`. `notes` = the scene, the source, and which Apple recording is used.

### Inclusion rules
- **In:** needle drops, songs written for the film, cast performances (the film's own recording, e.g. the *Mamma Mia!* cast album), favoring songs with a memorable on-screen moment.
- **Out:** orchestral score, background snippets, trailer/ad-only songs (e.g. ELO's "Mr. Blue Sky" was only in *Eternal Sunshine*'s trailer), deleted scenes, "inspired by" album tracks.
- **Title songs** that name the movie ("Footloose", "Ghostbusters", "Skyfall") are kept to about a dozen.
- **Multi-movie songs:** the answer is the movie where the song matters most; every other dataset movie that uses it, including via a cover the player could confuse with it, goes in `alsoIn` (e.g. Prince's "When Doves Cry" → also *Romeo + Juliet*'s choir cover).

### The pipeline (`tools/`)
1. **`catalog.mjs`**: the source of truth. Movies with original descriptions, and songs as `[title, artist, movieId, alsoIn, scene, { term?, trackId? }]`.
2. **`wiki-verify.mjs`**: fetches each film's Wikipedia article plus soundtrack articles (20 titles per request; Wikipedia throttles single-page scraping) and confirms each song's title appears near its artist. It also runs the **alsoIn cross-check**: it scans every dataset movie's pages for every song and reports overlaps. Result: 258/273 confirmed. Its cross-check list has many false positives from prose mentions, so it was reviewed by hand. The real overlaps were added to `alsoIn`.
3. **`wiki-song-check.mjs`**: a second pass for unconfirmed songs, looking for the film in the song's own article. It confirmed 11 more.
4. **`review.mjs`**: hand-confirmed sources for the last 4 (*Free Fallin'*, *Bang Bang*, *Woo Hoo*, *Shout*), plus any matches rejected on review.
5. **`itunes-match.mjs`**: iTunes Search with requests 3.2s apart, back-off on 403, and every response cached to `tools/cache/` the moment it arrives. Filters: live, remix, re-recorded, acoustic, karaoke, cover, sped up, Broadway/cast/sing-along, extended, alternate, 12", "new version". The artist must share a word, and the lead names must nest, so "Donna Summer" can't match a Broadway cast that merely mentions "Summer". Empty normalized names never match, and dotted initials collapse ("M.I.A." → "mia"). Ranking prefers **the film's own soundtrack album**, then the original studio album, then the earliest date. When search finds only covers, it falls back to the artist's catalog. `--rechoose` re-picks from cache; `--retry` retries misses.
6. **`build-data.mjs`**: keeps only songs with both a match and a source, then writes both JSON files.
7. **`check-urls.mjs`**: requests the first byte of every preview and artwork URL. All 546 respond (206 Partial Content for the range request).

All 273 matches were **reviewed by hand** (`tools/review-list.txt` is the review sheet). Eleven were pinned by `trackId` after review, mostly to avoid a re-recording: e.g. the Righteous Brothers' 1990 *Reunion* "Lovin' Feelin'" shares its date with their re-recorded compilation, so the 1964 single is pinned. A filter bug was caught in review: "live" was excused because it appears inside "Stayin' A*live*", so a live Bee Gees version slipped through. Words are now matched whole.

### Adding songs
Add a row to `tools/catalog.mjs`, then run:
```
node tools/itunes-match.mjs && node tools/wiki-verify.mjs && node tools/wiki-song-check.mjs
node tools/build-data.mjs && npm test && node tools/check-urls.mjs
```
Review the new lines in the matcher log by hand. Anything Wikipedia doesn't confirm needs a source in `tools/review.mjs`. Bump `?v=N` before deploying.

## Verified
- **Node logic tests (17 passing):** scoring math, clock start-once, pause/resume while backgrounded, skip and reveal limits, unplayable swap, `alsoIn` never offered (2,000 synthetic + 2,000 real-data questions, each with exactly one right answer), share-text format (no movie titles), validation, and full dataset integrity (schema, ids, `alsoIn` never containing `movieId`, no duplicate `appleTrackId`, ≥100 movies / ≥200 songs).
- **Data:** every song references a real movie, has a hand-reviewed Apple match and a recorded source; all preview and artwork URLs respond.
- **Desktop Chrome (localhost):** the game loads ("273 songs ready"), starts, and renders "Title (Year)" options.

## Not yet verified
1. **A full game played on desktop Chrome**: answer, skip, reveal, replay, quit, final screen. The automated browser window was hidden, so Chrome withheld audio and the game (correctly) stayed paused.
2. **iPhone:** the first-clip "Tap to play" and the Share sheet.
3. **Final name and accent color.** "Name That Movie" and the reference indigo are placeholders until the owner confirms.
