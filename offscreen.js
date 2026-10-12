// Plays a short chime made with the Web Audio API, then closes itself.
// Rising notes mean a focus session ended, falling notes mean a break ended.

const notes = location.hash === '#focus' ? [523.25, 659.25, 783.99] : [783.99, 523.25];
const ctx = new AudioContext();

notes.forEach((freq, i) => {
  const start = ctx.currentTime + i * 0.22;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.35, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.9);
  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + 1);
});

setTimeout(() => window.close(), 2500);
