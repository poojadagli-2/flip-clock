'use strict';

/* ═══════════════════════════════════════════════════════════════
   FlipDigit — manages a single digit card with fold animation
═══════════════════════════════════════════════════════════════ */
class FlipDigit {
  constructor(container) {
    this.el = document.createElement('div');
    this.el.className = 'flip-digit';
    this.el.innerHTML = `
      <div class="fd-top"><div class="lbl">0</div></div>
      <div class="fd-bot"><div class="lbl">0</div></div>
      <div class="fd-div"></div>
      <div class="fd-flap"><div class="lbl">0</div></div>
    `;
    this._top  = this.el.querySelector('.fd-top .lbl');
    this._bot  = this.el.querySelector('.fd-bot .lbl');
    this._flap = this.el.querySelector('.fd-flap');
    this._flapLbl = this._flap.querySelector('.lbl');
    this._cur  = '0';
    this._busy = false;
    container.appendChild(this.el);
  }

  /* Instantly set value with no animation */
  set(val) {
    const s = String(val);
    this._cur = s;
    this._top.textContent  = s;
    this._bot.textContent  = s;
    this._flapLbl.textContent = s;
    this._flap.classList.remove('folding');
    this._busy = false;
  }

  /* Animate to new value; calls onDone() when complete */
  flip(next, onSound) {
    const s = String(next);
    if (s === this._cur || this._busy) { this.set(s); return; }
    this._busy = true;

    // Update bg cards to show NEXT before fold starts
    this._top.textContent = s;
    this._bot.textContent = s;
    // Flap still shows CURRENT – it folds down revealing the new value beneath

    if (onSound) onSound();

    const flap = this._flap;
    flap.classList.remove('folding');
    void flap.offsetWidth; // reflow to restart animation
    flap.classList.add('folding');

    const done = () => {
      flap.removeEventListener('animationend', done);
      flap.classList.remove('folding');
      this._flapLbl.textContent = s;
      this._cur = s;
      this._busy = false;
    };
    flap.addEventListener('animationend', done, { once: true });
  }

  get value() { return this._cur; }
}

/* ═══════════════════════════════════════════════════════════════
   FlipGroup — a pair of digits (e.g. hours tens + units)
═══════════════════════════════════════════════════════════════ */
class FlipGroup {
  constructor(parent) {
    this.wrap = document.createElement('div');
    this.wrap.className = 'digit-group';
    parent.appendChild(this.wrap);
    this.tens = new FlipDigit(this.wrap);
    this.units = new FlipDigit(this.wrap);
    this._prev = null;
  }

  update(val, onSound) {
    const padded = String(val).padStart(2, '0');
    if (padded === this._prev) return;

    const t = padded[0], u = padded[1];
    const pt = this._prev ? this._prev[0] : null;
    const pu = this._prev ? this._prev[1] : null;

    if (t !== pt) this.tens.flip(t, onSound);
    if (u !== pu) this.units.flip(u, u !== pu ? onSound : null);

    this._prev = padded;
  }

  set(val) {
    const padded = String(val).padStart(2, '0');
    this.tens.set(padded[0]);
    this.units.set(padded[1]);
    this._prev = padded;
  }
}

/* ═══════════════════════════════════════════════════════════════
   Separator — two dots between digit groups
═══════════════════════════════════════════════════════════════ */
function makeSeparator(parent) {
  const el = document.createElement('div');
  el.className = 'sep';
  el.innerHTML = '<div class="sep-dot"></div><div class="sep-dot"></div>';
  parent.appendChild(el);
  return el;
}

/* ═══════════════════════════════════════════════════════════════
   AudioEngine — Web Audio mechanical click
═══════════════════════════════════════════════════════════════ */
const Audio = (() => {
  let ctx = null;
  let enabled = true;

  function getCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    return ctx;
  }

  function play() {
    if (!enabled) return;
    try {
      const ac = getCtx();
      if (ac.state === 'suspended') ac.resume();

      const len = Math.floor(ac.sampleRate * 0.06);
      const buf = ac.createBuffer(1, len, ac.sampleRate);
      const d   = buf.getChannelData(0);
      for (let i = 0; i < len; i++) {
        const t = i / ac.sampleRate;
        d[i] = (Math.random() * 2 - 1) * Math.exp(-t * 90) * 0.45;
      }

      const src = ac.createBufferSource();
      src.buffer = buf;

      const bpf = ac.createBiquadFilter();
      bpf.type = 'bandpass';
      bpf.frequency.value = 1400;
      bpf.Q.value = 0.7;

      const gain = ac.createGain();
      gain.gain.value = 0.9;

      src.connect(bpf);
      bpf.connect(gain);
      gain.connect(ac.destination);
      src.start();
    } catch (_) {}
  }

  function setEnabled(val) { enabled = val; }
  function isEnabled()     { return enabled; }

  return { play, setEnabled, isEnabled };
})();

