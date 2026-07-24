// Procedural drift SFX: an icy scrape synthesized live from slip and speed, so
// it swells and pitches with the actual slide - no audio files to ship or license.

// Just the state the scrape reads; PlayerState satisfies this structurally.
type SfxInput = { vx: number; vz: number; heading: number; isSliding: boolean };

// --- Tuning (the knobs to taste) -------------------------------------------
const SCRAPE_BASE_FREQ = 1600; // bandpass center at low speed (Hz) - the scrape's pitch
const SCRAPE_FREQ_PER_SPEED = 30; // center freq added per unit of speed
const SCRAPE_MAX_FREQ = 5000;
const SCRAPE_Q = 0.8; // filter resonance - higher = more tonal/whistly, lower = airier hiss
const SCRAPE_MAX_GAIN = 0.35; // loudest the scrape ever gets
const SLIP_FULL_DEG = 30; // slip angle (deg) at which the scrape reaches full volume
const SMOOTHING = 0.05; // seconds for gain/pitch to chase their target - stops clicks

export type Sfx = {
  update(state: SfxInput): void;
  setPaused(paused: boolean): void;
};

export function createSfx(): Sfx {
  const ctx = new AudioContext();

  // Two seconds of looping white noise is the raw scrape material.
  const noise = ctx.createBufferSource();
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  noise.buffer = buffer;
  noise.loop = true;

  // Bandpass shapes the flat hiss into an icy scrape; the gain node is its volume.
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = SCRAPE_BASE_FREQ;
  filter.Q.value = SCRAPE_Q;

  const gain = ctx.createGain();
  gain.gain.value = 0;

  noise.connect(filter).connect(gain).connect(ctx.destination);
  noise.start();

  let paused = false;

  // Browsers start the context suspended until a user gesture; driving is itself
  // a keypress, so resuming on the first gesture means sound is ready in time.
  function unlock() {
    if (ctx.state === 'suspended') void ctx.resume();
    window.removeEventListener('keydown', unlock);
    window.removeEventListener('pointerdown', unlock);
  }
  window.addEventListener('keydown', unlock);
  window.addEventListener('pointerdown', unlock);

  return {
    update(state: SfxInput) {
      const now = ctx.currentTime;

      // Slip: how far velocity points away from the heading (same basis as the sim).
      const fx = -Math.sin(state.heading);
      const fz = -Math.cos(state.heading);
      const rx = Math.cos(state.heading);
      const rz = -Math.sin(state.heading);
      const vForward = state.vx * fx + state.vz * fz;
      const vLateral = state.vx * rx + state.vz * rz;
      const slipDeg = Math.atan2(Math.abs(vLateral), Math.abs(vForward)) * (180 / Math.PI);
      const speed = Math.hypot(state.vx, state.vz);

      // Only a real slide sounds; volume tracks slip depth, pitch tracks speed.
      const slide = state.isSliding ? Math.min(slipDeg / SLIP_FULL_DEG, 1) : 0;
      const targetGain = paused ? 0 : slide * SCRAPE_MAX_GAIN;
      const targetFreq = Math.min(SCRAPE_BASE_FREQ + speed * SCRAPE_FREQ_PER_SPEED, SCRAPE_MAX_FREQ);

      gain.gain.setTargetAtTime(targetGain, now, SMOOTHING);
      filter.frequency.setTargetAtTime(targetFreq, now, SMOOTHING);
    },
    setPaused(p: boolean) {
      paused = p;
    },
  };
}
