// In-game music loader for auditioning tracks. Files are read locally in the
// browser - nothing is uploaded and no backend is involved, so the composer
// can just drop their mp3s in and hear them against gameplay.
//
// Playback uses the Web Audio API (not an <audio> element) so a single track
// loops GAPLESSLY: an AudioBufferSourceNode with loop=true restarts sample-
// accurately, unlike <audio> which reloads the source and stutters at the seam.

export type MusicPlayer = {
  setPaused(paused: boolean): void;
};

// The in-app track loader (file picker + drag-drop) is hidden from players.
// Flip to true to audition local mp3s against gameplay - it stays in the code
// so it's a one-line toggle, never shown to end users when false.
const SHOW_TRACK_LOADER = false;

export function createMusicPlayer(): MusicPlayer {
  const ctx = new AudioContext();
  const gain = ctx.createGain();
  gain.gain.value = 0.5;
  gain.connect(ctx.destination);

  // load() defers reading the bytes; buffer caches the decoded audio.
  type Track = { name: string; load: () => Promise<ArrayBuffer>; buffer?: AudioBuffer };
  const playlist: Track[] = [];
  let current = -1;
  let hasUserTracks = false;
  let source: AudioBufferSourceNode | null = null;
  let started = false; // has playback begun at least once

  function button(label: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = label;
    b.className = 'music-btn';
    return b;
  }

  const panel = document.createElement('div');
  panel.className = 'music';

  const title = document.createElement('div');
  title.className = 'music-title';
  title.textContent = 'No track loaded';

  const controls = document.createElement('div');
  controls.className = 'music-controls';
  const prevBtn = button('⏮');
  const playBtn = button('▶');
  const nextBtn = button('⏭');
  const volume = document.createElement('input');
  volume.type = 'range';
  volume.min = '0';
  volume.max = '1';
  volume.step = '0.01';
  volume.value = String(gain.gain.value);
  volume.className = 'music-volume';
  controls.append(prevBtn, playBtn, nextBtn, volume);

  panel.append(title, controls);
  document.body.appendChild(panel);

  // Hidden track loader: the sound team drops in mp3s to audition them against
  // gameplay. Off for players; flip SHOW_TRACK_LOADER to re-enable.
  if (SHOW_TRACK_LOADER) {
    const loadLabel = document.createElement('label');
    loadLabel.className = 'music-load';
    loadLabel.textContent = '♪ Load tracks';
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'audio/*';
    fileInput.multiple = true;
    loadLabel.appendChild(fileInput);
    panel.prepend(loadLabel);
    fileInput.addEventListener('change', () => {
      if (fileInput.files) addFiles(fileInput.files);
      fileInput.value = ''; // let the same file be picked again
    });
    // Drag-and-drop audio files anywhere on the page.
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      if (e.dataTransfer?.files) addFiles(e.dataTransfer.files);
    });
  }

  function stopSource() {
    if (source) {
      source.onended = null; // so stopping doesn't fire the auto-advance
      try {
        source.stop();
      } catch {
        // already stopped
      }
      source.disconnect();
      source = null;
    }
  }

  async function decode(track: Track): Promise<AudioBuffer> {
    if (!track.buffer) track.buffer = await ctx.decodeAudioData(await track.load());
    return track.buffer;
  }

  async function playIndex(i: number) {
    if (playlist.length === 0) return;
    current = ((i % playlist.length) + playlist.length) % playlist.length;
    const track = playlist[current];
    const buffer = await decode(track);
    // A newer play() may have superseded this one while decoding.
    if (playlist[current] !== track) return;

    stopSource();
    source = ctx.createBufferSource();
    source.buffer = buffer;
    // A lone track loops on itself (gapless); a real playlist advances instead.
    source.loop = playlist.length === 1;
    source.connect(gain);
    source.onended = () => playIndex(current + 1);
    if (ctx.state === 'suspended') await ctx.resume();
    source.start();
    started = true;
    title.textContent = track.name;
    playBtn.textContent = '❙❙';
  }

  function addFiles(files: FileList | File[]) {
    const audioFiles = Array.from(files).filter((f) => f.type.startsWith('audio/'));
    if (audioFiles.length === 0) return;
    // The first upload replaces the built-in default with the user's tracks.
    const replacingDefault = !hasUserTracks;
    if (replacingDefault) {
      playlist.length = 0;
      hasUserTracks = true;
    }
    const firstNew = playlist.length;
    for (const f of audioFiles) playlist.push({ name: f.name, load: () => f.arrayBuffer() });
    if (replacingDefault || current === -1) playIndex(firstNew);
  }

  playBtn.addEventListener('click', () => {
    if (!started) {
      playIndex(current === -1 ? 0 : current);
    } else if (ctx.state === 'running') {
      ctx.suspend();
      playBtn.textContent = '▶';
    } else {
      ctx.resume();
      playBtn.textContent = '❙❙';
    }
    playBtn.blur(); // so Space doesn't re-toggle it while driving
  });
  prevBtn.addEventListener('click', () => {
    playIndex(current - 1);
    prevBtn.blur();
  });
  nextBtn.addEventListener('click', () => {
    playIndex(current + 1);
    nextBtn.blur();
  });
  volume.addEventListener('input', () => {
    gain.gain.value = Number(volume.value);
  });

  // Built-in default track: queued but not played yet (browsers block audio
  // until a user gesture). It starts on the first interaction with the page -
  // e.g. pressing a key to drive - unless the user has uploaded their own.
  playlist.push({ name: '1st (default)', load: () => fetch('/music/1st.mp3').then((r) => r.arrayBuffer()) });
  current = 0;
  title.textContent = playlist[0].name;

  let autoStarted = false;
  function tryAutoStart(e: Event) {
    if (autoStarted) return;
    // Let clicks on the panel's own controls be handled by their buttons.
    if (e.target instanceof Node && panel.contains(e.target)) return;
    autoStarted = true;
    window.removeEventListener('keydown', tryAutoStart);
    window.removeEventListener('pointerdown', tryAutoStart);
    if (!started) playIndex(current);
  }
  window.addEventListener('keydown', tryAutoStart);
  window.addEventListener('pointerdown', tryAutoStart);

  return {
    setPaused(paused: boolean) {
      if (!started) return;
      if (paused) {
        ctx.suspend();
        playBtn.textContent = '▶';
      } else {
        ctx.resume();
        playBtn.textContent = '❙❙';
      }
    },
  };
}
