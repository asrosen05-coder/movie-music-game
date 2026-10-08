// Node logic tests: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as quiz from '../js/quiz.js';
import { buildShareText } from '../js/share.js';
import { validate, formatMovieLabel } from '../js/data.js';

const readJson = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), 'utf8'));
const realMovies = readJson('../data/movies.json');
const realSongs = readJson('../data/songs.json');

function fixture() {
  const movies = Array.from({ length: 8 }, (_, i) => ({ id: `m${i}`, title: `Movie ${i}`, year: 1980 + i, description: 'x' }));
  const songs = Array.from({ length: 14 }, (_, i) => ({
    id: `s${i}`, title: `Song ${i}`, artist: 'A', movieId: `m${i % 8}`,
    appleTrackId: 1000 + i, previewUrl: 'https://audio-ssl.itunes.apple.com/x.m4a',
  }));
  return { movies, songs };
}

function newQuiz() {
  const { movies, songs } = fixture();
  const state = quiz.createQuiz(songs, movies);
  quiz.beginQuestion(state);
  return state;
}

// --- Scoring

test('scoring: 1000 instant, 600 at 8s, 400 at 16s, floors near 200', () => {
  assert.equal(quiz.pointsFor(0), 1000);
  assert.equal(quiz.pointsFor(8000), 600);
  assert.equal(quiz.pointsFor(16000), 400);
  assert.equal(quiz.pointsFor(600000), 200);
  assert.ok(quiz.pointsFor(30000) > 200 && quiz.pointsFor(30000) < 300);
});

test('a game has 10 songs and options are 4 distinct movies including the answer', () => {
  const state = newQuiz();
  assert.equal(state.questions.length, 10);
  const ids = state.options.map((m) => m.id);
  assert.equal(ids.length, 4);
  assert.equal(new Set(ids).size, 4);
  assert.ok(ids.includes(quiz.currentSong(state).movieId));
});

// --- Clock

test('clock: starts once on first playing and is not restarted by a later playing event', () => {
  const state = newQuiz();
  assert.equal(quiz.elapsedMs(state, 5000), 0, 'no time passes before audio plays');
  quiz.startClock(state, 1000);
  quiz.startClock(state, 9000); // e.g. resume after a pause fires 'playing' again
  assert.equal(quiz.elapsedMs(state, 9000), 8000);
});

test('clock: pausing while backgrounded freezes points, resuming continues from the same place', () => {
  const state = newQuiz();
  quiz.startClock(state, 0);
  quiz.pauseClock(state, 4000);
  assert.equal(quiz.elapsedMs(state, 60000), 4000);
  quiz.resumeClock(state, 60000);
  assert.equal(quiz.elapsedMs(state, 64000), 8000);
  const result = quiz.answer(state, quiz.currentSong(state).movieId, 64000);
  assert.equal(result.points, 600);
});

test('clock: resume without a pause is a no-op; pause before start does nothing', () => {
  const state = newQuiz();
  quiz.pauseClock(state, 100);
  assert.equal(state.clock.pausedAt, null);
  quiz.startClock(state, 1000);
  quiz.resumeClock(state, 5000);
  assert.equal(quiz.elapsedMs(state, 5000), 4000);
});

// --- Outcomes

test('correct answers score, wrong answers score 0, and a question can only be answered once', () => {
  const state = newQuiz();
  quiz.startClock(state, 0);
  const right = quiz.answer(state, quiz.currentSong(state).movieId, 0);
  assert.equal(right.outcome, 'correct');
  assert.equal(right.points, 1000);
  assert.equal(quiz.answer(state, 'm0', 10), null);

  quiz.advance(state);
  quiz.beginQuestion(state);
  quiz.startClock(state, 0);
  const wrongId = state.options.find((m) => m.id !== quiz.currentSong(state).movieId).id;
  const wrong = quiz.answer(state, wrongId, 1000);
  assert.equal(wrong.outcome, 'wrong');
  assert.equal(wrong.points, 0);
  assert.equal(state.score, 1000);
});

