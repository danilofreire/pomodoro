import { getSettings, getState, getStats, remainingMs, dayKey, fmtMinutes, fmtClock } from './shared.js';

const $ = (id) => document.getElementById(id);
const CIRCUMFERENCE = 2 * Math.PI * 88; // matches r="88" in popup.html
const LABELS = { idle: 'Start', running: 'Pause', paused: 'Resume' };

let state, settings, stats;

async function load() {
  [state, settings, stats] = await Promise.all([getState(), getSettings(), getStats()]);
  render();
}

function render() {
  if (!state) return;
  const rem = remainingMs(state);
  document.body.dataset.phase = state.phase;
  $('time').textContent = fmtClock(rem);
  $('toggle').textContent = LABELS[state.status];

  const ring = $('ring');
  ring.style.strokeDasharray = CIRCUMFERENCE;
  ring.style.strokeDashoffset = CIRCUMFERENCE * (1 - rem / state.total);

  let hint = 'Ready';
  if (state.status === 'paused') hint = 'Paused';
  if (state.status === 'running') {
    const end = new Date(state.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    hint = `Ends at ${end}`;
  }
  $('hint').textContent = hint;

  for (const btn of document.querySelectorAll('.phases button')) {
    btn.setAttribute('aria-pressed', btn.dataset.phase === state.phase);
  }

  const dots = $('dots');
  if (dots.children.length !== settings.longEvery) {
    dots.replaceChildren(...Array.from({ length: settings.longEvery }, () => document.createElement('span')));
  }
  [...dots.children].forEach((dot, i) => dot.classList.toggle('done', i < state.done));

  const today = stats[dayKey()] || { count: 0, minutes: 0 };
  $('today').textContent = today.count === 0
    ? 'No sessions yet today'
    : `Today: ${today.count} ${today.count === 1 ? 'session' : 'sessions'}, ${fmtMinutes(today.minutes)}`;
}

const send = (cmd, extra = {}) => chrome.runtime.sendMessage({ cmd, ...extra });

$('toggle').addEventListener('click', () => send('toggle'));
$('reset').addEventListener('click', () => send('reset'));
$('skip').addEventListener('click', () => send('skip'));
$('options').addEventListener('click', () => chrome.runtime.openOptionsPage());
for (const btn of document.querySelectorAll('.phases button')) {
  btn.addEventListener('click', () => send('setPhase', { phase: btn.dataset.phase }));
}

// The background worker owns the timer; the popup only redraws what is stored.
chrome.storage.onChanged.addListener(load);
setInterval(render, 250);
load();