/* ═══════════════════════════════════════════════════════════════
   App state
═══════════════════════════════════════════════════════════════ */
const State = {
  mode:        'clock',   // 'clock' | 'timer' | 'pomodoro'
  showSeconds: true,

  // Timer
  timerRunning:  false,
  timerTotal:    300,     // seconds
  timerRemain:   300,
  timerLastTick: null,

  // Pomodoro settings
  pomoWork:    25,
  pomoShort:   5,
  pomoLong:    15,
  pomoCycles:  4,

  // Pomodoro runtime
  pomoRunning:   false,
  pomoSession:   'work',  // 'work' | 'short' | 'long'
  pomoCycleIdx:  0,       // 0-based completed work sessions
  pomoRemain:    0,
  pomoLastTick:  null,
};

/* ═══════════════════════════════════════════════════════════════
   DOM refs
═══════════════════════════════════════════════════════════════ */
const $ = id => document.getElementById(id);

const DOM = {
  display:          $('flip-display'),
  sessionLabel:     $('session-label'),
  pomoProgress:     $('pomodoro-progress'),
  cycleDots:        $('cycle-dots'),

  timerControls:    $('timer-controls'),
  btnTimerSS:       $('btn-timer-startstop'),
  btnTimerReset:    $('btn-timer-reset'),

  pomoControls:     $('pomodoro-controls'),
  btnPomoSS:        $('btn-pomo-startstop'),
  btnPomoSkip:      $('btn-pomo-skip'),
  btnPomoReset:     $('btn-pomo-reset'),

  btnFullscreen:    $('btn-fullscreen'),
  btnSound:         $('btn-sound'),
  soundIconOn:      $('sound-icon-on'),
  soundIconOff:     $('sound-icon-off'),
  btnSeconds:       $('btn-seconds'),
  btnSettings:      $('btn-settings'),

  settingsPanel:    $('settings-panel'),
  btnCloseSettings: $('btn-close-settings'),
  btnApply:         $('btn-apply-settings'),
  timerSettingsSec: $('timer-settings'),
  pomoSettingsSec:  $('pomodoro-settings'),

  inpTimerMin:  $('inp-timer-min'),
  inpTimerSec:  $('inp-timer-sec'),
  inpPomoWork:  $('inp-pomo-work'),
  inpPomoShort: $('inp-pomo-short'),
  inpPomoLong:  $('inp-pomo-long'),
  inpPomoCyc:   $('inp-pomo-cycles'),
};

/* ═══════════════════════════════════════════════════════════════
   Build the display
═══════════════════════════════════════════════════════════════ */
let gHours, gMins, gSecs, sepHM, sepMS;

function buildDisplay() {
  DOM.display.innerHTML = '';
  gHours = new FlipGroup(DOM.display);
  sepHM  = makeSeparator(DOM.display);
  gMins  = new FlipGroup(DOM.display);

  if (State.showSeconds) {
    sepMS = makeSeparator(DOM.display);
    gSecs = new FlipGroup(DOM.display);
  } else {
    sepMS = null;
    gSecs = null;
  }
}

/* ═══════════════════════════════════════════════════════════════
   Clock mode
═══════════════════════════════════════════════════════════════ */
let clockRaf = null;
let sepBlinkState = true;
let lastClockSec  = -1;

function clockTick() {
  if (State.mode !== 'clock') return;
  const now = new Date();
  const h = now.getHours(), m = now.getMinutes(), s = now.getSeconds();

  if (s !== lastClockSec) {
    lastClockSec = s;
    const sound = () => Audio.play();
    gHours.update(h, sound);
    gMins.update(m, s === 0 ? sound : null);
    if (gSecs) gSecs.update(s, sound);

    // Blink separator on each second
    sepBlinkState = !sepBlinkState;
    sepHM.classList.toggle('off', !sepBlinkState);
    if (sepMS) sepMS.classList.toggle('off', !sepBlinkState);
  }
  clockRaf = requestAnimationFrame(clockTick);
}

function startClock() {
  if (clockRaf) cancelAnimationFrame(clockRaf);
  lastClockSec = -1;
  sepBlinkState = true;
  // Seed display immediately
  const now = new Date();
  gHours.set(now.getHours());
  gMins.set(now.getMinutes());
  if (gSecs) gSecs.set(now.getSeconds());
  clockRaf = requestAnimationFrame(clockTick);
}

