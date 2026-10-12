# Pomodoro Timer

A Chrome extension with a pomodoro timer, automatic breaks, daily stats and site blocking.

## Install

1. Open `chrome://extensions`
2. Turn on "Developer mode" (top right)
3. Click "Load unpacked" and choose this folder
4. Pin the tomato icon to the toolbar

After editing the code, click the reload arrow on the extension's card.

## Features

- Focus, short break and long break phases (25, 5 and 15 minutes by default)
- A long break after every 4 focus sessions
- Minutes left on the toolbar icon
- Notification and chime when a session ends
- Sessions per day, with a 7-day chart
- Optional blocking of chosen sites during focus sessions
- `Alt+Shift+P` starts or pauses the timer

## Files

| File | Role |
|------|------|
| `manifest.json` | Extension description and permissions |
| `background.js` | The timer: alarms, badge, notifications, stats, blocking rules |
| `shared.js` | Defaults and helpers used by every page |
| `popup.*` | The timer window that opens from the toolbar |
| `options.*` | Stats and settings page |
| `blocked.*` | Page shown in place of a blocked site |
| `offscreen.*` | Plays the chime |

All data stays in the browser (`chrome.storage.local`).