test('skip: one per game, scores 0, tracked separately from wrong', () => {
  const state = newQuiz();
  const skipped = quiz.skip(state, 0);
  assert.equal(skipped.outcome, 'skipped');
  assert.equal(skipped.points, 0);
  assert.equal(state.skipsRemaining, 0);
  quiz.advance(state);
  quiz.beginQuestion(state);
  assert.equal(quiz.skip(state, 0), null, 'second skip is refused');
  quiz.startClock(state, 0);
  const wrongId = state.options.find((m) => m.id !== quiz.currentSong(state).movieId).id;
  quiz.answer(state, wrongId, 0);
  const sum = quiz.summary(state);
  assert.deepEqual([sum.correct, sum.wrong, sum.skipped], [0, 1, 1]);
});

test('skip is refused after the question is answered', () => {
  const state = newQuiz();
  quiz.startClock(state, 0);
  quiz.answer(state, quiz.currentSong(state).movieId, 0);
  assert.equal(quiz.skip(state, 0), null);
  assert.equal(state.skipsRemaining, 1);
});

test('reveal: one per game, shows the song, is free and flagged on the result', () => {
  const state = newQuiz();
  const song = quiz.reveal(state);
  assert.equal(song, quiz.currentSong(state));
  assert.equal(quiz.reveal(state), null, 'cannot reveal the same song twice');
  quiz.startClock(state, 0);
  const result = quiz.answer(state, song.movieId, 0);
  assert.equal(result.revealed, true);
  assert.equal(result.points, 1000, 'reveal costs nothing');
  quiz.advance(state);
  quiz.beginQuestion(state);
  assert.equal(state.revealed, false);
  assert.equal(quiz.reveal(state), null, 'only one reveal per game');
});

test('an unplayable clip is swapped from the reserve, or dropped when the reserve is empty', () => {
  const state = newQuiz();
  const before = quiz.currentSong(state);
  quiz.replaceUnplayable(state);
  assert.notEqual(quiz.currentSong(state), before);
  assert.equal(state.questions.length, 10);
  state.reserve = [];
  quiz.replaceUnplayable(state);
  assert.equal(state.questions.length, 9);
});

test('summary counts and completion', () => {
  const state = newQuiz();
  for (let i = 0; i < state.questions.length; i++) {
    quiz.beginQuestion(state);
    quiz.startClock(state, 0);
    quiz.answer(state, quiz.currentSong(state).movieId, 8000);
    assert.equal(quiz.isLastQuestion(state), i === state.questions.length - 1);
    quiz.advance(state);
  }
  assert.ok(quiz.isComplete(state));
  const sum = quiz.summary(state);
  assert.equal(sum.correct, 10);
  assert.equal(sum.score, 6000);
  assert.equal(sum.maxScore, 10000);
});

// --- alsoIn

test('alsoIn movies are never offered as options (synthetic, 2,000 questions)', () => {
  const { movies, songs } = fixture();
  songs[0].alsoIn = ['m1', 'm2', 'm3'];
  for (let i = 0; i < 2000; i++) {
    const state = quiz.createQuiz([songs[0]], movies);
    const ids = quiz.beginQuestion(state).map((m) => m.id);
    assert.ok(!ids.some((id) => songs[0].alsoIn.includes(id)));
    assert.equal(ids.length, 4);
  }
});

test('alsoIn movies are never offered as options (real data, 2,000 generated questions)', () => {
  const { songs, movies } = validate(realSongs, realMovies);
  let withAlsoIn = 0;
  for (let i = 0; i < 2000; i++) {
    const state = quiz.createQuiz(songs, movies);
    const options = quiz.beginQuestion(state);
    const song = quiz.currentSong(state);
    const ids = options.map((m) => m.id);
    assert.equal(new Set(ids).size, 4);
    assert.equal(ids.filter((id) => id === song.movieId).length, 1, 'exactly one right answer');
    for (const other of song.alsoIn || []) assert.ok(!ids.includes(other), `${song.title}: ${other} offered`);
    if (song.alsoIn) withAlsoIn++;
  }
  assert.ok(withAlsoIn > 0, 'the run should exercise songs with alsoIn');
});

