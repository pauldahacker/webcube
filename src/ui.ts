import { MAX_SPEED } from './constants';
import type { LeaderboardRow } from './net/leaderboard';

// The two floating name tags: 'player' over the yellow (own-best) ghost,
// 'rival' over the pink (leaderboard rival) ghost.
export type GhostTagId = 'player' | 'rival';

export type GameUI = {
  setTime(ms: number): void;
  showResult(ms: number, isNewBest: boolean): void;
  hideResult(): void;
  showPause(): void;
  hidePause(): void;
  setLeaderboard(rows: LeaderboardRow[]): void;
  setGhostTag(which: GhostTagId, screenX: number, screenY: number, name: string): void;
  hideGhostTag(which: GhostTagId): void;
  flashLapDelta(deltaMs: number | null): void;
  setSpeed(unitsPerSecond: number): void;
  showControls(): void;
  hideControls(): void;
};

export function createUI(onRestart: () => void, onMenu: () => void): GameUI {
  const root = document.getElementById('app');
  if (!root) throw new Error('#app root element not found');

  const timerEl = document.createElement('div');
  timerEl.className = 'timer';
  timerEl.textContent = formatTime(0);
  root.appendChild(timerEl);


  // Standings under the timer: the players just above you plus your own row.
  const leaderboardEl = document.createElement('div');
  leaderboardEl.className = 'leaderboard hidden';
  root.appendChild(leaderboardEl);

  // Floating name tags positioned each frame over their ghosts (main.ts).
  const ghostTagPlayer = document.createElement('div');
  ghostTagPlayer.className = 'ghost-tag player hidden';
  const ghostTagRival = document.createElement('div');
  ghostTagRival.className = 'ghost-tag rival hidden';
  root.append(ghostTagPlayer, ghostTagRival);
  const ghostTag = { player: ghostTagPlayer, rival: ghostTagRival };

  // Lap-finish banner: the time delta vs the previous PB, green/red, auto-fades.
  const bannerEl = document.createElement('div');
  bannerEl.className = 'lap-banner';
  root.appendChild(bannerEl);
  let bannerTimer = 0;

  // Controls hint - shown while idle, hidden once the player starts driving.
  // Touch devices get the thumb-zone hint; everyone else the keyboard keys.
  const isTouch = window.matchMedia('(pointer: coarse)').matches;
  const controlsEl = document.createElement('div');
  controlsEl.className = 'controls-hint';
  controlsEl.innerHTML = isTouch
    ? `<span class="controls-label">drag left side to move</span>` +
      `<span class="controls-label">hold right side to drift</span>`
    : `<span class="controls-label">to move</span>` +
      `<div class="controls-row">` +
      `<span class="key">W</span></div>` +
      `<div class="controls-row">` +
      `<span class="key">A</span><span class="key">S</span><span class="key">D</span></div>` +
      `<span class="controls-label">to drift</span>` +
      `<div class="controls-row">` +
      `<span class="key">Enter</span><span class="controls-label">/</span><span class="key">Shift</span></div>`;
  root.appendChild(controlsEl);

  // Speed gauge: a 3/4 ring (gap at the bottom) that fills white with
  // speed/MAX_SPEED over a gray track, with the number in the transparent hole.
  // Both arc paths use pathLength=100 so the fill is just a dasharray percent.
  const arc = 'M 28.79 71.21 A 30 30 0 1 1 71.21 71.21';
  const speedEl = document.createElement('div');
  speedEl.className = 'speed';
  speedEl.innerHTML =
    `<svg class="speed-gauge" viewBox="0 0 100 100">` +
    `<path class="speed-track" d="${arc}" pathLength="100" />` +
    `<path class="speed-fill" d="${arc}" pathLength="100" />` +
    `</svg><div class="speed-value">0</div>`;
  root.appendChild(speedEl);
  const speedFill = speedEl.querySelector('.speed-fill') as SVGPathElement;
  const speedValue = speedEl.querySelector('.speed-value') as HTMLDivElement;

  const resultEl = document.createElement('div');
  resultEl.className = 'result hidden';

  const resultTime = document.createElement('p');
  resultEl.appendChild(resultTime);

  const restartBtn = document.createElement('button');
  restartBtn.textContent = 'Restart';
  restartBtn.addEventListener('click', onRestart);
  resultEl.appendChild(restartBtn);

  root.appendChild(resultEl);

  const pauseEl = document.createElement('div');
  pauseEl.className = 'pause hidden';

  const pauseText = document.createElement('p');
  pauseText.textContent = 'Paused';
  pauseEl.appendChild(pauseText);

  const pauseRestartBtn = document.createElement('button');
  pauseRestartBtn.className = 'pause-restart-btn';
  pauseRestartBtn.textContent = 'Restart';
  pauseRestartBtn.addEventListener('click', onRestart);
  pauseEl.appendChild(pauseRestartBtn);

  // Menu lives here (not in the corner) - reachable only via pause.
  const pauseMenuBtn = document.createElement('button');
  pauseMenuBtn.className = 'pause-menu-btn';
  pauseMenuBtn.textContent = 'Menu';
  pauseMenuBtn.addEventListener('click', onMenu);
  pauseEl.appendChild(pauseMenuBtn);

  root.appendChild(pauseEl);

  return {
    setTime(ms: number) {
      timerEl.textContent = formatTime(ms);
    },
    showResult(ms: number, isNewBest: boolean) {
      resultTime.textContent = isNewBest
        ? `Finished in ${formatTime(ms)} — new best!`
        : `Finished in ${formatTime(ms)}`;
      resultEl.classList.remove('hidden');
    },
    hideResult() {
      resultEl.classList.add('hidden');
    },
    showPause() {
      pauseEl.classList.remove('hidden');
    },
    hidePause() {
      pauseEl.classList.add('hidden');
    },
    setLeaderboard(rows: LeaderboardRow[]) {
      if (rows.length === 0) {
        leaderboardEl.classList.add('hidden');
        return;
      }
      leaderboardEl.innerHTML = rows
        .map(
          (r) =>
            `<div class="lb-row${r.isUser ? ' me' : ''}">` +
            `<span class="lb-rank">${r.rank ?? '—'}</span>` +
            `<span class="lb-name">${escapeHtml(r.name)}</span>` +
            `<span class="lb-time">${r.timeMs === null ? '--:--.---' : formatTime(r.timeMs)}</span>` +
            `</div>`
        )
        .join('');
      leaderboardEl.classList.remove('hidden');
    },
    setGhostTag(which: GhostTagId, screenX: number, screenY: number, name: string) {
      const el = ghostTag[which];
      el.textContent = name;
      el.style.transform = `translate(-50%, -100%) translate(${screenX}px, ${screenY}px)`;
      el.classList.remove('hidden');
    },
    hideGhostTag(which: GhostTagId) {
      ghostTag[which].classList.add('hidden');
    },
    flashLapDelta(deltaMs: number | null) {
      clearTimeout(bannerTimer);
      // No banner on the first lap - there's no previous PB to compare against.
      if (deltaMs === null) {
        bannerEl.classList.remove('show');
        return;
      }
      const faster = deltaMs < 0;
      bannerEl.textContent = `${faster ? '-' : '+'}${formatTime(Math.abs(deltaMs))}`;
      bannerEl.className = `lap-banner ${faster ? 'faster' : 'slower'} show`;
      bannerTimer = window.setTimeout(() => bannerEl.classList.remove('show'), 2500);
    },
    setSpeed(unitsPerSecond: number) {
      const frac = Math.min(Math.max(unitsPerSecond / MAX_SPEED, 0), 1);
      speedFill.style.strokeDasharray = `${frac * 100} 100`;
      speedValue.textContent = `${Math.round(unitsPerSecond)}`;
    },
    showControls() {
      controlsEl.classList.remove('hidden');
    },
    hideControls() {
      controlsEl.classList.add('hidden');
    },
  };
}

// Names come from other players, so escape before going through innerHTML.
function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function formatTime(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const millis = Math.floor(ms % 1000);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}
