// All DOM rendering. No game rules live here.

import { formatMovieLabel } from './data.js';
import { countTo, reducedMotion } from './motion.js';
import { createSheet } from './sheet.js';

const $ = (id) => document.getElementById(id);

const screens = {
  start: $('screen-start'),
  question: $('screen-question'),
  final: $('screen-final'),
  error: $('screen-error'),
};

const el = {
  play: $('btn-play'),
  loadStatus: $('load-status'),
  progress: $('progress'),
  score: $('score-value'),
  nowPlaying: $('now-playing'),
  npKicker: $('np-kicker'),
  npStatus: $('np-status'),
  npPoints: $('np-points'),
  npFill: $('np-progress-fill'),
  replay: $('btn-replay'),
  options: $('options'),
  skip: $('btn-skip'),
  skipLabel: $('btn-skip-label'),
  reveal: $('btn-reveal'),
  revealLabel: $('btn-reveal-label'),
  npReveal: $('np-reveal'),
  npRevealTitle: $('np-reveal-title'),
  npRevealArtist: $('np-reveal-artist'),
  popover: $('popover'),
  popoverYear: $('popover-year'),
  popoverTitle: $('popover-title'),
  popoverText: $('popover-text'),
  resultBadge: $('result-badge'),
  resultIcon: $('result-icon'),
  resultTitle: $('result-title'),
  resultPoints: $('result-points'),
  revealSong: $('reveal-song'),
  revealArtist: $('reveal-artist'),
  revealMovie: $('reveal-movie'),
  revealAlso: $('reveal-also'),
  toast: $('toast'),
  revealArtwork: $('reveal-artwork'),
  revealApple: $('reveal-apple'),
  npArtwork: $('np-artwork'),
  next: $('btn-next'),
  finalScore: $('final-score'),
  finalRank: $('final-rank'),
  statCorrect: $('stat-correct'),
  statWrong: $('stat-wrong'),
  statSkipped: $('stat-skipped'),
  recap: $('recap'),
  errorMessage: $('error-message'),
};

// iOS only applies :active styles when a touch listener exists.
document.addEventListener('touchstart', () => {}, { passive: true });

// --- Screens

export function showScreen(name) {
  for (const [key, screen] of Object.entries(screens)) {
    const active = key === name;
    screen.classList.toggle('is-active', active);
    screen.inert = !active;
  }
  closePopover();
}

export function setLoadStatus(text, { ready = false } = {}) {
  el.loadStatus.textContent = text;
  el.play.disabled = !ready;
}

export function showError(message) {
  el.errorMessage.textContent = message;
  showScreen('error');
}

// --- Question

export function renderQuestion({ number, total, results, score, options, skipsRemaining, revealsRemaining, artworkUrl }) {
  closePopover();
  renderProgress(number, total, results);
  setScore(score, { animate: false });

  el.npKicker.textContent = `Song ${number} of ${total}`;
  setArtwork(artworkUrl);
  el.nowPlaying.classList.remove('is-answered');
  el.npPoints.textContent = '1,000';
  setClipProgress(0);

  el.options.replaceChildren(...options.map(renderOption));
  el.options.classList.remove('is-locked');
  el.options.classList.add('is-waiting');

  hideSongReveal();
  setLifelines({ skipsRemaining, revealsRemaining, revealed: false });
}

function renderOption(movie) {
  const row = document.createElement('div');
  row.className = 'option';
  row.setAttribute('role', 'listitem');
  row.dataset.id = movie.id;

  const main = document.createElement('button');
  main.type = 'button';
  main.className = 'option-main';
  main.dataset.action = 'answer';

  // Reads as "Dirty Dancing (1987)"; the year is just set in a quieter color.
  const text = document.createElement('span');
  text.className = 'option-text';
  const title = document.createElement('span');
  title.className = 'option-title';
  const year = document.createElement('span');
  year.className = 'option-year';
  year.textContent = ` (${movie.year})`;
  title.append(movie.title, year);
  text.append(title);

  const mark = document.createElement('span');
  mark.className = 'option-mark';
  mark.setAttribute('aria-hidden', 'true');
  mark.innerHTML = '<svg><use href="#i-check"/></svg>';

  main.append(text, mark);

  const info = document.createElement('button');
  info.type = 'button';
  info.className = 'option-info';
  info.dataset.action = 'info';
  info.setAttribute('aria-label', `About “${formatMovieLabel(movie)}”`);
  info.setAttribute('aria-expanded', 'false');
  info.setAttribute('aria-controls', 'popover');
  info.innerHTML = '<svg><use href="#i-info"/></svg>';

  row.append(main, info);
  return row;
}

