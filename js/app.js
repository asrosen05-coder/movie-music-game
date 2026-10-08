import { loadData } from './data.js';
import * as player from './player.js';
import * as quiz from './quiz.js';
import * as ui from './ui.js';
import { haptic } from './motion.js';
import { buildShareText, shareResults } from './share.js';

const RESULT_SHEET_DELAY_MS = 420; // let the marked answer register before the sheet rises
const MAX_CONSECUTIVE_ERRORS = 3;

let gameData = null;
let consecutiveErrors = 0;
let finalSummary = null;
let state = null;
let ticker = 0;
let suspended = false;
let resumeAudio = false;
let resultTimer = 0;

const now = () => performance.now();

async function init() {
  ui.onOptionAction({ answer: onAnswer, info: onInfo });
  ui.onSkip(onSkip);
  ui.onReveal(onReveal);
  ui.onShare(onShare);
  ui.onContinue(onContinue);
  ui.onQuit({ open: suspend, cancel: unsuspend, confirm: quitToStart });
  document.getElementById('btn-play').addEventListener('click', startQuiz);
  document.getElementById('btn-play-again').addEventListener('click', startQuiz);
  document.getElementById('btn-reload').addEventListener('click', () => window.location.reload());
  document.getElementById('btn-replay').addEventListener('click', () => player.replay());
  ui.onCardTap(() => player.resume());
  document.addEventListener('visibilitychange', onVisibilityChange);

  const playerReady = player.initPlayer();

  try {
    gameData = await loadData();
  } catch (err) {
    console.error(err);
    ui.showError("Couldn't load the songs. Check your connection and try again.");
    return;
  }

  await playerReady;
  ui.setLoadStatus(`${gameData.songs.length} songs ready`, { ready: true });
}

// --- Flow

function startQuiz() {
  if (!gameData || !player.isReady()) return;
  state = quiz.createQuiz(gameData.songs, gameData.movies);
  consecutiveErrors = 0;
  ui.showScreen('question');
  // Called synchronously inside the tap so the first clip load carries the user gesture.
  loadQuestion();
}

function loadQuestion() {
  const song = quiz.currentSong(state);
  const options = quiz.beginQuestion(state);
  suspended = false;
  resumeAudio = false;

  ui.renderQuestion({
    number: state.index + 1,
    total: state.questions.length,
    results: state.results,
    score: state.score,
    options,
    skipsRemaining: state.skipsRemaining,
    revealsRemaining: state.revealsRemaining,
    artworkUrl: song.artworkUrl,
  });
  ui.setPlayback('loading');
  startTicker();

  const next = state.questions[state.index + 1];
  if (next) player.preload(next.previewUrl);

  player.playClip(
    { src: song.previewUrl, trackId: song.appleTrackId, duration: 30 },
    {
      onPlaying: () => {
        // Points only start draining once the song is actually audible.
        quiz.startClock(state, now());
        consecutiveErrors = 0;
        ui.setPlayback('playing');
      },
      onBuffering: () => {
        if (state.clock.startedAt == null) ui.setPlayback('buffering');
      },
      onPaused: () => ui.setPlayback('paused'),
      onEnded: () => ui.setPlayback('ended'),
      onBlocked: () => ui.setPlayback('blocked'),
      onError: (code) => {
        console.warn(`Audio error ${code} for "${song.title}" (Apple track ${song.appleTrackId}); swapping in another song.`);
        if (state.answered) return;
        // One bad preview is a data problem; several in a row means the network or Apple's
        // CDN is the problem — stop rather than drain the song pool.
        consecutiveErrors += 1;
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          quitToStart();
          ui.showError("The song clips aren't loading right now. Check your connection and try again.");
          return;
        }
        quiz.replaceUnplayable(state);
        if (quiz.isComplete(state)) finishQuiz();
        else loadQuestion();
      },
    },
  );
}

function onAnswer(movieId) {
  if (!state || state.answered || state.clock.startedAt == null) return;
  const result = quiz.answer(state, movieId, now());
  if (result) showOutcome(result);
}

function onSkip() {
  if (!state) return;
  const result = quiz.skip(state, now());
  if (result) showOutcome(result);
}

function onReveal() {
  if (!state) return;
  const song = quiz.reveal(state);
  if (!song) return;
  ui.showSongReveal(song);
  ui.setLifelines(state);
  haptic('light');
}

function showOutcome(result) {
  // Visual, haptic and score change land on the same frame.
  ui.lockOptions(result.pickedId, result.movie.id);
  ui.markProgress(state.index, result.outcome);
  ui.setScore(state.score);
  haptic(result.outcome === 'correct' ? 'success' : result.outcome === 'wrong' ? 'error' : 'light');

  // The song keeps playing under the reveal.
  clearTimeout(resultTimer);
  resultTimer = setTimeout(() => {
    ui.showResult(result, { isLast: quiz.isLastQuestion(state) });
  }, RESULT_SHEET_DELAY_MS);
}

function onContinue() {
  if (!state || !state.answered) return;
  clearTimeout(resultTimer);
  ui.hideResult();
  quiz.advance(state);
  if (quiz.isComplete(state)) {
    finishQuiz();
  } else {
    loadQuestion();
  }
}

function finishQuiz() {
  stopTicker();
  player.stop();
  finalSummary = quiz.summary(state);
  ui.renderFinal(finalSummary);
  ui.showScreen('final');
}

function quitToStart() {
  stopTicker();
  clearTimeout(resultTimer);
  player.stop();
  state = null;
  ui.showScreen('start');
}

async function onShare() {
  if (!finalSummary) return;
  const text = buildShareText(finalSummary, location.origin + location.pathname);
  const outcome = await shareResults(text);
  if (outcome === 'copied') ui.showToast('Results copied to clipboard');
  else if (outcome === 'failed') ui.showToast("Couldn't share. Try again.");
}

function onInfo(movieId, button) {
  const movie = quiz.movieById(state, movieId);
  if (movie) ui.togglePopover(movie, button);
}

// --- Live points + clip progress, one rAF loop

function startTicker() {
  stopTicker();
  const tick = () => {
    if (!state) return;
    if (!state.answered) ui.setLivePoints(quiz.livePoints(state, now()));
    ui.setClipProgress(player.clipProgress());
    ticker = requestAnimationFrame(tick);
  };
  ticker = requestAnimationFrame(tick);
}

function stopTicker() {
  cancelAnimationFrame(ticker);
}

// --- Backgrounding, or the End Quiz sheet, freezes the scoring clock and the audio

function suspend() {
  if (!state || quiz.isComplete(state) || suspended) return;
  suspended = true;
  quiz.pauseClock(state, now());
  resumeAudio = !player.hasEnded();
  player.pause();
}

function unsuspend() {
  if (!state || !suspended) return;
  suspended = false;
  quiz.resumeClock(state, now());
  if (resumeAudio) player.resume();
  resumeAudio = false;
}

function onVisibilityChange() {
  if (document.hidden) suspend();
  else if (!ui.isQuitOpen()) unsuspend();
}

init();
