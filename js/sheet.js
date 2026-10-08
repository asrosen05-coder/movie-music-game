// Bottom sheet: springs in from the bottom edge and leaves the same way. It tracks the finger
// 1:1 from where it was grabbed, can be caught mid-animation, and on release uses the projected
// momentum (not the release point) to decide between dismissing and settling back.

import { spring, project, rubberband, haptic } from './motion.js';

const DRAG_THRESHOLD = 10;
const OPEN = { response: 0.42, damping: 1 };
const SETTLE = { response: 0.3, damping: 0.8 }; // a little bounce: only after a throw
const CLOSE = { response: 0.35, damping: 1 };

export function createSheet(root, { onDismiss } = {}) {
  const panel = root.querySelector('.sheet-panel');
  const scrim = root.querySelector('.sheet-scrim');
  let y = 0;
  let height = 1;
  let anim = null;
  let isOpen = false;
  let lastFocus = null;

  function render(value) {
    y = value;
    panel.style.transform = `translate3d(0, ${value}px, 0)`;
    const progress = 1 - Math.min(1, Math.max(0, value / height));
    scrim.style.opacity = String(progress);
  }

  function animateTo(target, params, velocity = 0, done) {
    if (anim) anim.stop();
    anim = spring({
      from: y,
      to: target,
      velocity,
      ...params,
      onUpdate: render,
      onComplete: () => {
        anim = null;
        if (done) done();
      },
    });
  }

  function open() {
    lastFocus = document.activeElement;
    root.hidden = false;
    root.classList.add('is-open');
    height = panel.getBoundingClientRect().height || window.innerHeight;
    if (!isOpen) render(height);
    isOpen = true;
    animateTo(0, OPEN);
    const focusTarget = panel.querySelector('[data-autofocus]') || panel;
    focusTarget.focus({ preventScroll: true });
  }

  function close(velocity = 0) {
    if (!isOpen) return Promise.resolve();
    isOpen = false;
    root.classList.remove('is-open');
    return new Promise((resolve) => {
      animateTo(height, CLOSE, velocity, () => {
        root.hidden = true;
        resolve();
      });
      if (lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
    });
  }

  function dismiss(velocity = 0) {
    if (!isOpen) return;
    close(velocity);
    if (onDismiss) onDismiss();
  }

  // --- Drag to dismiss

  let pointerId = null;
  let startY = 0;
  let grabY = 0;
  let dragging = false;
  let samples = [];
  let suppressClick = false;

  panel.addEventListener('pointerdown', (e) => {
    if (!isOpen || e.button !== 0) return;
    suppressClick = false;
    pointerId = e.pointerId;
    startY = e.clientY;
    dragging = false;
    samples = [{ y: e.clientY, t: e.timeStamp }];
  });

  panel.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pointerId) return;
    if (!dragging) {
      if (Math.abs(e.clientY - startY) < DRAG_THRESHOLD) return;
      dragging = true;
      panel.setPointerCapture(pointerId);
      if (anim) anim.stop(); // catch it mid-flight, from where it actually is
      grabY = e.clientY - y; // respect where the finger grabbed it
      height = panel.getBoundingClientRect().height;
      root.classList.add('is-dragging');
    }
    const raw = e.clientY - grabY;
    render(raw < 0 ? rubberband(raw, height) : raw);
    samples.push({ y: e.clientY, t: e.timeStamp });
    if (samples.length > 5) samples.shift();
  });

  function endDrag(e) {
    if (e.pointerId !== pointerId) return;
    pointerId = null;
    if (!dragging) return;
    dragging = false;
    suppressClick = true;
    root.classList.remove('is-dragging');
    const velocity = releaseVelocity();
    const projected = y + project(velocity);
    if (projected > height * 0.5 && velocity > -200) {
      haptic('light');
      dismiss(velocity);
    } else {
      animateTo(0, SETTLE, velocity);
    }
  }

  function releaseVelocity() {
    if (samples.length < 2) return 0;
    const a = samples[0];
    const b = samples[samples.length - 1];
    const dt = (b.t - a.t) / 1000;
    return dt > 0 ? (b.y - a.y) / dt : 0;
  }

  panel.addEventListener('pointerup', endDrag);
  panel.addEventListener('pointercancel', endDrag);
  // A drag that started on a button must not also activate it.
  panel.addEventListener('click', (e) => {
    if (suppressClick) {
      suppressClick = false;
      e.stopPropagation();
      e.preventDefault();
    }
  }, true);

  scrim.addEventListener('click', () => dismiss());
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') dismiss();
  });

  return { open, close, dismiss, get isOpen() { return isOpen; } };
}
