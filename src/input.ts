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
const KEY_DRIFT = ['Enter'];

let touchActive = false;

function isDown(names: string[]): boolean {
  return names.some((name) => keys[name]);
}

function updateFromKeys() {
  // Drift tracks the Enter key regardless of touch state - it's a modifier,
  // not a movement axis, so it isn't superseded by the joystick.
  moveInput.drift = isDown(KEY_DRIFT);
  if (touchActive) return;
  moveInput.forward = (isDown(KEY_FORWARD) ? 1 : 0) - (isDown(KEY_BACK) ? 1 : 0);
  moveInput.turn = (isDown(KEY_LEFT) ? 1 : 0) - (isDown(KEY_RIGHT) ? 1 : 0);
}

globalThis.addEventListener('keydown', (e) => {
  keys[e.key] = true;
  updateFromKeys();
});
globalThis.addEventListener('keyup', (e) => {
  keys[e.key] = false;
  updateFromKeys();
});

// Touch joystick: drag anywhere to move (vertical = forward/back, horizontal = turn).
const JOYSTICK_RADIUS = 60;

let touchId: number | null = null;
let originX = 0;
let originY = 0;
let joystickEl: HTMLDivElement | null = null;
let knobEl: HTMLDivElement | null = null;

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
  if (touchId !== null) return;
  const touch = e.changedTouches[0];
  touchId = touch.identifier;
  touchActive = true;
  originX = touch.clientX;
  originY = touch.clientY;
  showJoystick(originX, originY);
  e.preventDefault();
}

function handleTouchMove(e: TouchEvent) {
  const touch = findTouch(e.touches, touchId);
  if (!touch) return;
  const dx = clamp(touch.clientX - originX, -JOYSTICK_RADIUS, JOYSTICK_RADIUS);
  const dy = clamp(touch.clientY - originY, -JOYSTICK_RADIUS, JOYSTICK_RADIUS);
  moveInput.turn = clamp(-dx / JOYSTICK_RADIUS, -1, 1);
  moveInput.forward = clamp(-dy / JOYSTICK_RADIUS, -1, 1);
  moveKnob(dx, dy);
  e.preventDefault();
}

function handleTouchEnd(e: TouchEvent) {
  const touch = findTouch(e.changedTouches, touchId);
  if (!touch) return;
  touchId = null;
  touchActive = false;
  moveInput.forward = 0;
  moveInput.turn = 0;
  hideJoystick();
  updateFromKeys();
}

if ('ontouchstart' in globalThis) {
  globalThis.addEventListener('touchstart', handleTouchStart, { passive: false });
  globalThis.addEventListener('touchmove', handleTouchMove, { passive: false });
  globalThis.addEventListener('touchend', handleTouchEnd, { passive: false });
  globalThis.addEventListener('touchcancel', handleTouchEnd, { passive: false });
}
