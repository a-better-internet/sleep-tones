/* Sleep Tones — app */
(function () {
  'use strict';

  /* ================================================================
   * Catalogue
   * ================================================================ */

  const NOISES = [
    { id: 'white', name: 'White noise', short: 'White', dot: '#e8ebf7', desc: 'Bright, even hiss. Best at masking sharp sounds.' },
    { id: 'pink', name: 'Pink noise', short: 'Pink', dot: '#efb3c4', desc: 'Balanced and soft. Equal energy in every octave.' },
    { id: 'brown', name: 'Brown noise', short: 'Brown', dot: '#b88d6c', desc: 'Deep, warm rumble. The calmest of the three.' },
  ];
  const IDS = NOISES.map((n) => n.id);
  const BY_ID = Object.fromEntries(NOISES.map((n) => [n.id, n]));

  // Mix format: { id: { vol, tone } }   tone: -1 darker … 0 natural … +1 brighter
  const PRESETS = [
    { name: 'Balanced', sounds: { pink: { vol: 0.6, tone: 0 }, brown: { vol: 0.55, tone: 0 } } },
    { name: 'Deep sleep', sounds: { brown: { vol: 0.75, tone: -0.3 } } },
    { name: 'Pure pink', sounds: { pink: { vol: 0.7, tone: 0 } } },
    { name: 'Soft white', sounds: { white: { vol: 0.6, tone: -0.7 } } },
    { name: 'Mask snoring', sounds: { white: { vol: 0.35, tone: -0.3 }, pink: { vol: 0.65, tone: 0.1 } } },
    { name: 'Low rumble', sounds: { brown: { vol: 0.8, tone: -0.8 } } },
  ];
  const DEFAULT_MIX = PRESETS[0].sounds;

  const TIMERS = [0, 15, 30, 45, 60, 90, 120, 180];

  /* ================================================================
   * State (persisted)
   * ================================================================ */

  const STORE_KEY = 'sleeptones.v2';

  const state = {
    sounds: {},          // id -> { on, vol, tone }
    master: 0.8,
    width: 0.7,          // 0 mono … 1 fully wide
    drift: 0,            // 0 perfectly still … 1 gently moving
    timerMinutes: 0,
    mixes: [],           // [{ name, sounds: { id: { vol, tone } } }]
  };
  IDS.forEach((id) => (state.sounds[id] = { on: false, vol: 0.7, tone: 0 }));

  function clamp(v, lo, hi, fallback) {
    v = Number(v);
    return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
  }
  const clamp01 = (v, f) => clamp(v, 0, 1, f);

  // Accepts current mixes and ones saved by the earlier version ({ id: vol }).
  function cleanMix(sounds) {
    const out = {};
    for (const id in sounds || {}) {
      if (!BY_ID[id]) continue;
      const v = sounds[id];
      out[id] = typeof v === 'number'
        ? { vol: clamp01(v, 0.6), tone: 0 }
        : { vol: clamp01(v && v.vol, 0.6), tone: clamp(v && v.tone, -1, 1, 0) };
    }
    return out;
  }

  (function load() {
    try {
      let raw = localStorage.getItem(STORE_KEY);
      const legacy = !raw && localStorage.getItem('sleeptones.v1');
      raw = raw || legacy;
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (saved.sounds) {
        for (const id of IDS) {
          const s = saved.sounds[id];
          if (!s) continue;
          state.sounds[id].on = !!s.on;
          state.sounds[id].vol = clamp01(s.vol, 0.6);
          state.sounds[id].tone = clamp(s.tone, -1, 1, 0);
        }
      }
      state.master = clamp01(saved.master, state.master);
      state.width = clamp01(saved.width, state.width);
      state.drift = clamp01(saved.drift, state.drift);
      if (TIMERS.includes(saved.timerMinutes)) state.timerMinutes = saved.timerMinutes;
      if (Array.isArray(saved.mixes)) {
        state.mixes = saved.mixes
          .filter((m) => m && typeof m.name === 'string')
          .map((m) => ({ name: m.name, sounds: cleanMix(m.sounds) }))
          .filter((m) => Object.keys(m.sounds).length)
          .slice(0, 20);
      }
    } catch (e) { /* private mode / corrupted: start fresh */ }
  })();

  let saveTimer = 0;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
    }, 250);
  }

  const activeIds = () => IDS.filter((id) => state.sounds[id].on);

  /* ================================================================
   * Audio engine
   *
   *  noise ─► tone tilt ─► gain ─┐
   *  noise ─► tone tilt ─► gain ─┼─► bus ─► master ─► fade ─► limiter ─► speakers
   *  noise ─► tone tilt ─► gain ─┘    └─► analyser (the "shape" curve)
   *
   * Noise is generated live in an AudioWorklet: it never loops or repeats.
   * Browsers without AudioWorklet (or pages opened over plain http on a LAN)
   * fall back to 45-second pre-rendered stereo loops.
   * ================================================================ */

  let ctx = null;
  let bus, masterGain, fadeGain, limiter, analyser;
  let workletReady = Promise.resolve(false);
  const voices = new Map(); // id -> voice
  let playing = false;      // what the user wants
  let playRequestedAt = 0;
  let pauseToken = 0;

  function ensureContext() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) {
      toast('Sorry, this browser cannot play generated audio.');
      throw new Error('No Web Audio');
    }
    try { ctx = new AC({ latencyHint: 'playback' }); } catch (e) { ctx = new AC(); }

    bus = ctx.createGain();
    masterGain = ctx.createGain();
    fadeGain = ctx.createGain();
    fadeGain.gain.value = 0;
    limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 6;
    limiter.ratio.value = 4;
    limiter.attack.value = 0.01;
    limiter.release.value = 0.4;
    analyser = ctx.createAnalyser();
    analyser.fftSize = 4096;
    analyser.smoothingTimeConstant = 0.9;

    bus.connect(masterGain).connect(fadeGain).connect(limiter).connect(ctx.destination);
    bus.connect(analyser);
    masterGain.gain.value = masterLevel();

    if (ctx.audioWorklet && window.isSecureContext) {
      workletReady = ctx.audioWorklet.addModule('noise.js').then(() => true, (e) => {
        console.warn('AudioWorklet unavailable, using loops', e);
        return false;
      });
    }

    ctx.onstatechange = () => {
      if (playing && ctx.state !== 'running' && ctx.state !== 'closed' && document.visibilityState === 'visible') {
        ctx.resume().catch(() => {});
      }
      renderPlayState();
    };

    // iOS: treat this as media playback (ignores the silent switch).
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* ignore */ }
    return ctx;
  }

  const level = (v) => v * v;                     // perceptual slider curve
  const masterLevel = () => level(state.master) * 2;
  const TILT_DB = 8;                              // tone ±1 → ±8 dB shelves (16 dB of tilt)

  function setParam(param, value, timeConstant) {
    const now = ctx.currentTime;
    param.cancelScheduledValues(now);
    param.setTargetAtTime(value, now, timeConstant);
  }

  function fadeTo(target, seconds) {
    const g = fadeGain.gain, now = ctx.currentTime;
    const current = g.value;
    g.cancelScheduledValues(now);
    g.setValueAtTime(current, now);
    g.linearRampToValueAtTime(target, now + seconds);
  }

  /* ---------- fallback loops ---------- */

  const loopCache = new Map();
  function getLoop(id) {
    if (!loopCache.has(id)) {
      loopCache.set(id, new Promise((resolve) => {
        setTimeout(() => {
          // 45 s, independent L/R, last second cross-faded onto the start.
          const sr = ctx.sampleRate, N = Math.round(45 * sr), F = sr;
          const buf = ctx.createBuffer(2, N, sr);
          for (let c = 0; c < 2; c++) {
            const gen = window.SleepNoise.makeGenerator(id, sr);
            const raw = new Float32Array(N + F);
            for (let i = 0; i < raw.length; i++) raw[i] = gen();
            const out = buf.getChannelData(c);
            out.set(raw.subarray(0, N));
            for (let i = 0; i < F; i++) {
              const x = (i / F) * (Math.PI / 2);
              out[i] = raw[i] * Math.sin(x) + raw[N + i] * Math.cos(x);
            }
          }
          resolve(buf);
        }, 20);
      }));
    }
    return loopCache.get(id);
  }

  /* ---------- voices ---------- */

  async function startVoice(id) {
    if (!ctx || voices.has(id)) return;
    const s = state.sounds[id];
    const v = {
      gain: ctx.createGain(),
      low: ctx.createBiquadFilter(),
      high: ctx.createBiquadFilter(),
      node: null,
      stopped: false,
    };
    v.low.type = 'lowshelf';
    v.high.type = 'highshelf';
    v.low.frequency.value = 700;
    v.high.frequency.value = 700;
    v.low.gain.value = -s.tone * TILT_DB;
    v.high.gain.value = s.tone * TILT_DB;
    v.gain.gain.value = 0;
    v.low.connect(v.high).connect(v.gain).connect(bus);
    voices.set(id, v);

    const useWorklet = await workletReady;
    if (v.stopped) return;

    if (useWorklet) {
      try {
        v.node = new AudioWorkletNode(ctx, 'noise-source', {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [2],
          processorOptions: { color: id },
        });
        v.node.parameters.get('width').value = state.width;
        v.node.parameters.get('drift').value = state.drift;
      } catch (e) {
        console.warn(e);
        v.node = null;
      }
    }
    if (!v.node) {
      const buf = await getLoop(id);
      if (v.stopped) return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.start(0, Math.random() * buf.duration);
      v.node = src;
    }
    v.node.connect(v.low);
    v.gain.gain.setTargetAtTime(level(s.vol), ctx.currentTime + 0.02, 0.45);
  }

  function stopVoice(id, fadeSeconds = 0.8) {
    const v = voices.get(id);
    if (!v) return;
    voices.delete(id);
    v.stopped = true;
    const end = () => {
      if (v.node) {
        try { v.node.stop ? v.node.stop() : v.node.port.postMessage('stop'); } catch (e) { /* ignore */ }
        try { v.node.disconnect(); } catch (e) { /* ignore */ }
      }
      try { v.gain.disconnect(); } catch (e) { /* ignore */ }
    };
    if (!ctx || ctx.state !== 'running') return end();
    const g = v.gain.gain, now = ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + fadeSeconds);
    setTimeout(end, fadeSeconds * 1000 + 150);
  }

  function applyVoice(id) {
    const v = voices.get(id);
    if (!v || !ctx) return;
    const s = state.sounds[id];
    setParam(v.gain.gain, level(s.vol), 0.08);
    setParam(v.low.gain, -s.tone * TILT_DB, 0.08);
    setParam(v.high.gain, s.tone * TILT_DB, 0.08);
  }

  function applyCharacter() {
    if (!ctx) return;
    voices.forEach((v) => {
      if (!v.node || !v.node.parameters) return;
      setParam(v.node.parameters.get('width'), state.width, 0.15);
      setParam(v.node.parameters.get('drift'), state.drift, 0.3);
    });
  }

  /* ---------- transport ---------- */

  function play() {
    if (!activeIds().length) {
      applyMixState(DEFAULT_MIX);
      renderAllCards();
    }
    ensureContext();
    playing = true;
    playRequestedAt = Date.now();
    pauseToken++;
    keepAlive.start();

    // Don't wait on resume(): everything below is scheduled on the audio
    // clock and simply starts the moment the context is running.
    if (ctx.state !== 'running') {
      ctx.resume().then(renderPlayState, () => {});
      setTimeout(renderPlayState, 1600);
    }
    activeIds().forEach(startVoice);
    fadeTo(1, 2.5);
    Timer.onPlay();
    Shape.start();
    updateMediaSession();
    renderPlayState();
  }

  function pause(fast) {
    if (!playing) return;
    playing = false;
    Timer.onPause();
    const token = ++pauseToken;
    if (ctx) {
      const secs = fast ? 0.3 : 1.2;
      fadeTo(0, secs);
      setTimeout(() => {
        if (token !== pauseToken || playing) return;
        Shape.stop();
        if (ctx.state === 'running') ctx.suspend().catch(() => {});
      }, secs * 1000 + 150);
    }
    keepAlive.stop();
    updateMediaSession();
    renderPlayState();
  }

  function togglePlay() {
    if (playing && ctx && ctx.state === 'running') pause();
    else play();
  }

  function toggleNoise(id) {
    const s = state.sounds[id];
    s.on = !s.on;
    save();
    renderCard(id);
    if (s.on) {
      if (playing) {
        ensureContext();
        startVoice(id);
      } else {
        play();
      }
    } else {
      stopVoice(id);
      if (playing && !activeIds().length) pause();
    }
    updateMediaSession();
    renderPlayState();
  }

  function applyMixState(mix) {
    mix = cleanMix(mix);
    IDS.forEach((id) => {
      const s = state.sounds[id];
      if (mix[id]) {
        s.on = true;
        s.vol = mix[id].vol;
        s.tone = mix[id].tone;
      } else {
        s.on = false;
      }
    });
  }

  function applyMix(mix) {
    applyMixState(mix);
    save();
    renderAllCards();
    if (playing) {
      IDS.forEach((id) => {
        if (state.sounds[id].on) {
          voices.has(id) ? applyVoice(id) : startVoice(id);
        } else {
          stopVoice(id, 1.5);
        }
      });
      updateMediaSession();
      renderPlayState();
    } else {
      play();
    }
  }

  /* ================================================================
   * Keep-alive & lock-screen controls
   *
   * A quiet <audio> element playing alongside Web Audio makes Android treat
   * the page as a media player: it gets a media notification with play/pause,
   * and the browser is far less likely to throttle it with the screen off.
   * ================================================================ */

  const keepAlive = (function () {
    let el = null;

    function makeWavUrl() {
      // 10 s, 8 kHz, 16-bit mono of ±1 LSB dither (≈ -90 dB: inaudible, but not digital silence).
      const rate = 8000, n = rate * 10;
      const buf = new ArrayBuffer(44 + n * 2);
      const dv = new DataView(buf);
      const str = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
      str(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); str(8, 'WAVE');
      str(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
      dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
      str(36, 'data'); dv.setUint32(40, n * 2, true);
      for (let i = 0; i < n; i++) dv.setInt16(44 + i * 2, Math.round(Math.random() * 2 - 1), true);
      return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
    }

    function element() {
      if (!el) {
        el = new Audio();
        el.src = makeWavUrl();
        el.loop = true;
        el.preload = 'auto';
        el.setAttribute('playsinline', '');
      }
      return el;
    }

    return {
      start() { try { const p = element().play(); if (p) p.catch(() => {}); } catch (e) { /* ignore */ } },
      stop() { if (el) el.pause(); },
    };
  })();

  function setupMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const handlers = { play: () => play(), pause: () => pause(), stop: () => pause() };
    for (const action in handlers) {
      try { navigator.mediaSession.setActionHandler(action, handlers[action]); } catch (e) { /* unsupported */ }
    }
  }

  function updateMediaSession() {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: mixLabel() || 'Sleep Tones',
        artist: 'Sleep Tones',
        album: state.timerMinutes ? 'Sleep timer: ' + formatMinutes(state.timerMinutes) : '',
        artwork: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      });
      navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
    } catch (e) { /* ignore */ }
  }

  function mixLabel() {
    const ids = activeIds();
    if (!ids.length) return '';
    if (ids.length === 1) return BY_ID[ids[0]].name;
    return ids.map((id) => BY_ID[id].short).join(' + ') + ' noise';
  }

  /* ================================================================
   * Sleep timer
   *
   * The fade-out is scheduled on the audio clock, so it happens on time even
   * if the browser throttles JavaScript timers while the screen is off.
   * ================================================================ */

  const Timer = (function () {
    let endAt = 0;         // wall-clock ms while running
    let remaining = 0;     // ms left while paused
    let timeout = 0;

    function reset() {
      remaining = state.timerMinutes * 60000;
      endAt = 0;
    }

    function schedule() {
      clearTimeout(timeout);
      if (!state.timerMinutes || !playing || !ctx) return;
      endAt = Date.now() + remaining;
      timeout = setTimeout(check, remaining + 250);

      const now = ctx.currentTime;
      const secs = remaining / 1000;
      const earliest = now + 2.6; // after the fade-in finishes
      let fadeLen = Math.min(180, Math.max(4, secs * 0.35));
      let start = now + secs - fadeLen;
      if (start < earliest) {
        start = earliest;
        fadeLen = Math.max(0.5, now + secs - earliest);
      }
      const curve = new Float32Array(128);
      for (let i = 0; i < curve.length; i++) curve[i] = Math.pow(1 - i / (curve.length - 1), 2);
      try {
        fadeGain.gain.setValueCurveAtTime(curve, start, fadeLen);
      } catch (e) {
        fadeGain.gain.setValueAtTime(1, start);
        fadeGain.gain.linearRampToValueAtTime(0, start + fadeLen);
      }
    }

    function check() {
      if (endAt && Date.now() >= endAt) finish();
    }

    function finish() {
      clearTimeout(timeout);
      endAt = 0;
      state.timerMinutes = 0;
      reset();
      save();
      pause(true);
      renderTimerChips();
      renderTimerStatus();
      toast('Timer finished. Sleep well.');
    }

    return {
      set(minutes) {
        state.timerMinutes = minutes;
        save();
        reset();
        if (playing && ctx) {
          fadeTo(1, 0.6); // cancels any fade in progress
          schedule();
        } else {
          clearTimeout(timeout);
        }
        updateMediaSession();
      },
      onPlay() { if (!remaining) reset(); schedule(); },
      onPause() {
        clearTimeout(timeout);
        if (endAt) remaining = Math.max(0, endAt - Date.now());
        endAt = 0;
      },
      check,
      left() { return endAt ? Math.max(0, endAt - Date.now()) : state.timerMinutes ? remaining : 0; },
      init: reset,
    };
  })();

  /* ================================================================
   * Sound shape: a slow, smoothed spectrum of the live mix
   * ================================================================ */

  const Shape = (function () {
    const canvas = document.getElementById('shape');
    const g = canvas.getContext('2d');
    const POINTS = 96, F_LO = 30, F_HI = 16000;
    const smooth = new Float32Array(POINTS).fill(-140);
    let data = null, raf = 0, last = 0, w = 0, h = 0, dpr = 1;

    function resize() {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }

    function draw(t) {
      raf = requestAnimationFrame(draw);
      if (t - last < 50) return; // ~20 fps is plenty
      last = t;
      if (!analyser) return;
      if (!data) data = new Float32Array(analyser.frequencyBinCount);
      analyser.getFloatFrequencyData(data);
      const binHz = ctx.sampleRate / analyser.fftSize;
      let anyLive = false;
      for (let i = 0; i < POINTS; i++) {
        // Average the bins that fall in this slice of the log-frequency axis.
        const f0 = F_LO * Math.pow(F_HI / F_LO, i / POINTS);
        const f1 = F_LO * Math.pow(F_HI / F_LO, (i + 1) / POINTS);
        const b0 = Math.max(1, Math.floor(f0 / binHz)), b1 = Math.max(b0 + 1, Math.ceil(f1 / binHz));
        let p = 0;
        for (let b = b0; b < b1; b++) p += Math.pow(10, data[b] / 10);
        const db = 10 * Math.log10(p / (b1 - b0) + 1e-14);
        smooth[i] += 0.15 * (db - smooth[i]);
        if (smooth[i] > -125) anyLive = true;
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      if (!anyLive) return;
      const y = (db) => h - 4 - ((Math.min(-35, Math.max(-105, db)) + 105) / 70) * (h - 10);
      g.beginPath();
      g.moveTo(0, y(smooth[0]));
      for (let i = 1; i < POINTS; i++) {
        const x0 = ((i - 1) / (POINTS - 1)) * w, x1 = (i / (POINTS - 1)) * w;
        g.quadraticCurveTo(x0, y(smooth[i - 1]), (x0 + x1) / 2, (y(smooth[i - 1]) + y(smooth[i])) / 2);
      }
      g.lineTo(w, y(smooth[POINTS - 1]));
      g.strokeStyle = 'rgba(179, 191, 255, 0.75)';
      g.lineWidth = 1.5;
      g.stroke();
      g.lineTo(w, h);
      g.lineTo(0, h);
      g.closePath();
      const grad = g.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, 'rgba(179, 191, 255, 0.18)');
      grad.addColorStop(1, 'rgba(179, 191, 255, 0)');
      g.fillStyle = grad;
      g.fill();
    }

    return {
      start() {
        if (raf || document.visibilityState !== 'visible') return;
        resize();
        raf = requestAnimationFrame(draw);
      },
      stop() { cancelAnimationFrame(raf); raf = 0; },
      resize,
    };
  })();

  /* ================================================================
   * Screen wake lock + night screen
   * ================================================================ */

  const Night = (function () {
    const el = document.getElementById('night');
    const face = document.getElementById('nightFace');
    const clock = document.getElementById('nightClock');
    const sub = document.getElementById('nightSub');
    let lock = null, tick = 0, moveTick = 0;

    async function requestLock() {
      try {
        if ('wakeLock' in navigator && document.visibilityState === 'visible') {
          lock = await navigator.wakeLock.request('screen');
          lock.addEventListener('release', () => { lock = null; });
        }
      } catch (e) { lock = null; }
    }

    function update() {
      const parts = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).split(/\s+/);
      clock.textContent = parts[0];
      if (parts[1]) {
        const ampm = document.createElement('span');
        ampm.className = 'night-ampm';
        ampm.textContent = parts.slice(1).join(' ');
        clock.appendChild(ampm);
      }
      const bits = [];
      if (playing) bits.push(mixLabel());
      const left = Timer.left();
      if (state.timerMinutes && left) bits.push('fades in ' + formatLeft(left));
      sub.textContent = bits.join('  ·  ');
    }

    // Drift the clock a little every minute so the OLED doesn't burn in.
    function move() {
      face.style.left = 42 + Math.random() * 16 + '%';
      face.style.top = 30 + Math.random() * 30 + '%';
    }

    return {
      open() {
        el.hidden = false;
        document.body.classList.add('night-on');
        Shape.stop();
        update();
        tick = setInterval(update, 5000);
        moveTick = setInterval(move, 60000);
        requestLock();
        try {
          const fs = el.requestFullscreen || el.webkitRequestFullscreen;
          if (fs) { const p = fs.call(el, { navigationUI: 'hide' }); if (p) p.catch(() => {}); }
        } catch (e) { /* ignore */ }
      },
      close() {
        el.hidden = true;
        document.body.classList.remove('night-on');
        clearInterval(tick);
        clearInterval(moveTick);
        if (playing) Shape.start();
        if (lock) { lock.release().catch(() => {}); lock = null; }
        try {
          if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
        } catch (e) { /* ignore */ }
      },
      isOpen: () => !el.hidden,
      onVisible() { if (!el.hidden && !lock) requestLock(); },
      bindEvents() { el.addEventListener('click', () => this.close()); },
    };
  })();

  /* ================================================================
   * UI
   * ================================================================ */

  const $ = (id) => document.getElementById(id);
  const playBtn = $('playBtn');
  const statusEl = $('status');
  const timerStatusEl = $('timerStatus');

  function buildCards() {
    const wrap = $('noiseCards');
    NOISES.forEach((n) => {
      const card = document.createElement('div');
      card.className = 'noise-card';
      card.dataset.id = n.id;
      card.style.setProperty('--dot', n.dot);
      card.innerHTML = `
        <button type="button" class="noise-head" aria-pressed="false">
          <span class="noise-dot" aria-hidden="true"></span>
          <span class="noise-text">
            <span class="noise-name">${n.name}</span>
            <span class="noise-desc">${n.desc}</span>
          </span>
          <span class="switch" aria-hidden="true"></span>
        </button>
        <div class="noise-body"><div class="noise-body-inner">
          <label class="row">
            <span>Volume</span>
            <input type="range" class="vol" min="0" max="1" step="0.01" aria-label="${n.name} volume">
          </label>
          <label class="row">
            <span>Tone</span>
            <input type="range" class="tone bipolar" min="-1" max="1" step="0.01" aria-label="${n.name} tone, darker to brighter">
          </label>
          <div class="scale" aria-hidden="true"><span>Darker</span><span>Brighter</span></div>
        </div></div>`;
      card.querySelector('.noise-head').addEventListener('click', () => toggleNoise(n.id));
      const vol = card.querySelector('.vol');
      const tone = card.querySelector('.tone');
      vol.addEventListener('input', () => {
        state.sounds[n.id].vol = parseFloat(vol.value);
        paintRange(vol);
        applyVoice(n.id);
        save();
      });
      const setTone = (v) => {
        // A soft detent at the centre makes "natural" easy to find by feel.
        if (Math.abs(v) < 0.05) v = 0;
        tone.value = v;
        state.sounds[n.id].tone = v;
        paintRange(tone);
        applyVoice(n.id);
        save();
      };
      tone.addEventListener('input', () => setTone(parseFloat(tone.value)));
      tone.addEventListener('dblclick', () => setTone(0));
      wrap.appendChild(card);
      renderCard(n.id);
    });
  }

  function cardEl(id) { return document.querySelector(`.noise-card[data-id="${id}"]`); }

  function renderCard(id) {
    const card = cardEl(id);
    if (!card) return;
    const s = state.sounds[id];
    card.classList.toggle('on', s.on);
    card.querySelector('.noise-head').setAttribute('aria-pressed', String(s.on));
    const vol = card.querySelector('.vol'), tone = card.querySelector('.tone');
    vol.value = s.vol;
    tone.value = s.tone;
    vol.tabIndex = tone.tabIndex = s.on ? 0 : -1;
    paintRange(vol);
    paintRange(tone);
  }
  function renderAllCards() { IDS.forEach(renderCard); }

  function paintRange(r) {
    const min = parseFloat(r.min), max = parseFloat(r.max);
    const p = ((parseFloat(r.value) - min) / (max - min)) * 100;
    if (r.classList.contains('bipolar')) {
      // Fill from the centre outwards.
      r.style.setProperty('--a', Math.min(50, p) + '%');
      r.style.setProperty('--b', Math.max(50, p) + '%');
    } else {
      r.style.setProperty('--p', p + '%');
    }
  }

  function renderPlayState() {
    const starting = Date.now() - playRequestedAt < 1500;
    const running = playing && ctx && (ctx.state === 'running' || starting);
    document.body.classList.toggle('is-playing', !!running);
    playBtn.setAttribute('aria-label', running ? 'Pause' : 'Play');
    const label = mixLabel();
    if (playing && ctx && ctx.state !== 'running' && !starting) {
      statusEl.textContent = 'Tap play to resume';
    } else if (running) {
      statusEl.textContent = label;
    } else if (label) {
      statusEl.textContent = 'Paused · ' + label;
    } else {
      statusEl.textContent = 'Tap play, or choose a noise below';
    }
    if (running) Shape.start();
    renderTimerStatus();
  }

  function formatMinutes(m) {
    if (m < 60) return m + ' min';
    const h = m / 60;
    return (Number.isInteger(h) ? h : h.toFixed(1)) + (h === 1 ? ' hour' : ' hours');
  }
  function formatLeft(ms) {
    const total = Math.ceil(ms / 1000);
    const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  }

  function renderTimerStatus() {
    if (!state.timerMinutes) { timerStatusEl.hidden = true; return; }
    timerStatusEl.hidden = false;
    timerStatusEl.textContent = (playing ? 'Sleep timer · ' : 'Sleep timer (paused) · ') + formatLeft(Timer.left());
  }

  function renderTimerChips() {
    const wrap = $('timerChips');
    wrap.innerHTML = '';
    TIMERS.forEach((m) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(state.timerMinutes === m));
      b.textContent = m === 0 ? 'Off' : m < 60 ? m + 'm' : m / 60 + 'h';
      b.addEventListener('click', () => {
        Timer.set(m);
        renderTimerChips();
        renderTimerStatus();
      });
      wrap.appendChild(b);
    });
  }

  function renderMixChips() {
    const wrap = $('mixChips');
    wrap.innerHTML = '';
    const add = (mix, custom, index) => {
      const chip = document.createElement('span');
      chip.className = 'chip mix-chip' + (custom ? '' : ' preset');
      const apply = document.createElement('button');
      apply.type = 'button';
      apply.className = 'mix-apply';
      apply.textContent = mix.name;
      apply.addEventListener('click', () => applyMix(mix.sounds));
      chip.appendChild(apply);
      if (custom) {
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'mix-del';
        del.setAttribute('aria-label', 'Delete ' + mix.name);
        del.textContent = '×';
        del.addEventListener('click', () => {
          const removed = state.mixes.splice(index, 1)[0];
          save();
          renderMixChips();
          toast(`Deleted “${removed.name}”`, 'Undo', () => {
            state.mixes.splice(index, 0, removed);
            save();
            renderMixChips();
          });
        });
        chip.appendChild(del);
      }
      wrap.appendChild(chip);
    };
    state.mixes.forEach((m, i) => add(m, true, i));
    PRESETS.forEach((m) => add(m, false));
  }

  function setupSaveForm() {
    const form = $('saveForm'), input = $('mixName');
    $('saveMixBtn').addEventListener('click', () => {
      if (!activeIds().length) { toast('Turn on a noise first.'); return; }
      form.hidden = false;
      input.value = '';
      input.focus();
    });
    $('cancelSave').addEventListener('click', () => { form.hidden = true; });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = input.value.trim() || 'My mix ' + (state.mixes.length + 1);
      const sounds = {};
      activeIds().forEach((id) => (sounds[id] = { vol: state.sounds[id].vol, tone: state.sounds[id].tone }));
      state.mixes.unshift({ name, sounds });
      state.mixes = state.mixes.slice(0, 20);
      save();
      form.hidden = true;
      input.blur();
      renderMixChips();
      toast(`Saved “${name}”`);
    });
  }

  function setupGlobalControls() {
    const bind = (id, key, apply) => {
      const r = $(id);
      r.value = state[key];
      paintRange(r);
      r.addEventListener('input', () => {
        state[key] = parseFloat(r.value);
        paintRange(r);
        apply();
        save();
      });
    };
    bind('masterVol', 'master', () => ctx && setParam(masterGain.gain, masterLevel(), 0.08));
    bind('width', 'width', applyCharacter);
    bind('drift', 'drift', applyCharacter);
  }

  let toastTimer = 0;
  function toast(msg, actionLabel, action) {
    const el = $('toast'), btn = $('toastAction');
    $('toastMsg').textContent = msg;
    btn.hidden = !actionLabel;
    btn.textContent = actionLabel || '';
    btn.onclick = action ? () => { el.hidden = true; action(); } : null;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), actionLabel ? 6000 : 3500);
  }

  function setGreeting() {
    const h = new Date().getHours();
    $('greeting').textContent =
      h < 5 ? 'Late night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 22 ? 'Good evening' : 'Good night';
  }

  function scatterStars() {
    document.querySelectorAll('.stars').forEach((layer, k) => {
      const n = k ? 14 : 40;
      const shadows = [];
      for (let i = 0; i < n; i++) {
        const x = (Math.random() * 100).toFixed(2), y = (Math.random() * 70).toFixed(2);
        const a = (0.25 + Math.random() * 0.5).toFixed(2);
        shadows.push(`${x}vw ${y}vh 0 rgba(220,225,255,${a})`);
      }
      layer.style.boxShadow = shadows.join(',');
    });
  }

  /* ================================================================
   * Lifecycle
   * ================================================================ */

  function onVisibility() {
    if (document.visibilityState !== 'visible') { Shape.stop(); return; }
    Timer.check();
    setGreeting();
    if (playing && ctx && ctx.state !== 'running') ctx.resume().catch(() => {}).then(renderPlayState);
    Night.onVisible();
    renderPlayState();
  }

  function init() {
    setGreeting();
    scatterStars();
    buildCards();
    renderTimerChips();
    renderMixChips();
    setupSaveForm();
    setupGlobalControls();
    setupMediaSession();
    Night.bindEvents();
    Timer.init();
    renderPlayState();

    playBtn.addEventListener('click', togglePlay);
    $('nightBtn').addEventListener('click', () => Night.open());

    document.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !/INPUT|BUTTON|TEXTAREA|SELECT/.test(e.target.tagName)) {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'Escape' && Night.isOpen()) {
        Night.close();
      }
    });
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', onVisibility);
    window.addEventListener('resize', () => Shape.resize());
    document.addEventListener('fullscreenchange', () => {
      // Leaving full screen with the back gesture also leaves the night screen.
      if (!document.fullscreenElement && Night.isOpen()) Night.close();
    });

    // Gentle once-a-second refresh of the countdown while visible.
    setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      Timer.check();
      if (state.timerMinutes) renderTimerStatus();
    }, 1000);

    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
    }
  }

  init();
})();
