// Springs in Apple's designer-friendly terms: `response` (seconds, ~how quickly it gets there)
// and `damping` (1 = critically damped, < 1 = overshoot). Always animates from the current
// value and accepts an initial velocity, so motion stays continuous when interrupted.

export const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const MAX_STEP = 1 / 240;

export function spring({
  from,
  to,
  velocity = 0,
  response = 0.4,
  damping = 1,
  restDelta = 0.5,
  onUpdate,
  onComplete,
}) {
  let x = from - to; // displacement from target
  let v = velocity;
  let raf = 0;
  let last = 0;
  let stopped = false;

  if (reducedMotion.matches) {
    onUpdate(to, 0);
    if (onComplete) queueMicrotask(onComplete);
    return { stop() {}, get value() { return to; }, get velocity() { return 0; } };
  }

  const stiffness = Math.pow((2 * Math.PI) / response, 2);
  const friction = (4 * Math.PI * damping) / response;

  function frame(now) {
    if (stopped) return;
    const dt = last ? Math.min((now - last) / 1000, 1 / 20) : 1 / 60;
    last = now;
    const steps = Math.max(1, Math.ceil(dt / MAX_STEP));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      v += (-stiffness * x - friction * v) * h;
      x += v * h;
    }
    if (Math.abs(x) < restDelta && Math.abs(v) < restDelta * 10) {
      x = 0;
      v = 0;
      onUpdate(to, 0);
      stopped = true;
      if (onComplete) onComplete();
      return;
    }
    onUpdate(to + x, v);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  return {
    stop() {
      stopped = true;
      cancelAnimationFrame(raf);
    },
    get value() { return to + x; },
    get velocity() { return v; },
  };
}

/** Where a flick would come to rest — the same projection UIScrollView deceleration uses. */
export function project(velocity, decelerationRate = 0.998) {
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

/** Progressive resistance past a boundary: things slow down before they stop. */
export function rubberband(overshoot, dimension, constant = 0.55) {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

/** Counts a number up/down with a critically damped spring. */
export function countTo(el, to, { from = Number(el.dataset.value || 0), response = 0.6 } = {}) {
  el.dataset.value = String(to);
  if (el._counter) el._counter.stop();
  el._counter = spring({
    from,
    to,
    response,
    restDelta: 0.5,
    onUpdate: (value) => { el.textContent = Math.round(value).toLocaleString(); },
  });
}

/** Short haptic tap where supported (Android). Fired on the same frame as the visual change. */
export function haptic(kind) {
  if (!navigator.vibrate || reducedMotion.matches) return;
  const patterns = { success: 12, error: [18, 60, 18], light: 6 };
  try { navigator.vibrate(patterns[kind] || 8); } catch (err) { /* unsupported */ }
}
