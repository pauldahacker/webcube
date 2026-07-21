// In-game music loader for auditioning tracks. Files are read locally in the
// browser (object URLs) - nothing is uploaded and no backend is involved, so
// the composer can just drop their mp3s in and hear them against gameplay.
// Multiple files queue into a looping playlist.

export function createMusicPlayer(): void {
  const audio = new Audio();
  audio.volume = 0.5;

  type Track = { name: string; url: string };
  const playlist: Track[] = [];
  let current = -1;

  function button(label: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = label;
    b.className = 'music-btn';
    return b;
  }

  const panel = document.createElement('div');
  panel.className = 'music';

  const loadLabel = document.createElement('label');
  loadLabel.className = 'music-load';
  loadLabel.textContent = '♪ Load tracks';
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'audio/*';
  fileInput.multiple = true;
  loadLabel.appendChild(fileInput);

  const title = document.createElement('div');
  title.className = 'music-title';
  title.textContent = 'No track loaded (or drop files anywhere)';

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
  volume.value = String(audio.volume);
  volume.className = 'music-volume';
  controls.append(prevBtn, playBtn, nextBtn, volume);

  panel.append(loadLabel, title, controls);
  document.body.appendChild(panel);

  function playIndex(i: number) {
    if (playlist.length === 0) return;
    current = ((i % playlist.length) + playlist.length) % playlist.length;
    audio.src = playlist[current].url;
    audio.play().catch(() => {});
    title.textContent = playlist[current].name;
    playBtn.textContent = '❙❙';
  }

  function addFiles(files: FileList | File[]) {
    const audioFiles = Array.from(files).filter((f) => f.type.startsWith('audio/'));
    if (audioFiles.length === 0) return;
    const wasEmpty = playlist.length === 0;
    for (const f of audioFiles) playlist.push({ name: f.name, url: URL.createObjectURL(f) });
    if (wasEmpty) playIndex(0);
  }

  fileInput.addEventListener('change', () => {
    if (fileInput.files) addFiles(fileInput.files);
    fileInput.value = ''; // let the same file be picked again
  });

  playBtn.addEventListener('click', () => {
    if (current === -1) {
      playIndex(0);
    } else if (audio.paused) {
      audio.play().catch(() => {});
      playBtn.textContent = '❙❙';
    } else {
      audio.pause();
      playBtn.textContent = '▶';
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
    audio.volume = Number(volume.value);
  });

  // Auto-advance, wrapping back to the start so the playlist loops forever.
  audio.addEventListener('ended', () => playIndex(current + 1));

  // Drag-and-drop audio files anywhere on the page.
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer?.files) addFiles(e.dataTransfer.files);
  });
}
