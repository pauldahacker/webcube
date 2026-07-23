import { loadRecord } from './records';
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

export function renderHome(tracks: TrackDef[]): void {
  const home = document.createElement('div');
  home.className = 'home';

  const title = document.createElement('h1');
  title.className = 'home-title';
  title.textContent = 'Iced';
  home.appendChild(title);

  const subtitle = document.createElement('p');
  subtitle.className = 'home-subtitle';
  subtitle.textContent = 'Select a track';
  home.appendChild(subtitle);

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
    item.addEventListener('click', () => {
      location.href = location.pathname + '?track=' + encodeURIComponent(track.url);
    });
    list.appendChild(item);
  }
  home.appendChild(list);
  document.body.appendChild(home);
}

// In-game button (top-left) that returns to the home page.
export function createMenuButton(): void {
  const btn = document.createElement('button');
  btn.className = 'menu-btn';
  btn.textContent = 'Menu';
  btn.addEventListener('click', () => {
    location.href = location.pathname;
  });
  document.body.appendChild(btn);
}
