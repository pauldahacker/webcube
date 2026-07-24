export type MoveInput = {
  forward: number; // -1..1
  turn: number; // -1..1
  drift: boolean;
};

export const moveInput: MoveInput = { forward: 0, turn: 0, drift: false };

const keys: Record<string, boolean> = {};
const KEY_FORWARD = ['w', 'ArrowUp'];
const KEY_BACK = ['s', 'ArrowDown'];
const KEY_LEFT = ['a', 'ArrowLeft'];
const KEY_RIGHT = ['d', 'ArrowRight'];
const KEY_DRIFT = ['Enter', 'Shift'];

let touchActive = false;

// Single-character keys arrive uppercased while Shift is held (e.key 'W' not
// 'w'), which would break WASD steering during a Shift-drift - lowercase them
// so both cases match. Named keys (ArrowUp, Shift, Enter) are left as-is.
function normalizeKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}

function isDown(names: string[]): boolean {
  return names.some((name) => keys[name]);
}

function updateFromKeys() {
  // Drift is a modifier, not a movement axis: it's active from either the
  // keyboard drift keys or a finger held on the right half of the screen.
  moveInput.drift = isDown(KEY_DRIFT) || driftTouchId !== null;
  if (touchActive) return;
  moveInput.forward = (isDown(KEY_FORWARD) ? 1 : 0) - (isDown(KEY_BACK) ? 1 : 0);
  moveInput.turn = (isDown(KEY_LEFT) ? 1 : 0) - (isDown(KEY_RIGHT) ? 1 : 0);
}

globalThis.addEventListener('keydown', (e) => {
  keys[normalizeKey(e.key)] = true;
  updateFromKeys();
});
globalThis.addEventListener('keyup', (e) => {
  keys[normalizeKey(e.key)] = false;
  updateFromKeys();
});

// Touch controls: the left half of the screen is a floating joystick (drag to
// steer/accelerate), the right half is hold-to-drift. Each is tracked by its own
// finger id so you can steer and drift at the same time, one thumb each.
const JOYSTICK_RADIUS = 60;

let moveTouchId: number | null = null;
let driftTouchId: number | null = null;
let originX = 0;
let originY = 0;
let joystickEl: HTMLDivElement | null = null;
let knobEl: HTMLDivElement | null = null;

// Taps that land on a real UI control (menu buttons, name field, music widget)
// must pass through as normal clicks - we don't drive or preventDefault on those.
function isUiTarget(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest('button, input, a, select, label, .home');
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function ensureJoystickElements() {
  if (joystickEl) return;
  joystickEl = document.createElement('div');
  joystickEl.className = 'joystick-base';
  joystickEl.style.display = 'none';
  knobEl = document.createElement('div');
  knobEl.className = 'joystick-knob';
  joystickEl.appendChild(knobEl);
  document.body.appendChild(joystickEl);
}

function moveKnob(dx: number, dy: number) {
  if (!knobEl) return;
  knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
}

function showJoystick(x: number, y: number) {
  ensureJoystickElements();
  if (!joystickEl) return;
  joystickEl.style.left = `${x - JOYSTICK_RADIUS}px`;
  joystickEl.style.top = `${y - JOYSTICK_RADIUS}px`;
  joystickEl.style.display = 'block';
  moveKnob(0, 0);
}

function hideJoystick() {
  if (!joystickEl) return;
  joystickEl.style.display = 'none';
}

function findTouch(list: TouchList, id: number | null): Touch | null {
  if (id === null) return null;
  for (let i = 0; i < list.length; i++) {
    if (list[i].identifier === id) return list[i];
  }
  return null;
}

function handleTouchStart(e: TouchEvent) {
  // Ignore touches that begin on a UI control so its tap/click still fires.
  if (isUiTarget(e.target)) return;
  let engaged = false;
  for (let i = 0; i < e.changedTouches.length; i++) {
    const touch = e.changedTouches[i];
    const onLeftHalf = touch.clientX < globalThis.innerWidth / 2;
    if (onLeftHalf && moveTouchId === null) {
      moveTouchId = touch.identifier;
      touchActive = true;
      originX = touch.clientX;
      originY = touch.clientY;
      showJoystick(originX, originY);
      engaged = true;
    } else if (!onLeftHalf && driftTouchId === null) {
      driftTouchId = touch.identifier;
      engaged = true;
    }
  }
  if (!engaged) return;
  updateFromKeys();
  e.preventDefault();
}

function handleTouchMove(e: TouchEvent) {
  const touch = findTouch(e.touches, moveTouchId);
  if (!touch) return;
  const dx = clamp(touch.clientX - originX, -JOYSTICK_RADIUS, JOYSTICK_RADIUS);
  const dy = clamp(touch.clientY - originY, -JOYSTICK_RADIUS, JOYSTICK_RADIUS);
  moveInput.turn = clamp(-dx / JOYSTICK_RADIUS, -1, 1);
  moveInput.forward = clamp(-dy / JOYSTICK_RADIUS, -1, 1);
  moveKnob(dx, dy);
  e.preventDefault();
}

function handleTouchEnd(e: TouchEvent) {
  let handled = false;
  for (let i = 0; i < e.changedTouches.length; i++) {
    const id = e.changedTouches[i].identifier;
    if (id === moveTouchId) {
      moveTouchId = null;
      touchActive = false;
      moveInput.forward = 0;
      moveInput.turn = 0;
      hideJoystick();
      handled = true;
    } else if (id === driftTouchId) {
      driftTouchId = null;
      handled = true;
    }
  }
  if (!handled) return;
  updateFromKeys();
}

if ('ontouchstart' in globalThis) {
  globalThis.addEventListener('touchstart', handleTouchStart, { passive: false });
  globalThis.addEventListener('touchmove', handleTouchMove, { passive: false });
  globalThis.addEventListener('touchend', handleTouchEnd, { passive: false });
  globalThis.addEventListener('touchcancel', handleTouchEnd, { passive: false });
}
