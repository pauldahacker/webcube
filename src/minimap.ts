import type { BuiltTrack } from './track';
import { projectTrack } from './trackmap';

export type MinimapDot = { x: number; z: number } | null;

export type Minimap = {
  update(px: number, pz: number, own: MinimapDot, rival: MinimapDot): void;
};

// Fixed top-down map, top-left, with dots for the player and the two ghosts.
export function createMinimap(track: BuiltTrack): Minimap {
  const proj = projectTrack(track, 160, 160, 8);
  const wrap = document.createElement('div');
  wrap.className = 'minimap';
  wrap.innerHTML =
    `<svg viewBox="0 0 ${proj.w.toFixed(1)} ${proj.h.toFixed(1)}">` +
    `<path d="${proj.ribbonD}" class="mm-road"/>` +
    `<path d="${proj.pathD}" class="mm-track"/>` +
    `<circle class="mm-dot mm-own" r="3"/>` +
    `<circle class="mm-dot mm-rival" r="3"/>` +
    `<circle class="mm-dot mm-player" r="4.5"/>` +
    `</svg>`;
  document.body.appendChild(wrap);
  const ownEl = wrap.querySelector('.mm-own') as SVGCircleElement;
  const rivalEl = wrap.querySelector('.mm-rival') as SVGCircleElement;
  const playerEl = wrap.querySelector('.mm-player') as SVGCircleElement;

  function place(el: SVGCircleElement, dot: MinimapDot) {
    if (!dot) {
      el.style.display = 'none';
      return;
    }
    const p = proj.to(dot.x, dot.z);
    el.setAttribute('cx', p.x.toFixed(1));
    el.setAttribute('cy', p.y.toFixed(1));
    el.style.display = '';
  }

  return {
    update(px, pz, own, rival) {
      place(playerEl, { x: px, z: pz });
      place(ownEl, own);
      place(rivalEl, rival);
    },
  };
}
