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
  if (!state.waiting) chrome.notifications.clear('pomodoro');
  await updateBadge(state);
  await updateBlocking(state, await getSettings());
}

async function updateBadge(state) {
  let text = '';
  if (state.status === 'running') text = String(Math.ceil(remainingMs(state) / 60000));
  if (state.status === 'paused') text = 'II';
  if (state.waiting) text = '!';
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
  const nextState = fresh(next, settings, done, auto);
  // `waiting` marks a finished phase whose successor needs the user's go-ahead.
  if (completed && !auto) nextState.waiting = { finished: state.phase, minutes: Math.round(state.total / 60000) };
  await commit(nextState);
  if (completed) {
    if (settings.notify) notify(nextState, settings);
    if (settings.sound) chime(state.phase);
    toast(nextState);
  }
}

// A phase that ends this late means the computer slept or Chrome was closed.
const LATE_MS = 2 * 60000;

async function finish(state) {
  if (Date.now() - state.endTime <= LATE_MS) return advance(state, true);
  // Nobody was at the keyboard: wait at a fresh focus phase, whatever the settings say.
  const settings = await getSettings();
  const done = state.phase === 'long' ? 0 : state.done;
  const next = fresh('focus', settings, done);
  // A late focus session is not counted. A late break still ends with the usual notice.
  if (state.phase !== 'focus') next.waiting = { finished: state.phase, late: true };
  await commit(next);
  if (next.waiting) {
    if (settings.notify) notify(next, settings);
    toast(next);
  }
}

async function recordSession(ms) {
  const stats = await getStats();
  const key = dayKey();
  const day = stats[key] || { count: 0, minutes: 0 };
  stats[key] = { count: day.count + 1, minutes: day.minutes + Math.round(ms / 60000) };
  await chrome.storage.local.set({ stats });
}

// Wording for the notice shown when a phase ends and the next one waits.
function noticeText(state) {
  const { finished, minutes, late } = state.waiting;
  const next = Math.round(state.total / 60000);
  const passed = late
    ? 'Your break ended a while ago.'
    : `${minutes} ${minutes === 1 ? 'minute has' : 'minutes have'} passed.`;
  if (finished !== 'focus') {
    return { title: 'Break over', message: `${passed} Ready for another focus session?`, button: 'Start focus' };
  }
  const kind = state.phase === 'long' ? 'long break' : 'break';
  return { title: 'Focus session done', message: `${passed} Time for a ${next}-minute ${kind}.`, button: `Start ${kind}` };
}

function notify(state, settings) {
  const options = { type: 'basic', iconUrl: 'icons/icon128.png', priority: 2 };
  if (state.waiting) {
    const text = noticeText(state);
    Object.assign(options, {
      title: text.title,
      message: `${text.message} Click to start.`,
      buttons: [{ title: text.button }],
      requireInteraction: true,
    });
  } else {
    // The next phase has already started by itself.
    const onBreak = state.phase !== 'focus';
    options.title = onBreak ? 'Focus session done' : 'Break over';
    options.message = onBreak
      ? `Your ${settings[state.phase]}-minute ${state.phase === 'long' ? 'long ' : ''}break has started.`
      : 'Your focus session has started.';
  }
  chrome.notifications.clear('pomodoro', () => chrome.notifications.create('pomodoro', options));
}

// Runs inside the web page, so it cannot use anything defined outside itself.
// Adds a small card in the top right corner with a button to start the next phase.
function showToast(text, colour) {
  if (document.getElementById('pomodoro-toast')) return;
  const host = document.createElement('div');
  host.id = 'pomodoro-toast';
  const root = host.attachShadow({ mode: 'open' });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(`
    :host { all: initial; position: fixed; top: 16px; right: 16px; z-index: 2147483647; }
    .card {
      width: 280px; padding: 14px 16px; border-radius: 12px; box-sizing: border-box;
      background: #ffffff; color: #2a2623; border: 1px solid #ebe4de;
      box-shadow: 0 6px 24px rgb(0 0 0 / 0.18);
      font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    strong { display: block; font-size: 14px; }
    span { color: #857c75; }
    .row { display: flex; gap: 8px; margin-top: 12px; }
    button { flex: 1; padding: 7px 0; border-radius: 999px; font: inherit; cursor: pointer;
      background: transparent; color: inherit; border: 1px solid #ebe4de; }
    .start { background: ${colour}; border-color: ${colour}; color: #ffffff; font-weight: 600; }
    @media (prefers-color-scheme: dark) {
      .card { background: #2a2726; color: #f3eeea; border-color: #3a3634; }
      span { color: #a39a93; }
      button { border-color: #3a3634; }
    }
  `);
  root.adoptedStyleSheets = [sheet];

  const el = (tag, content, className) => {
    const node = document.createElement(tag);
    node.textContent = content;
    if (className) node.className = className;
    return node;
  };
  const card = el('div', '', 'card');
  const row = el('div', '', 'row');
  const later = el('button', 'Not now');
  const start = el('button', text.button, 'start');
  row.append(later, start);
  card.append(el('strong', text.title), el('span', text.message), row);
  root.append(card);
  document.documentElement.append(host);

  start.addEventListener('click', () => chrome.runtime.sendMessage({ cmd: 'start' }));
  later.addEventListener('click', () => chrome.runtime.sendMessage({ cmd: 'dismiss' }));
  // Disappear once the timer is started or the notice dismissed, from any tab.
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.state && !changes.state.newValue?.waiting) host.remove();
  });
}

// Show the card in the tab the user is looking at. Chrome's own pages refuse it.
async function toast(state, tabId) {
  if (!state.waiting || !(await getSettings()).notify) return;
  if (tabId === undefined) {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    tabId = tab?.id;
  }
  if (tabId === undefined) return;
  chrome.scripting.executeScript({
    target: { tabId },
    func: showToast,
    args: [noticeText(state), PHASES[state.phase].colour],
  }).catch(() => {});
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
    await commit({ ...state, waiting: null, status: 'running', endTime: Date.now() + state.remaining });
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
    const state = await getState();
    // Switching would throw away a running timer, so it needs a pause first.
    if (!PHASES[phase] || phase === state.phase || state.status === 'running') return;
    await commit(fresh(phase, await getSettings(), state.done));
  },
  async dismiss() {
    await commit({ ...(await getState()), waiting: null });
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

// Clicking the notification or its button starts the phase that is waiting.
const startFromNotification = (id) => {
  if (id !== 'pomodoro') return;
  chrome.notifications.clear(id);
  serial(async () => {
    if ((await getState()).waiting) await actions.start();
  });
};
chrome.notifications.onClicked.addListener(startFromNotification);
chrome.notifications.onButtonClicked.addListener(startFromNotification);

// Keep the card in view when the user switches tab or loads another page.
chrome.tabs.onActivated.addListener(({ tabId }) => serial(async () => toast(await getState(), tabId)));
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === 'complete' && tab.active) serial(async () => toast(await getState(), tabId));
});
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) serial(async () => toast(await getState()));
});

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