function renderProgress(number, total, results) {
  const segments = [];
  for (let i = 0; i < total; i++) {
    const seg = document.createElement('i');
    if (i < results.length) seg.dataset.state = results[i].outcome;
    else if (i === number - 1) seg.dataset.state = 'current';
    segments.push(seg);
  }
  el.progress.replaceChildren(...segments);
  el.progress.setAttribute('aria-valuemax', String(total));
  el.progress.setAttribute('aria-valuenow', String(number));
  el.progress.setAttribute('aria-label', `Song ${number} of ${total}`);
}

export function markProgress(index, outcome) {
  const seg = el.progress.children[index];
  if (seg) seg.dataset.state = outcome;
}

export function setScore(score, { animate = true } = {}) {
  if (animate) {
    countTo(el.score, score);
  } else {
    if (el.score._counter) el.score._counter.stop();
    el.score.dataset.value = String(score);
    el.score.textContent = score.toLocaleString();
  }
}

/** Delegated handlers for the answer/info buttons. */
export function onOptionAction({ answer, info }) {
  el.options.addEventListener('click', (e) => {
    const button = e.target.closest('button[data-action]');
    if (!button) return;
    const id = button.closest('.option').dataset.id;
    if (button.dataset.action === 'answer') answer(id);
    else info(id, button);
  });
}

const STATUS = {
  loading: 'Loading…',
  buffering: 'Buffering…',
  playing: 'Listen…',
  ended: 'Clip finished',
  blocked: 'Tap to play',
  paused: 'Paused · tap to resume',
};

/** loading | buffering | playing | paused | ended | blocked */
function setArtwork(url) {
  el.nowPlaying.classList.remove('has-artwork');
  if (!url) {
    el.npArtwork.removeAttribute('src');
    return;
  }
  el.npArtwork.onload = () => {
    if (el.npArtwork.src === url) el.nowPlaying.classList.add('has-artwork');
  };
  el.npArtwork.src = url;
}

/** Tapping the card starts audio when the browser wanted a gesture, or resumes after a pause. */
export function onCardTap(handler) {
  el.nowPlaying.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    const state = el.nowPlaying.dataset.state;
    if (state === 'blocked' || state === 'paused') handler();
  });
}

export function setPlayback(state) {
  el.nowPlaying.dataset.state = state;
  el.npStatus.textContent = STATUS[state] || '';
  el.replay.hidden = state !== 'ended';
  if (state === 'playing') el.options.classList.remove('is-waiting');
}

export function enableAnswers() {
  el.options.classList.remove('is-waiting');
}

export function setLivePoints(points) {
  el.npPoints.textContent = points.toLocaleString();
}

export function setClipProgress(p) {
  el.npFill.style.transform = `scaleX(${p})`;
}

export function lockOptions(pickedId, correctId) {
  closePopover();
  el.options.classList.remove('is-waiting');
  el.options.classList.add('is-locked');
  el.nowPlaying.classList.add('is-answered');
  for (const row of el.options.children) {
    const isCorrect = row.dataset.id === correctId;
    const isPicked = row.dataset.id === pickedId;
    if (isCorrect) {
      row.dataset.result = 'correct';
    } else if (isPicked) {
      row.dataset.result = 'wrong';
      row.querySelector('.option-mark use').setAttribute('href', '#i-xmark');
    }
    row.querySelector('.option-main').setAttribute('aria-disabled', 'true');
  }
  setEnabled(el.skip, false);
  setEnabled(el.reveal, false);
}

// --- Lifelines: one skip and one reveal per quiz

function setEnabled(button, enabled) {
  button.classList.toggle('is-disabled', !enabled);
  if (enabled) button.removeAttribute('aria-disabled');
  else button.setAttribute('aria-disabled', 'true');
}

export function setLifelines({ skipsRemaining, revealsRemaining, revealed }) {
  el.skipLabel.textContent = skipsRemaining > 0 ? 'Skip' : 'No skips';
  setEnabled(el.skip, skipsRemaining > 0);
  el.revealLabel.textContent = revealed ? 'Revealed' : revealsRemaining > 0 ? 'Reveal song' : 'No reveals';
  setEnabled(el.reveal, revealsRemaining > 0 && !revealed);
}

