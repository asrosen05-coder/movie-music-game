// Pure quiz state and rules. No DOM, no player. Time is always passed in as `now` (ms).

export const QUESTIONS_PER_QUIZ = 10;
export const SKIPS_PER_QUIZ = 1;
export const REVEALS_PER_QUIZ = 1;
export const MAX_POINTS = 1000;
const FLOOR_POINTS = 200;
const HALF_LIFE_SECONDS = 8;

/** 1000 for an instant answer, halving its bonus every 8s, flooring near 200. */
export function pointsFor(elapsedMs) {
  const decay = Math.pow(0.5, elapsedMs / 1000 / HALF_LIFE_SECONDS);
  return Math.round(FLOOR_POINTS + (MAX_POINTS - FLOOR_POINTS) * decay);
}

function shuffle(array) {
  const result = array.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function createQuiz(songs, movies) {
  const shuffled = shuffle(songs);
  const count = Math.min(QUESTIONS_PER_QUIZ, shuffled.length);
  return {
    movies,
    questions: shuffled.slice(0, count),
    reserve: shuffled.slice(count), // replacements for clips that fail to play
    index: 0,
    skipsRemaining: SKIPS_PER_QUIZ,
    revealsRemaining: REVEALS_PER_QUIZ,
    revealed: false, // whether the current question's song has been revealed
    score: 0,
    results: [],
    options: [],
    clock: { startedAt: null, pausedAt: null },
    answered: false,
  };
}

export function currentSong(state) {
  return state.questions[state.index];
}

export function movieById(state, id) {
  return state.movies.find((m) => m.id === id);
}

/** Starts a fresh question: 1 correct movie + 3 distinct distractors, shuffled. */
export function beginQuestion(state) {
  const song = currentSong(state);
  const correct = movieById(state, song.movieId);
  // A song heard in several movies must never offer one of its other movies as a wrong answer.
  const excluded = new Set([song.movieId, ...(song.alsoIn || [])]);
  const distractors = shuffle(state.movies.filter((m) => !excluded.has(m.id))).slice(0, 3);
  state.options = shuffle([correct, ...distractors]);
  state.clock = { startedAt: null, pausedAt: null };
  state.answered = false;
  state.revealed = false;
  return state.options;
}

// --- Scoring clock: starts on first audible playback, can be frozen while backgrounded.

export function startClock(state, now) {
  if (state.clock.startedAt == null) state.clock.startedAt = now;
}

export function isClockRunning(state) {
  return state.clock.startedAt != null && state.clock.pausedAt == null && !state.answered;
}

export function pauseClock(state, now) {
  if (isClockRunning(state)) state.clock.pausedAt = now;
}

export function resumeClock(state, now) {
  const { clock } = state;
  if (clock.pausedAt == null) return;
  clock.startedAt += now - clock.pausedAt;
  clock.pausedAt = null;
}

export function elapsedMs(state, now) {
  const { startedAt, pausedAt } = state.clock;
  if (startedAt == null) return 0;
  return (pausedAt ?? now) - startedAt;
}

export function livePoints(state, now) {
  return pointsFor(elapsedMs(state, now));
}

// --- Outcomes

function record(state, outcome, pickedId, now) {
  const song = currentSong(state);
  const elapsed = outcome === 'skipped' ? null : elapsedMs(state, now);
  const points = outcome === 'correct' ? pointsFor(elapsed) : 0;
  const result = {
    song,
    movie: movieById(state, song.movieId),
    pickedId,
    outcome,
    points,
    elapsedMs: elapsed,
    revealed: state.revealed,
    alsoIn: (song.alsoIn || []).map((id) => movieById(state, id)).filter(Boolean),
  };
  state.answered = true;
  state.score += points;
  state.results.push(result);
  return result;
}

export function answer(state, movieId, now) {
  if (state.answered) return null;
  const outcome = movieId === currentSong(state).movieId ? 'correct' : 'wrong';
  return record(state, outcome, movieId, now);
}

/** Uses the quiz's reveal on the current song. Returns the song, or null if unavailable. */
export function reveal(state) {
  if (state.answered || state.revealed || state.revealsRemaining <= 0) return null;
  state.revealsRemaining -= 1;
  state.revealed = true;
  return currentSong(state);
}

export function skip(state, now) {
  if (state.answered || state.skipsRemaining <= 0) return null;
  state.skipsRemaining -= 1;
  return record(state, 'skipped', null, now);
}

/**
 * The current clip can't be played (removed, embedding disabled…). Swap in an unused
 * song so the quiz keeps its length; if none are left, drop the question instead.
 */
export function replaceUnplayable(state) {
  if (state.reserve.length > 0) {
    state.questions[state.index] = state.reserve.shift();
  } else {
    state.questions.splice(state.index, 1);
  }
}

export function advance(state) {
  state.index += 1;
}

export function isComplete(state) {
  return state.index >= state.questions.length;
}

export function isLastQuestion(state) {
  return state.index >= state.questions.length - 1;
}

export function summary(state) {
  const count = (o) => state.results.filter((r) => r.outcome === o).length;
  return {
    score: state.score,
    maxScore: state.questions.length * MAX_POINTS,
    correct: count('correct'),
    wrong: count('wrong'),
    skipped: count('skipped'),
    results: state.results,
  };
}