function stopClock() {
  if (clockRaf) { cancelAnimationFrame(clockRaf); clockRaf = null; }
}

/* ═══════════════════════════════════════════════════════════════
   Timer mode
═══════════════════════════════════════════════════════════════ */
let timerRaf = null;

function formatTimer(secs) {
  const s = Math.max(0, Math.round(secs));
  return { h: Math.floor(s / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
}

function renderTimer(remain) {
  const { h, m, s } = formatTimer(remain);
  gHours.update(h, () => Audio.play());
  gMins.update(m,  () => Audio.play());
  if (gSecs) gSecs.update(s, () => Audio.play());
}

function timerTick(ts) {
  if (!State.timerRunning) return;
  if (State.timerLastTick === null) State.timerLastTick = ts;
  const delta = (ts - State.timerLastTick) / 1000;
  State.timerLastTick = ts;

  const prev = Math.ceil(State.timerRemain);
  State.timerRemain = Math.max(0, State.timerRemain - delta);
  const curr = Math.ceil(State.timerRemain);

  if (curr !== prev) renderTimer(State.timerRemain);

  if (State.timerRemain <= 0) {
    State.timerRunning = false;
    DOM.btnTimerSS.textContent = 'START';
    renderTimer(0);
    notifyDone('TIMER DONE!');
    return;
  }
  timerRaf = requestAnimationFrame(timerTick);
}

function startTimer() {
  if (State.timerRemain <= 0) State.timerRemain = State.timerTotal;
  State.timerRunning  = true;
  State.timerLastTick = null;
  DOM.btnTimerSS.textContent = 'PAUSE';
  timerRaf = requestAnimationFrame(timerTick);
}

function pauseTimer() {
  State.timerRunning = false;
  if (timerRaf) { cancelAnimationFrame(timerRaf); timerRaf = null; }
  DOM.btnTimerSS.textContent = 'RESUME';
}

function resetTimer() {
  pauseTimer();
  State.timerRemain = State.timerTotal;
  DOM.btnTimerSS.textContent = 'START';
  renderTimerImmediate(State.timerRemain);
}

function renderTimerImmediate(secs) {
  const { h, m, s } = formatTimer(secs);
  gHours.set(h); gMins.set(m);
  if (gSecs) gSecs.set(s);
}

/* ═══════════════════════════════════════════════════════════════
   Pomodoro mode
═══════════════════════════════════════════════════════════════ */
let pomoRaf = null;

function pomoSessionDuration() {
  if (State.pomoSession === 'work')  return State.pomoWork  * 60;
  if (State.pomoSession === 'short') return State.pomoShort * 60;
  return State.pomoLong * 60;
}

function pomoSessionLabel() {
  if (State.pomoSession === 'work')  return 'FOCUS';
  if (State.pomoSession === 'short') return 'SHORT BREAK';
  return 'LONG BREAK';
}

function nextPomoSession() {
  if (State.pomoSession === 'work') {
    State.pomoCycleIdx++;
    if (State.pomoCycleIdx >= State.pomoCycles) {
      State.pomoSession  = 'long';
      State.pomoCycleIdx = 0;
    } else {
      State.pomoSession = 'short';
    }
  } else {
    State.pomoSession = 'work';
  }
  State.pomoRemain  = pomoSessionDuration();
  State.pomoRunning = false;
  DOM.btnPomoSS.textContent = 'START';
  renderPomoLabel();
  renderCycleDots();
  renderTimerImmediate(State.pomoRemain);
}

function renderPomoLabel() {
  DOM.sessionLabel.textContent = pomoSessionLabel();
}

function renderCycleDots() {
  DOM.cycleDots.innerHTML = '';
  for (let i = 0; i < State.pomoCycles; i++) {
    const d = document.createElement('div');
    d.className = 'cycle-dot';
    if (i < State.pomoCycleIdx)  d.classList.add('done');
    else if (i === State.pomoCycleIdx && State.pomoSession === 'work') d.classList.add('current');
    DOM.cycleDots.appendChild(d);
  }
}

function pomoTick(ts) {
  if (!State.pomoRunning) return;
  if (State.pomoLastTick === null) State.pomoLastTick = ts;
  const delta = (ts - State.pomoLastTick) / 1000;
  State.pomoLastTick = ts;

  const prev = Math.ceil(State.pomoRemain);
  State.pomoRemain = Math.max(0, State.pomoRemain - delta);
  const curr = Math.ceil(State.pomoRemain);

  if (curr !== prev) {
    const { h, m, s } = formatTimer(State.pomoRemain);
    gHours.update(h, () => Audio.play());
    gMins.update(m,  () => Audio.play());
    if (gSecs) gSecs.update(s, () => Audio.play());
  }

  if (State.pomoRemain <= 0) {
    notifyDone(State.pomoSession === 'work' ? 'BREAK TIME!' : 'BACK TO WORK!');
    nextPomoSession();
    return;
  }
  pomoRaf = requestAnimationFrame(pomoTick);
}

function startPomo() {
  State.pomoRunning  = true;
  State.pomoLastTick = null;
  DOM.btnPomoSS.textContent = 'PAUSE';
  pomoRaf = requestAnimationFrame(pomoTick);
}

function pausePomo() {
  State.pomoRunning = false;
  if (pomoRaf) { cancelAnimationFrame(pomoRaf); pomoRaf = null; }
  DOM.btnPomoSS.textContent = 'RESUME';
}

function resetPomo() {
  pausePomo();
  State.pomoSession  = 'work';
  State.pomoCycleIdx = 0;
  State.pomoRemain   = pomoSessionDuration();
  DOM.btnPomoSS.textContent = 'START';
  renderPomoLabel();
  renderCycleDots();
  renderTimerImmediate(State.pomoRemain);
}

function skipPomo() {
  pausePomo();
  notifyDone('SKIPPED');
  nextPomoSession();
}

/* ═══════════════════════════════════════════════════════════════
   Notification (visual flash + optional browser notification)
═══════════════════════════════════════════════════════════════ */
function notifyDone(msg) {
  DOM.sessionLabel.textContent = msg;
  DOM.sessionLabel.style.color = '#e84040';
  setTimeout(() => {
    DOM.sessionLabel.style.color = '';
    if (State.mode === 'pomodoro') renderPomoLabel();
    else DOM.sessionLabel.textContent = '';
  }, 2000);

  // Try browser notification if available and page is hidden
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    new Notification('Flip Clock', { body: msg, silent: false });
  }
}

/* ═══════════════════════════════════════════════════════════════
   Mode switching
═══════════════════════════════════════════════════════════════ */
function activateMode(mode) {
  // Stop everything
  stopClock();
  if (State.timerRunning) pauseTimer();
  if (State.pomoRunning)  pausePomo();

  State.mode = mode;

  // Show/hide controls
  DOM.timerControls.classList.toggle('hidden', mode !== 'timer');
  DOM.pomoControls.classList.toggle('hidden',  mode !== 'pomodoro');
  DOM.pomoProgress.classList.toggle('hidden',  mode !== 'pomodoro');
  DOM.sessionLabel.textContent = '';
  DOM.sessionLabel.style.color = '';

  // Update nav buttons
  document.querySelectorAll('.mode-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });

  // Show/hide settings sections
  DOM.timerSettingsSec.style.display = mode === 'timer'     ? '' : 'none';
  DOM.pomoSettingsSec.style.display  = mode === 'pomodoro'  ? '' : 'none';

  // Rebuild display (seconds visibility may differ by mode)
  buildDisplay();

  if (mode === 'clock') {
    startClock();
  } else if (mode === 'timer') {
    State.timerRemain = State.timerTotal;
    DOM.btnTimerSS.textContent = 'START';
    renderTimerImmediate(State.timerRemain);
  } else if (mode === 'pomodoro') {
    State.pomoSession  = 'work';
    State.pomoCycleIdx = 0;
    State.pomoRemain   = pomoSessionDuration();
    DOM.btnPomoSS.textContent = 'START';
    renderPomoLabel();
    renderCycleDots();
    renderTimerImmediate(State.pomoRemain);
  }
}

/* ═══════════════════════════════════════════════════════════════
   Settings panel
═══════════════════════════════════════════════════════════════ */
function openSettings() {
  DOM.inpTimerMin.value  = Math.floor(State.timerTotal / 60);
  DOM.inpTimerSec.value  = State.timerTotal % 60;
  DOM.inpPomoWork.value  = State.pomoWork;
  DOM.inpPomoShort.value = State.pomoShort;
  DOM.inpPomoLong.value  = State.pomoLong;
  DOM.inpPomoCyc.value   = State.pomoCycles;
  DOM.settingsPanel.classList.remove('hidden');
}

function closeSettings() {
  DOM.settingsPanel.classList.add('hidden');
}

function applySettings() {
  const newMin  = Math.max(0, Math.min(99, parseInt(DOM.inpTimerMin.value)  || 0));
  const newSec  = Math.max(0, Math.min(59, parseInt(DOM.inpTimerSec.value)  || 0));
  State.timerTotal = newMin * 60 + newSec || 300;

  State.pomoWork   = Math.max(1, Math.min(99, parseInt(DOM.inpPomoWork.value)  || 25));
  State.pomoShort  = Math.max(1, Math.min(30, parseInt(DOM.inpPomoShort.value) || 5));
  State.pomoLong   = Math.max(1, Math.min(60, parseInt(DOM.inpPomoLong.value)  || 15));
  State.pomoCycles = Math.max(2, Math.min(10, parseInt(DOM.inpPomoCyc.value)   || 4));

  closeSettings();
  activateMode(State.mode); // re-init current mode with new settings
}

/* ═══════════════════════════════════════════════════════════════
   Fullscreen
═══════════════════════════════════════════════════════════════ */
function toggleFullscreen() {
  const el = document.documentElement;
  const isFs = document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement;
  if (!isFs) {
    (el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || (() => {})).call(el);
  } else {
    (document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || (() => {})).call(document);
  }
}

/* ═══════════════════════════════════════════════════════════════
   Event listeners
═══════════════════════════════════════════════════════════════ */
// Mode nav
document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => activateMode(btn.dataset.mode));
});

