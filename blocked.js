import { getSettings, getState, remainingMs, isBlocking, fmtClock } from './shared.js';

// The background worker puts the address that was blocked in the URL hash.
let original = null;
try {
  const url = new URL(location.hash.slice(1));
  if (url.protocol === 'http:' || url.protocol === 'https:') original = url;
} catch {}

if (original) document.getElementById('host').textContent = original.hostname.replace(/^www\./, '');

let state;

async function load() {
  state = await getState();
  // Go back to the site as soon as blocking stops.
  if (!isBlocking(state, await getSettings()) && original) location.replace(original.href);
  render();
}

function render() {
  if (!state) return;
  document.getElementById('time').textContent = fmtClock(remainingMs(state));
  document.getElementById('hint').textContent =
    state.status === 'paused' ? 'The timer is paused' : 'The page will reopen by itself';
}

chrome.storage.onChanged.addListener(load);
setInterval(render, 250);
load();