// --- Share text

test('share text: squares, eye only on revealed songs, song titles, no movie titles, play link', () => {
  const movie = { id: 'dirty-dancing-1987', title: 'Dirty Dancing', year: 1987 };
  const mk = (title, outcome, revealed = false) => ({ song: { title }, movie, outcome, revealed, points: outcome === 'correct' ? 800 : 0 });
  const results = [mk('Hungry Eyes', 'correct'), mk('Be My Baby', 'wrong', true), mk('Do You Love Me', 'skipped')];
  const text = buildShareText({ score: 1800, correct: 1, results }, 'https://example.com/play/');
  assert.equal(text, [
    'Name That Movie 🎬 1,800 pts (1/3)',
    '🟩🟥🟪',
    '',
    '🟩 Hungry Eyes',
    '🟥 Be My Baby 👁️',
    '🟪 Do You Love Me',
    '',
    'https://example.com/play/',
  ].join('\n'));
  assert.ok(!text.includes('Dirty Dancing'));
});

// --- Data

test('validate: rejects alsoIn containing the answer, unknown movies, and missing previews', () => {
  const { movies, songs } = fixture();
  const bad = [
    { ...songs[0], id: 'b1', alsoIn: ['m0'] },
    { ...songs[1], id: 'b2', movieId: 'nope' },
    { ...songs[2], id: 'b3', previewUrl: 'https://youtube.com/x' },
    { ...songs[3], id: 'b4', alsoIn: ['ghost'] },
  ];
  const warn = console.warn;
  console.warn = () => {};
  try {
    const out = validate([...songs, ...bad], movies);
    assert.equal(out.songs.length, songs.length);
  } finally {
    console.warn = warn;
  }
});

test('formatMovieLabel is "Title (Year)"', () => {
  assert.equal(formatMovieLabel({ title: 'Dirty Dancing', year: 1987 }), 'Dirty Dancing (1987)');
});

test('dataset integrity: real movies and songs follow the schema and rules', () => {
  const movieIds = new Set();
  for (const m of realMovies) {
    assert.deepEqual(Object.keys(m).sort(), ['description', 'id', 'title', 'year']);
    assert.match(m.id, new RegExp(`^[a-z0-9-]+-${m.year}$`));
    assert.ok(!movieIds.has(m.id), `duplicate movie ${m.id}`);
    movieIds.add(m.id);
    assert.ok(m.description.length > 20 && m.description.length < 260, `${m.id} description`);
  }
  const trackIds = new Set();
  const songIds = new Set();
  for (const s of realSongs) {
    assert.ok(!songIds.has(s.id), `duplicate song id ${s.id}`);
    songIds.add(s.id);
    assert.ok(movieIds.has(s.movieId), `${s.id} movieId`);
    if (s.alsoIn !== undefined) {
      assert.ok(Array.isArray(s.alsoIn) && s.alsoIn.length > 0);
      assert.ok(!s.alsoIn.includes(s.movieId), `${s.id} alsoIn contains movieId`);
      for (const a of s.alsoIn) assert.ok(movieIds.has(a), `${s.id} alsoIn ${a}`);
    }
    assert.ok(!trackIds.has(s.appleTrackId), `duplicate appleTrackId ${s.appleTrackId}`);
    trackIds.add(s.appleTrackId);
    assert.match(s.previewUrl, /^https:\/\/[a-z0-9.-]+\.apple\.com\//);
    assert.match(s.artworkUrl, /600x600bb/);
    assert.ok(!s.appleMusicUrl.includes('?'));
    assert.ok(s.notes && s.notes.length > 10);
  }
  assert.ok(realMovies.length >= 100, `${realMovies.length} movies`);
  assert.ok(realSongs.length >= 200, `${realSongs.length} songs`);
  const used = new Set(realSongs.map((s) => s.movieId));
  for (const m of realMovies) assert.ok(used.has(m.id), `${m.id} has no songs`);
});