export function onSkip(handler) {
  el.skip.addEventListener('click', handler);
}

export function onReveal(handler) {
  el.reveal.addEventListener('click', handler);
}

/** Shows the song's title and artist in the Now Playing card (never the movie). */
export function showSongReveal(song) {
  el.npRevealTitle.textContent = song.title;
  el.npRevealArtist.textContent = song.artist;
  el.npReveal.hidden = false;
  el.nowPlaying.classList.add('is-revealed');
}

function hideSongReveal() {
  el.npReveal.hidden = true;
  el.nowPlaying.classList.remove('is-revealed');
}

// --- Popover

let popoverAnchor = null;

export function togglePopover(movie, anchor) {
  if (popoverAnchor === anchor) {
    closePopover();
    return;
  }
  closePopover({ instant: true });
  popoverAnchor = anchor;
  anchor.setAttribute('aria-expanded', 'true');

  el.popoverTitle.textContent = movie.title;
  el.popoverYear.textContent = String(movie.year);
  el.popoverText.textContent = movie.description;
  el.popover.hidden = false;

  // Measure layout size, not the bounding box: the popover is scaled down before it opens.
  const a = anchor.getBoundingClientRect();
  const column = el.options.getBoundingClientRect();
  const p = { width: el.popover.offsetWidth, height: el.popover.offsetHeight };
  const margin = 12;
  const below = a.bottom + 6;
  const above = a.top - p.height - 6;
  const placeAbove = below + p.height > window.innerHeight - margin && above > margin;
  const top = placeAbove ? above : Math.min(below, window.innerHeight - p.height - margin);
  const maxLeft = Math.min(column.right, window.innerWidth - margin) - p.width;
  const left = Math.max(margin, Math.min(a.right - p.width, maxLeft));

  el.popover.style.top = `${top}px`;
  el.popover.style.left = `${left}px`;
  // grow out of the button that opened it
  const originX = a.left + a.width / 2 - left;
  const originY = placeAbove ? p.height : 0;
  el.popover.style.transformOrigin = `${originX}px ${originY}px`;

  void el.popover.offsetWidth;
  el.popover.classList.add('is-open');
}

export function closePopover({ instant = false } = {}) {
  if (!popoverAnchor && el.popover.hidden) return;
  if (popoverAnchor) popoverAnchor.setAttribute('aria-expanded', 'false');
  popoverAnchor = null;
  el.popover.classList.remove('is-open');
  if (instant || reducedMotion.matches) {
    el.popover.hidden = true;
  } else {
    const pop = el.popover;
    setTimeout(() => {
      if (!pop.classList.contains('is-open')) pop.hidden = true;
    }, 220);
  }
}

document.addEventListener('pointerdown', (e) => {
  if (!popoverAnchor) return;
  if (el.popover.contains(e.target) || popoverAnchor.contains(e.target)) return;
  closePopover();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closePopover();
});
window.addEventListener('resize', () => closePopover({ instant: true }));

// --- Result sheet

const resultSheet = createSheet($('sheet-result'), {
  onDismiss: () => resultSheet.handlers.dismiss && resultSheet.handlers.dismiss(),
});
resultSheet.handlers = {};

function listTitles(titles) {
  if (titles.length <= 1) return titles.join('');
  return `${titles.slice(0, -1).join(', ')} and ${titles[titles.length - 1]}`;
}

const RESULT_COPY = {
  correct: { title: 'Correct', icon: '#i-check' },
  wrong: { title: 'Not quite', icon: '#i-xmark' },
  skipped: { title: 'Skipped', icon: '#i-forward' },
};

