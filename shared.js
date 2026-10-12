// Helpers shared by the background worker, the popup and the options page.

export const DEFAULTS = {
  focus: 25, // minutes
  short: 5,
  long: 15,
  longEvery: 4, // focus sessions before a long break
  autoBreak: true,
  autoFocus: false,
  sound: true,
  notify: true,
  blockEnabled: false,
  blockList: [],
};

export const PHASES = {
  focus: { label: 'Focus', colour: '#d9453a' },
  short: { label: 'Short break', colour: '#2e9e6b' },
  long: { label: 'Long break', colour: '#3b7dd8' },
};

export async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULTS, ...settings };
}

// state = { phase, status: 'idle' | 'running' | 'paused', total, remaining, endTime, done }
// total and remaining are in milliseconds; done counts focus sessions in the current cycle.
export async function getState() {
  const { state } = await chrome.storage.local.get('state');
  if (state) return state;
  const total = (await getSettings()).focus * 60000;
  return { phase: 'focus', status: 'idle', total, remaining: total, endTime: null, done: 0 };
}

// stats = { 'YYYY-MM-DD': { count, minutes } }
export async function getStats() {
  const { stats } = await chrome.storage.local.get('stats');
  return stats || {};
}

export function remainingMs(state) {
  return state.status === 'running' ? Math.max(0, state.endTime - Date.now()) : state.remaining;
}

export function isBlocking(state, settings) {
  return settings.blockEnabled && settings.blockList.length > 0 &&
    state.phase === 'focus' && state.status !== 'idle';
}

export function dayKey(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function fmtMinutes(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function fmtClock(ms) {
  const secs = Math.ceil(ms / 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(Math.floor(secs / 60))}:${pad(secs % 60)}`;
}
