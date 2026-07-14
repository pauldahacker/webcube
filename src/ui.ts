export type GameUI = {
  setTime(ms: number): void;
  showResult(ms: number): void;
  hideResult(): void;
};

export function createUI(onRestart: () => void): GameUI {
  const root = document.getElementById('app');
  if (!root) throw new Error('#app root element not found');

  const timerEl = document.createElement('div');
  timerEl.className = 'timer';
  timerEl.textContent = formatTime(0);
  root.appendChild(timerEl);

  const resultEl = document.createElement('div');
  resultEl.className = 'result hidden';

  const resultTime = document.createElement('p');
  resultEl.appendChild(resultTime);

  const restartBtn = document.createElement('button');
  restartBtn.textContent = 'Restart';
  restartBtn.addEventListener('click', onRestart);
  resultEl.appendChild(restartBtn);

  root.appendChild(resultEl);

  return {
    setTime(ms: number) {
      timerEl.textContent = formatTime(ms);
    },
    showResult(ms: number) {
      resultTime.textContent = `Finished in ${formatTime(ms)}`;
      resultEl.classList.remove('hidden');
    },
    hideResult() {
      resultEl.classList.add('hidden');
    },
  };
}

function formatTime(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const millis = Math.floor(ms % 1000);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}