export function showResult(result, { isLast }) {
  const copy = RESULT_COPY[result.outcome];
  el.resultBadge.dataset.outcome = result.outcome;
  el.resultIcon.setAttribute('href', copy.icon);
  el.resultTitle.textContent = copy.title;
  el.resultPoints.textContent = result.points > 0 ? `+${result.points.toLocaleString()} points` : '';
  el.revealSong.textContent = result.song.title;
  el.revealArtist.textContent = result.song.artist;
  el.revealMovie.textContent = formatMovieLabel(result.movie);
  el.revealAlso.hidden = !result.alsoIn.length;
  el.revealAlso.textContent = result.alsoIn.length
    ? `Also heard in ${listTitles(result.alsoIn.map(formatMovieLabel))}`
    : '';
  if (result.song.artworkUrl) el.revealArtwork.src = result.song.artworkUrl.replace('600x600', '160x160');
  else el.revealArtwork.removeAttribute('src');
  el.revealApple.hidden = !result.song.appleMusicUrl;
  if (result.song.appleMusicUrl) el.revealApple.href = result.song.appleMusicUrl;
  el.next.textContent = isLast ? 'See Results' : 'Next Song';
  resultSheet.open();
}

export function hideResult() {
  return resultSheet.close();
}

/** Next button and swipe-down both continue. */
export function onContinue(handler) {
  el.next.addEventListener('click', handler);
  resultSheet.handlers.dismiss = handler;
}

export function isResultOpen() {
  return resultSheet.isOpen;
}

// --- Quit sheet

const quitHandlers = {};
const quitSheet = createSheet($('sheet-quit'), {
  onDismiss: () => quitHandlers.cancel && quitHandlers.cancel(),
});

export function isQuitOpen() {
  return quitSheet.isOpen;
}

/** open: the sheet is up (pause the game); cancel: back to playing; confirm: end the quiz. */
export function onQuit({ open, cancel, confirm }) {
  Object.assign(quitHandlers, { cancel });
  $('btn-quit').addEventListener('click', () => {
    open();
    quitSheet.open();
  });
  $('btn-quit-cancel').addEventListener('click', () => quitSheet.dismiss());
  $('btn-quit-confirm').addEventListener('click', async () => {
    await quitSheet.close();
    confirm();
  });
}

// --- Final

const RANKS = [
  [0.85, 'Best Picture. Clear a shelf for the statue.'],
  [0.65, "Director's cut material."],
  [0.45, 'Certified fresh.'],
  [0.25, 'A solid matinee.'],
  [0.1, 'Straight to streaming.'],
  [0, 'You slept through the previews.'],
];

export function onShare(handler) {
  $('btn-share').addEventListener('click', handler);
}

let toastTimer = 0;

/** Brief confirmation pill above the dock, announced to screen readers. */
export function showToast(text) {
  clearTimeout(toastTimer);
  el.toast.textContent = text;
  el.toast.hidden = false;
  void el.toast.offsetWidth;
  el.toast.classList.add('is-visible');
  toastTimer = setTimeout(() => {
    el.toast.classList.remove('is-visible');
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, 300);
  }, 2200);
}

export function renderFinal({ score, maxScore, correct, wrong, skipped, results }) {
  const ratio = maxScore ? score / maxScore : 0;
  el.finalRank.textContent = RANKS.find(([min]) => ratio >= min)[1];
  el.statCorrect.textContent = String(correct);
  el.statWrong.textContent = String(wrong);
  el.statSkipped.textContent = String(skipped);

  el.recap.replaceChildren(...results.map((r) => {
    const li = document.createElement('li');
    const mark = document.createElement('span');
    mark.className = 'recap-mark';
    mark.dataset.outcome = r.outcome;
    mark.innerHTML = `<svg><use href="${RESULT_COPY[r.outcome].icon}"/></svg>`;
    mark.setAttribute('aria-label', RESULT_COPY[r.outcome].title);
    mark.setAttribute('role', 'img');

    const text = document.createElement('span');
    text.className = 'recap-text';
    const song = document.createElement('span');
    song.className = 'recap-song';
    song.textContent = `${r.song.title} — ${r.song.artist}`;
    const movie = document.createElement('span');
    movie.className = 'recap-movie';
    movie.textContent = `${formatMovieLabel(r.movie)}${r.revealed ? '  ·  revealed' : ''}`;
    text.append(song, movie);

    const pts = document.createElement('span');
    pts.className = 'recap-points';
    pts.textContent = r.points.toLocaleString();
    if (r.points > 0) pts.dataset.scored = '';

    li.append(mark, text, pts);
    return li;
  }));

  el.finalScore.dataset.value = '0';
  el.finalScore.textContent = '0';
  // let the screen arrive before the number runs up
  setTimeout(() => countTo(el.finalScore, score, { from: 0, response: 1.1 }), 250);
  screens.final.querySelector('.screen-scroll').scrollTop = 0;
}
