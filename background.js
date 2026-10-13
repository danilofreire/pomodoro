// Service worker: owns the timer. Chrome can stop it at any moment, so all
// state lives in chrome.storage and the clock runs on chrome.alarms.

import { PHASES, getSettings, getState, getStats, remainingMs, isBlocking, dayKey } from './shared.js';

// Run handlers one at a time so an alarm and a button click cannot interleave.
let queue = Promise.resolve();
const serial = (fn) => (queue = queue.catch(() => {}).then(fn));

function fresh(phase, settings, done, run = false) {
  const total = settings[phase] * 60000;
  return {
    phase,
    status: run ? 'running' : 'idle',
    total,
    remaining: total,
    endTime: run ? Date.now() + total : null,
    done,
  };
}

async function commit(state) {
  await chrome.storage.local.set({ state });
  await sync(state);
}

// Bring alarms, badge and site blocking in line with the state.
async function sync(state) {
  await chrome.alarms.clear('end');
  await chrome.alarms.clear('tick');
  if (state.status === 'running') {
    const rem = state.endTime - Date.now();
    chrome.alarms.create('end', { when: state.endTime });
    // Fires each time the minute shown on the badge changes.
    chrome.alarms.create('tick', { when: Date.now() + (rem % 60000 || 60000), periodInMinutes: 1 });
  }
  await updateBadge(state);
  await updateBlocking(state, await getSettings());
}

async function updateBadge(state) {
  let text = '';
  if (state.status === 'running') text = String(Math.ceil(remainingMs(state) / 60000));
  if (state.status === 'paused') text = 'II';
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color: PHASES[state.phase].colour });
  await chrome.action.setBadgeTextColor({ color: '#ffffff' });
}

// Move to the next phase. `completed` is false when the user skips.
async function advance(state, completed) {
  const settings = await getSettings();
  let { done } = state;
  let next = 'focus';
  if (state.phase === 'focus') {
    next = 'short';
    if (completed) {
      done += 1;
      await recordSession(state.total);
      if (done % settings.longEvery === 0) next = 'long';
    }
  } else if (state.phase === 'long') {
    done = 0;
  }
  const auto = next === 'focus' ? settings.autoFocus : settings.autoBreak;
  await commit(fresh(next, settings, done, auto));
  if (completed) {
    if (settings.notify) notify(state.phase, next, settings, auto);
    if (settings.sound) chime(state.phase);
  }
}

// A phase that ends this late means the computer slept or Chrome was closed.
const LATE_MS = 2 * 60000;

async function finish(state) {
  if (Date.now() - state.endTime <= LATE_MS) return advance(state, true);
  // Nobody was at the keyboard: do not count the session, and wait at a fresh focus phase.
  const done = state.phase === 'long' ? 0 : state.done;
  await commit(fresh('focus', await getSettings(), done));
}

async function recordSession(ms) {
  const stats = await getStats();
  const key = dayKey();
  const day = stats[key] || { count: 0, minutes: 0 };
  stats[key] = { count: day.count + 1, minutes: day.minutes + Math.round(ms / 60000) };
  await chrome.storage.local.set({ stats });
}

function notify(finished, next, settings, auto) {
  const breakLabel = `${settings[next]}-minute ${next === 'long' ? 'long ' : ''}break`;
  const options = {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: finished === 'focus' ? 'Focus session done' : 'Break over',
    message: finished === 'focus' ? `Time for a ${breakLabel}.` : 'Ready for another focus session?',
    priority: 2,
  };
  if (!auto) options.buttons = [{ title: next === 'focus' ? 'Start focus' : 'Start break' }];
  chrome.notifications.clear('pomodoro', () => chrome.notifications.create('pomodoro', options));
}

// Service workers cannot play audio, so a short-lived offscreen page does it.
async function chime(finished) {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: `offscreen.html#${finished}`,
    reasons: ['AUDIO_PLAYBACK'],
    justification: 'Play a chime when a session ends',
  });
}

// Redirect blocked sites to blocked.html while a focus session is on.
// The original address travels in the URL hash so the page can go back to it.
async function updateBlocking(state, settings) {
  const active = isBlocking(state, settings);
  const blockedPage = chrome.runtime.getURL('blocked.html');
  const old = await chrome.declarativeNetRequest.getDynamicRules();
  const addRules = !active ? [] : settings.blockList.map((domain, i) => ({
    id: i + 1,
    priority: 1,
    action: { type: 'redirect', redirect: { regexSubstitution: `${blockedPage}#\\0` } },
    condition: {
      regexFilter: `^https?://([^/]*\\.)?${domain.replaceAll('.', '\\.')}(:\\d+)?(/.*)?$`,
      resourceTypes: ['main_frame'],
    },
  }));
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: old.map((r) => r.id), addRules });
  if (!active) return;
  // The rules only catch new page loads, so also move tabs that are already open.
  const patterns = settings.blockList.flatMap((d) => [`*://${d}/*`, `*://*.${d}/*`]);
  for (const tab of await chrome.tabs.query({ url: patterns })) {
    chrome.tabs.update(tab.id, { url: `${blockedPage}#${tab.url}` }).catch(() => {});
  }
}

const actions = {
  async start() {
    const state = await getState();
    if (state.status === 'running') return;
    await commit({ ...state, status: 'running', endTime: Date.now() + state.remaining });
  },
  async pause() {
    const state = await getState();
    if (state.status !== 'running') return;
    await commit({ ...state, status: 'paused', remaining: remainingMs(state), endTime: null });
  },
  async toggle() {
    const state = await getState();
    return state.status === 'running' ? actions.pause() : actions.start();
  },
  async reset() {
    const state = await getState();
    await commit(fresh(state.phase, await getSettings(), state.done));
  },
  async skip() {
    await advance(await getState(), false);
  },
  async setPhase({ phase }) {
    if (!PHASES[phase]) return;
    const state = await getState();
    await commit(fresh(phase, await getSettings(), state.done));
  },
  async testSound() {
    await chime('focus');
  },
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!actions[msg?.cmd]) return;
  serial(() => actions[msg.cmd](msg)).then(() => sendResponse(true));
  return true; // keep the channel open for the async reply
});

chrome.alarms.onAlarm.addListener(() => serial(async () => {
  const state = await getState();
  if (state.status !== 'running') return;
  if (state.endTime - Date.now() > 500) return updateBadge(state);
  await finish(state);
}));

chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-timer') serial(actions.toggle);
});

chrome.notifications.onButtonClicked.addListener((id) => {
  if (id !== 'pomodoro') return;
  chrome.notifications.clear(id);
  serial(actions.start);
});

chrome.notifications.onClicked.addListener((id) => chrome.notifications.clear(id));

// New durations apply at once to a timer that has not started.
chrome.storage.onChanged.addListener((changes) => {
  if (!changes.settings) return;
  serial(async () => {
    const state = await getState();
    if (state.status === 'idle') await commit(fresh(state.phase, await getSettings(), state.done));
    else await sync(state);
  });
});

// After a browser restart or an update, catch up with the stored state.
const restore = () => serial(async () => {
  const state = await getState();
  if (state.status === 'running' && state.endTime <= Date.now()) await finish(state);
  else await sync(state);
});
chrome.runtime.onStartup.addListener(restore);
chrome.runtime.onInstalled.addListener(restore);