// Timer controls
DOM.btnTimerSS.addEventListener('click', () => {
  if (State.timerRunning) pauseTimer();
  else startTimer();
});
DOM.btnTimerReset.addEventListener('click', resetTimer);

// Pomodoro controls
DOM.btnPomoSS.addEventListener('click', () => {
  if (State.pomoRunning) pausePomo();
  else startPomo();
});
DOM.btnPomoSkip.addEventListener('click',  skipPomo);
DOM.btnPomoReset.addEventListener('click', resetPomo);

// Toolbar
DOM.btnFullscreen.addEventListener('click', toggleFullscreen);

DOM.btnSound.addEventListener('click', () => {
  const on = !Audio.isEnabled();
  Audio.setEnabled(on);
  DOM.btnSound.classList.toggle('active', on);
  DOM.soundIconOn.classList.toggle('hidden',  !on);
  DOM.soundIconOff.classList.toggle('hidden',  on);
});

DOM.btnSeconds.addEventListener('click', () => {
  State.showSeconds = !State.showSeconds;
  DOM.btnSeconds.classList.toggle('active', State.showSeconds);
  activateMode(State.mode);
});

DOM.btnSettings.addEventListener('click', openSettings);
DOM.btnCloseSettings.addEventListener('click', closeSettings);
DOM.btnApply.addEventListener('click', applySettings);

