// Audio player for Apple's 30-second song previews. One <audio> element is reused for the
// whole session: on iOS, once it has played inside a tap, later clips can start on their own.

const BLOCKED_AFTER_MS = 2500;
const LOOKUP_URL = 'https://itunes.apple.com/lookup';

const audio = new Audio();
audio.preload = 'auto';
audio.setAttribute('playsinline', '');

const preloader = new Audio();
preloader.preload = 'auto';

let handlers = {};
let clip = null;
let ended = false;
let refreshed = false;
let loading = false; // between a src change and the first 'playing'
let blockedTimer = null;

audio.addEventListener('playing', () => {
  loading = false;
  clearTimeout(blockedTimer);
  if (handlers.onPlaying) handlers.onPlaying();
});
audio.addEventListener('waiting', () => {
  if (handlers.onBuffering) handlers.onBuffering();
});
audio.addEventListener('pause', () => {
  // Swapping src on a playing element fires 'pause' too; that isn't the user's pause.
  if (!loading && !ended && !audio.ended && handlers.onPaused) handlers.onPaused();
});
audio.addEventListener('ended', () => {
  ended = true;
  if (handlers.onEnded) handlers.onEnded();
});
audio.addEventListener('error', onAudioError);

/** Nothing to load up front any more; kept async so the app's startup flow is unchanged. */
export function initPlayer() {
  return Promise.resolve();
}

export function isReady() {
  return true;
}

/** Loads and plays a clip. Callbacks: onPlaying, onBuffering, onPaused, onEnded, onBlocked, onError. */
export function playClip(nextClip, callbacks) {
  clearTimeout(blockedTimer);
  clip = nextClip;
  handlers = callbacks || {};
  ended = false;
  refreshed = false;
  loading = true;
  audio.src = clip.src;
  start();
}

function start() {
  const attempt = audio.play();
  if (attempt && attempt.catch) {
    attempt.catch((err) => {
      // NotAllowedError: the browser wants a tap first. Anything else surfaces via 'error'.
      if (err && err.name === 'NotAllowedError' && handlers.onBlocked) handlers.onBlocked();
    });
  }
  // Some browsers neither play nor reject; treat a long silence as blocked.
  blockedTimer = setTimeout(() => {
    if (audio.paused && !ended && handlers.onBlocked) handlers.onBlocked();
  }, BLOCKED_AFTER_MS);
}

/** Preview URLs can change when Apple re-ingests a track; look up a fresh one once before giving up. */
async function onAudioError() {
  if (!clip) return;
  const failed = clip;
  if (!refreshed && failed.trackId) {
    refreshed = true;
    try {
      const res = await fetch(`${LOOKUP_URL}?id=${failed.trackId}&entity=song&country=US`);
      const data = await res.json();
      const fresh = data.results && data.results.find((r) => r.previewUrl);
      if (clip === failed && fresh && fresh.previewUrl !== audio.src) {
        audio.src = fresh.previewUrl;
        start();
        return;
      }
    } catch (err) { /* fall through to onError */ }
  }
  if (clip === failed && handlers.onError) handlers.onError(audio.error ? audio.error.code : 'unknown');
}

/** Warms the cache for the next clip so it starts instantly. */
export function preload(src) {
  if (src && preloader.src !== src) preloader.src = src;
}

export function replay() {
  if (!clip) return;
  ended = false;
  audio.currentTime = 0;
  start();
}

export function hasEnded() {
  return ended;
}

/** 0…1 through the current clip. */
export function clipProgress() {
  if (!clip) return 0;
  if (ended) return 1;
  const total = audio.duration || clip.duration || 30;
  return Math.min(1, Math.max(0, audio.currentTime / total));
}

export function stop() {
  clearTimeout(blockedTimer);
  handlers = {};
  clip = null;
  audio.pause();
}

export function pause() {
  audio.pause();
}

export function resume() {
  if (ended || !clip) return;
  start();
}
