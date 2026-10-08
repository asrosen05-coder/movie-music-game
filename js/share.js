// Share text for a finished quiz, and the share/copy mechanics. Song titles only — never
// movies — so a friend can still play the same songs without spoilers.

const SQUARES = { correct: '🟩', wrong: '🟥', skipped: '🟪' };
const REVEALED = '👁️';

/** summary: quiz.summary(state). url: where friends can play. */
export function buildShareText({ score, correct, results }, url) {
  const grid = results.map((r) => SQUARES[r.outcome]).join('');
  const lines = results.map((r) => `${SQUARES[r.outcome]} ${r.song.title}${r.revealed ? ` ${REVEALED}` : ''}`);
  return [
    `Name That Movie 🎬 ${score.toLocaleString('en-US')} pts (${correct}/${results.length})`,
    grid,
    '',
    ...lines,
    '',
    url,
  ].join('\n');
}

/**
 * Phones get the native share sheet (Messages, etc.); everything else copies to the clipboard.
 * Must be called from a tap. Resolves to 'shared' | 'cancelled' | 'copied' | 'failed'.
 */
export async function shareResults(text) {
  const isTouch = window.matchMedia('(pointer: coarse)').matches;
  if (isTouch && navigator.share) {
    try {
      await navigator.share({ text });
      return 'shared';
    } catch (err) {
      if (err && err.name === 'AbortError') return 'cancelled';
      // Share sheet unavailable for some reason: fall through to copying.
    }
  }
  if (await copyText(text)) return 'copied';
  // Clipboard refused (e.g. desktop browser without permission): offer the system share sheet instead.
  if (!isTouch && navigator.share) {
    try {
      await navigator.share({ text });
      return 'shared';
    } catch (err) {
      if (err && err.name === 'AbortError') return 'cancelled';
    }
  }
  return 'failed';
}

async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (err) { /* fall back below */ }
  // Older browsers / non-secure contexts.
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
  area.remove();
  return ok;
}
