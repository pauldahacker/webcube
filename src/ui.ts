export type GameUI = {
  setTime(ms: number): void;
  showResult(ms: number, isNewBest: boolean): void;
  hideResult(): void;
  showPause(): void;
  hidePause(): void;
  setBestTime(ms: number): void;
  setSpeed(unitsPerSecond: number): void;
};

export function createUI(onRestart: () => void): GameUI {
  const root = document.getElementById('app');
  if (!root) throw new Error('#app root element not found');

  const timerEl = document.createElement('div');
  timerEl.className = 'timer';
  timerEl.textContent = formatTime(0);
  root.appendChild(timerEl);

  const bestTimeEl = document.createElement('div');
  bestTimeEl.className = 'best-time';
  bestTimeEl.textContent = 'Best: --:--.---';
  root.appendChild(bestTimeEl);

  const speedEl = document.createElement('div');
  speedEl.className = 'speed';
  speedEl.textContent = '0';
  root.appendChild(speedEl);

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
    setBestTime(ms: number) {
      bestTimeEl.textContent = `Best: ${formatTime(ms)}`;
    },
    setSpeed(unitsPerSecond: number) {
      speedEl.textContent = `${Math.round(unitsPerSecond)}`;
    },
  };
}

function formatTime(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const millis = Math.floor(ms % 1000);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}
