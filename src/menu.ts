import { loadRecord } from './records';
import { loadMap } from './map';
import { buildTrack } from './track';
import { playerName, setPlayerName } from './net/identity';
import { submitName, fetchLeaderboard, fetchMyStanding } from './net/leaderboard';
import type { LeaderboardEntry } from './net/leaderboard';
import { projectTrack } from './trackmap';
import type { TrackProjection } from './trackmap';
import type { TrackDef } from './tracks';

// The home/landing page (track select) and the in-game back-to-menu button.
// Picking a track loads the game at ?track=<url> - a fresh scene per track.

function formatMs(ms: number): string {
  const total = Math.max(0, ms);
  const m = Math.floor(total / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const millis = Math.floor(total % 1000);
  return `${m}:${s.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`;
}

// Built once per track, reused across hovers.
const previewCache = new Map<string, { proj: TrackProjection; start: { x: number; z: number } }>();

async function getPreview(url: string): Promise<{ proj: TrackProjection; start: { x: number; z: number } }> {
  const cached = previewCache.get(url);
  if (cached) return cached;
  const map = await loadMap(url);
  const entry = { proj: projectTrack(buildTrack(map.track, map.closedLoop), 300, 300, 12), start: { x: map.start.x, z: map.start.z } };
  previewCache.set(url, entry);
  return entry;
}

function previewSvg(proj: TrackProjection, start: { x: number; z: number }): string {
  const s = proj.to(start.x, start.z);
  return (
    `<svg viewBox="0 0 ${proj.w.toFixed(1)} ${proj.h.toFixed(1)}" class="tov-map-svg">` +
    `<path d="${proj.ribbonD}" class="tov-road"/>` +
    `<path d="${proj.pathD}" class="tov-center"/>` +
    `<circle cx="${s.x.toFixed(1)}" cy="${s.y.toFixed(1)}" r="4" class="tov-start"/>` +
    `</svg>`
  );
}

function rowsHtml(rows: LeaderboardEntry[]): string {
  if (rows.length === 0) return '<div class="tov-empty">No times yet</div>';
  return rows
    .map(
      (r, i) =>
        `<div class="tov-row"><span class="tov-rank">${i + 1}</span>` +
        `<span class="tov-name">${escapeHtml(r.name)}</span>` +
        `<span class="tov-time">${formatMs(r.timeMs)}</span></div>`
    )
    .join('');
}

function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

export function renderHome(tracks: TrackDef[]): void {
  const home = document.createElement('div');
  home.className = 'home';

  const title = document.createElement('h1');
  title.className = 'home-title';
  title.textContent = 'ice cube';
  home.appendChild(title);

  // Username editor: persists on change (blur/Enter); the input reflects back
  // the normalized value (trimmed/clamped, or a fresh Guest-##### if cleared).
  const player = document.createElement('div');
  player.className = 'home-player';
  const playerLabel = document.createElement('label');
  playerLabel.className = 'home-player-label';
  playerLabel.textContent = 'Racing as';
  const nameInput = document.createElement('input');
  nameInput.className = 'home-player-input';
  nameInput.type = 'text';
  nameInput.maxLength = 24;
  nameInput.spellcheck = false;
  nameInput.value = playerName();
  nameInput.addEventListener('change', () => {
    setPlayerName(nameInput.value);
    nameInput.value = playerName();
    // Propagate to every board at once (no-ops offline / before deploy).
    void submitName(playerName());
  });
  playerLabel.appendChild(nameInput);
  player.appendChild(playerLabel);
  home.appendChild(player);

  const subtitle = document.createElement('p');
  subtitle.className = 'home-subtitle';
  subtitle.textContent = 'Select a track';
  home.appendChild(subtitle);

  // Hover overlay on the right: top-10 leaderboard stacked over a 2D map preview.
  const overlay = document.createElement('div');
  overlay.className = 'track-overlay hidden';
  const lbEl = document.createElement('div');
  lbEl.className = 'track-overlay-lb';
  const mapEl = document.createElement('div');
  mapEl.className = 'track-overlay-map';
  overlay.append(lbEl, mapEl);
  home.appendChild(overlay);

  // A token guards against a slower fetch from a previous hover overwriting a
  // newer one.
  let hoverToken = 0;
  function showOverlay(track: TrackDef) {
    const token = ++hoverToken;
    overlay.classList.remove('hidden');
    lbEl.innerHTML = `<div class="tov-title">${escapeHtml(track.name)}</div><div class="tov-empty">Loading…</div>`;
    mapEl.innerHTML = '';
    void getPreview(track.url)
      .then((pv) => { if (token === hoverToken) mapEl.innerHTML = previewSvg(pv.proj, pv.start); })
      .catch(() => {});
    void fetchLeaderboard(track.url, track.version ?? 1, 10)
      .then((rows) => { if (token === hoverToken) lbEl.innerHTML = `<div class="tov-title">${escapeHtml(track.name)}</div>` + rowsHtml(rows); })
      .catch(() => {});
  }

  const list = document.createElement('div');
  list.className = 'track-list';
  for (const track of tracks) {
    const record = loadRecord(track.url);
    const item = document.createElement('button');
    item.className = 'track-item';
    const name = document.createElement('span');
    name.className = 'track-name';
    name.textContent = track.name;
    const best = document.createElement('span');
    best.className = 'track-best';
    best.textContent = record ? formatMs(record.timeMs) : '—';
    item.append(name, best);
    // For a track the player has a time on, show their rank out of the field
    // (fetched from the board; stays hidden offline or before it resolves).
    if (record) {
      const rank = document.createElement('span');
      rank.className = 'track-rank';
      best.append(rank);
      void fetchMyStanding(track.url, track.version ?? 1, record.timeMs).then((s) => {
        if (s) rank.textContent = `#${s.rank} / ${s.total}`;
      });
    }
    item.addEventListener('click', () => {
      location.href = location.pathname + '?track=' + encodeURIComponent(track.url);
    });
    item.addEventListener('mouseenter', () => showOverlay(track));
    list.appendChild(item);
  }
  list.addEventListener('mouseleave', () => {
    hoverToken++;
    overlay.classList.add('hidden');
  });
  home.appendChild(list);
  document.body.appendChild(home);
}

// In-game top-left pause/resume button. (Menu now lives in the pause overlay.)
// Returns a handle to sync the icon with the paused state (e.g. Space toggles).
export function createPauseButton(onPause: () => void): { setPaused(paused: boolean): void } {
  const bar = document.createElement('div');
  bar.className = 'top-bar';

  const pauseBtn = document.createElement('button');
  pauseBtn.className = 'pause-btn';
  pauseBtn.textContent = '❙❙';
  pauseBtn.setAttribute('aria-label', 'Pause');
  pauseBtn.addEventListener('click', () => {
    onPause();
    pauseBtn.blur(); // so Space doesn't re-trigger it while driving
  });
  bar.appendChild(pauseBtn);

  document.body.appendChild(bar);
  return {
    setPaused(paused: boolean) {
      pauseBtn.textContent = paused ? '▶' : '❙❙';
      pauseBtn.setAttribute('aria-label', paused ? 'Resume' : 'Pause');
    },
  };
}

// Navigate back to the home/landing page (track select).
export function goHome(): void {
  location.href = location.pathname;
}