// Close settings on backdrop click
DOM.settingsPanel.addEventListener('click', e => {
  if (e.target === DOM.settingsPanel) closeSettings();
});

// Clamp number inputs on blur
[DOM.inpTimerMin, DOM.inpTimerSec, DOM.inpPomoWork, DOM.inpPomoShort, DOM.inpPomoLong, DOM.inpPomoCyc]
  .forEach(inp => {
    inp.addEventListener('blur', () => {
      const v = parseInt(inp.value);
      const mn = parseInt(inp.min), mx = parseInt(inp.max);
      if (isNaN(v)) inp.value = mn;
      else inp.value = Math.max(mn, Math.min(mx, v));
    });
  });

// Keyboard shortcuts
document.addEventListener('keydown', e => {
  if (DOM.settingsPanel.classList.contains('hidden') === false) {
    if (e.key === 'Escape') closeSettings();
    return;
  }
  switch (e.key) {
    case ' ':
    case 'Enter':
      e.preventDefault();
      if (State.mode === 'timer') {
        if (State.timerRunning) pauseTimer(); else startTimer();
      } else if (State.mode === 'pomodoro') {
        if (State.pomoRunning) pausePomo(); else startPomo();
      }
      break;
    case 'r': case 'R':
      if (State.mode === 'timer') resetTimer();
      else if (State.mode === 'pomodoro') resetPomo();
      break;
    case 'f': case 'F': toggleFullscreen(); break;
    case 's': case 'S':
      State.showSeconds = !State.showSeconds;
      DOM.btnSeconds.classList.toggle('active', State.showSeconds);
      activateMode(State.mode);
      break;
    case '1': activateMode('clock'); break;
    case '2': activateMode('timer'); break;
    case '3': activateMode('pomodoro'); break;
  }
});

// Unlock AudioContext on first interaction (iOS/Chrome policy)
document.addEventListener('pointerdown', () => {
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    ac.resume();
    ac.close();
  } catch (_) {}
}, { once: true });

// Request notification permission for timer alerts
if ('Notification' in window && Notification.permission === 'default') {
  Notification.requestPermission();
}

/* ═══════════════════════════════════════════════════════════════
   Init
═══════════════════════════════════════════════════════════════ */
activateMode('clock');
