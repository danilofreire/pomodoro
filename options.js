import { DEFAULTS, getSettings, getStats, dayKey, fmtMinutes } from './shared.js';

const $ = (id) => document.getElementById(id);

// Remember which boxes are minimised.
const boxes = [...document.querySelectorAll('details')];
const minimised = new Set(JSON.parse(localStorage.getItem('minimised') || '[]'));
const allMinimised = () => boxes.every((box) => !box.open);
const labelToggleAll = () => {
  $('toggle-all').textContent = allMinimised() ? 'Expand all' : 'Minimise all';
};
for (const box of boxes) {
  box.open = !minimised.has(box.id);
  box.addEventListener('toggle', () => {
    if (box.open) minimised.delete(box.id);
    else minimised.add(box.id);
    localStorage.setItem('minimised', JSON.stringify([...minimised]));
    labelToggleAll();
  });
}
labelToggleAll();

$('toggle-all').addEventListener('click', () => {
  const open = allMinimised();
  for (const box of boxes) box.open = open;
});

const settings = await getSettings();
const save = () => chrome.storage.local.set({ settings });

// Every input with a data-key attribute maps to one setting and saves on change.
for (const el of document.querySelectorAll('[data-key]')) {
  const key = el.dataset.key;
  if (el.type === 'checkbox') el.checked = settings[key];
  else el.value = settings[key];

  el.addEventListener('change', () => {
    if (el.type === 'checkbox') {
      settings[key] = el.checked;
    } else {
      const n = Math.round(Number(el.value)) || DEFAULTS[key];
      settings[key] = Math.min(Number(el.max), Math.max(Number(el.min), n));
      el.value = settings[key];
    }
    save();
  });
}

$('test-sound').addEventListener('click', () => chrome.runtime.sendMessage({ cmd: 'testSound' }));

// Site blocking

function renderSites() {
  $('sites').replaceChildren(...settings.blockList.map((domain) => {
    const li = document.createElement('li');
    const remove = document.createElement('button');
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => {
      settings.blockList = settings.blockList.filter((d) => d !== domain);
      save();
      renderSites();
    });
    li.append(domain, remove);
    return li;
  }));
}

$('add-site').addEventListener('submit', (event) => {
  event.preventDefault();
  // Accept a pasted address: keep only the domain, without "www."
  const domain = $('site').value.trim().toLowerCase()
    .replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').replace(/[/:?#].*$/, '');
  const valid = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain);
  $('site-error').hidden = valid;
  if (!valid) return;
  if (!settings.blockList.includes(domain)) settings.blockList.push(domain);
  $('site').value = '';
  save();
  renderSites();
});

// Stats

async function renderStats() {
  const stats = await getStats();
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - i));
    return { date, ...(stats[dayKey(date)] || { count: 0, minutes: 0 }) };
  });
  const sum = (list, field) => list.reduce((total, day) => total + day[field], 0);
  const all = Object.values(stats);
  const today = days[6];

  $('stat-today').textContent = today.count;
  $('stat-today-time').textContent = fmtMinutes(today.minutes);
  $('stat-week').textContent = sum(days, 'count');
  $('stat-week-time').textContent = fmtMinutes(sum(days, 'minutes'));
  $('stat-all').textContent = sum(all, 'count');
  $('stat-all-time').textContent = fmtMinutes(sum(all, 'minutes'));

  const max = Math.max(1, ...days.map((day) => day.count));
  $('chart').replaceChildren(...days.map((day, i) => {
    const col = document.createElement('div');
    col.className = i === 6 ? 'day today' : 'day';
    const bar = document.createElement('div');
    bar.className = day.count ? 'bar' : 'bar empty';
    bar.style.setProperty('--share', day.count / max);
    const weekday = day.date.toLocaleDateString('en-GB', { weekday: 'short' });
    col.append(String(day.count), bar, weekday);
    return col;
  }));
}

// Download every recorded day as a CSV file, oldest first.
$('export').addEventListener('click', async () => {
  const stats = await getStats();
  const rows = Object.keys(stats).sort().map((day) => `${day},${stats[day].count},${stats[day].minutes}`);
  const csv = ['date,sessions,minutes', ...rows].join('\n') + '\n';
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  link.download = `pomodoro-stats-${dayKey()}.csv`;
  link.click();
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.stats) renderStats();
});

renderSites();
renderStats();
