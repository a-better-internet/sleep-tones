/* Sleep Tones — app */
(function () {
  'use strict';

  /* ================================================================
   * Catalogue
   * ================================================================ */

  const ICONS = {
    rain: '<path d="M7 15.5a4 4 0 0 1-.7-7.94A5.5 5.5 0 0 1 17 8.2a3.6 3.6 0 0 1 .4 7.3z"/><path d="M8.5 18.5l-.8 1.8M12.5 18.5l-.8 1.8M16.5 18.5l-.8 1.8"/>',
    ocean: '<path d="M2 10c1.7 0 1.7-1.6 3.4-1.6S7.1 10 8.8 10s1.7-1.6 3.4-1.6S13.9 10 15.6 10s1.7-1.6 3.4-1.6S20.3 10 22 10"/><path d="M2 15c1.7 0 1.7-1.6 3.4-1.6S7.1 15 8.8 15s1.7-1.6 3.4-1.6S13.9 15 15.6 15s1.7-1.6 3.4-1.6S20.3 15 22 15"/>',
    wind: '<path d="M3 8.5h10.5a2.75 2.75 0 1 0-2.75-2.75"/><path d="M3 12.5h15a3 3 0 1 1-3 3"/><path d="M3 16.5h6"/>',
    stream: '<path d="M12 3.5s5.5 6 5.5 10.2a5.5 5.5 0 0 1-11 0C6.5 9.5 12 3.5 12 3.5z"/><path d="M9.6 14.2a2.5 2.5 0 0 0 2.4 2.3"/>',
    fire: '<path d="M12 21a5.5 5.5 0 0 0 5.5-5.5c0-4.2-3.3-6-4-10-2 1.7-3 3.7-3.2 5.6C9.5 10.3 9 9.3 8.8 8.2 7.4 9.7 6.5 12 6.5 15.5A5.5 5.5 0 0 0 12 21z"/><path d="M12 21a2.3 2.3 0 0 1-2.3-2.3c0-1.6 1.2-2.4 2.3-3.9 1.1 1.5 2.3 2.3 2.3 3.9A2.3 2.3 0 0 1 12 21z"/>',
    crickets: '<path d="M5 21c0-5 .8-9 3-12.5M9.5 21c0-4.5-.3-8.5-1.8-13M13.5 21c0-5 1.8-9 5-11.5M17.5 21c0-3 .8-5.5 2.8-7.5"/><path d="M15 4.5c.8.6.8 1.9 0 2.5M17.5 3c1.6 1.4 1.6 4.1 0 5.5"/>',
    fan: '<circle cx="12" cy="11" r="8"/><circle cx="12" cy="11" r="1.3"/><path d="M12 9.7c-.3-2.3.6-4.2 2-4.2 1.7 0 1.6 2.6-2 4.2zM13.2 11.7c2 .9 3.2 2.5 2.5 3.7-.8 1.4-3-.1-2.5-3.7zM10.8 11.7c-1.7 1.4-3.7 1.8-4.4.6-.8-1.4 1.4-2.8 4.4-.6zM9 21h6M12 19v2"/>',
    drone: '<path d="M2.5 12c1.6 0 1.6-5 3.2-5s1.6 10 3.2 10 1.6-10 3.2-10 1.6 10 3.2 10 1.6-10 3.2-10 1.6 5 3.2 5"/>',
  };

  const SOUNDS = [
    { id: 'white', name: 'White', group: 'noise', dot: '#e8ebf7' },
    { id: 'pink', name: 'Pink', group: 'noise', dot: '#efb3c4' },
    { id: 'brown', name: 'Brown', group: 'noise', dot: '#b88d6c' },
    { id: 'rain', name: 'Rain', group: 'nature' },
    { id: 'ocean', name: 'Ocean', group: 'nature' },
    { id: 'wind', name: 'Wind', group: 'nature' },
    { id: 'stream', name: 'Stream', group: 'nature' },
    { id: 'fire', name: 'Fireplace', group: 'nature', icon: 'fire' },
    { id: 'crickets', name: 'Crickets', group: 'nature' },
    { id: 'fan', name: 'Fan', group: 'ambient' },
    { id: 'drone', name: 'Deep tone', group: 'ambient' },
  ];
  const BY_ID = Object.fromEntries(SOUNDS.map((s) => [s.id, s]));

  const PRESETS = [
    { name: 'Rainy night', sounds: { rain: 0.7, brown: 0.35 } },
    { name: 'Seaside', sounds: { ocean: 0.75, wind: 0.2 } },
    { name: 'Campfire', sounds: { fire: 0.7, crickets: 0.3, wind: 0.15 } },
    { name: 'Forest stream', sounds: { stream: 0.6, crickets: 0.25, wind: 0.15 } },
    { name: 'Deep rest', sounds: { brown: 0.65, drone: 0.3 } },
    { name: 'Box fan', sounds: { fan: 0.7, pink: 0.2 } },
  ];
  const DEFAULT_MIX = PRESETS[0].sounds;

  const TIMERS = [0, 15, 30, 45, 60, 90, 120, 180];

  /* ================================================================
   * State (persisted)
   * ================================================================ */

  const STORE_KEY = 'sleeptones.v1';

  const state = {
    sounds: {},          // id -> { on, vol }
    master: 0.8,
    warmth: 0.25,
    timerMinutes: 0,
    mixes: [],           // [{ name, sounds: { id: vol } }]
  };
  SOUNDS.forEach((s) => (state.sounds[s.id] = { on: false, vol: 0.6 }));

  (function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (saved.sounds) {
        for (const id in saved.sounds) {
          if (!state.sounds[id]) continue;
          state.sounds[id].on = !!saved.sounds[id].on;
          state.sounds[id].vol = clamp01(saved.sounds[id].vol, 0.6);
        }
      }
      state.master = clamp01(saved.master, state.master);
      state.warmth = clamp01(saved.warmth, state.warmth);
      if (TIMERS.includes(saved.timerMinutes)) state.timerMinutes = saved.timerMinutes;
      if (Array.isArray(saved.mixes)) {
        state.mixes = saved.mixes.filter((m) => m && typeof m.name === 'string' && m.sounds).slice(0, 20);
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

  function clamp01(v, fallback) {
    v = Number(v);
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;
  }

  const activeIds = () => SOUNDS.filter((s) => state.sounds[s.id].on).map((s) => s.id);

  /* ================================================================
   * Sound generation (Web Worker with main-thread fallback)
   * ================================================================ */

  const Gen = (function () {
    let worker = null;
    let seq = 0;
    const pending = new Map();

    try {
      if (/^https?:$/.test(location.protocol) && typeof Worker !== 'undefined') {
        worker = new Worker('sounds.js');
        worker.onmessage = (e) => {
          const p = pending.get(e.data.id);
          if (!p) return;
          pending.delete(e.data.id);
          e.data.ok ? p.resolve(e.data.result) : p.reject(new Error(e.data.error));
        };
        worker.onerror = () => {
          // Worker unusable: finish everything on the main thread instead.
          worker = null;
          pending.forEach((p) => p.fallback());
          pending.clear();
        };
      }
    } catch (e) { worker = null; }

    function local(name, sampleRate) {
      return new Promise((resolve, reject) => {
        // Yield first so the UI can paint the loading state.
        setTimeout(() => {
          try { resolve(window.SleepToneGen.generate(name, sampleRate)); } catch (err) { reject(err); }
        }, 30);
      });
    }

    function generate(name, sampleRate) {
      if (!worker) return local(name, sampleRate);
      return new Promise((resolve, reject) => {
        const id = ++seq;
        pending.set(id, {
          resolve, reject,
          fallback: () => local(name, sampleRate).then(resolve, reject),
        });
        worker.postMessage({ id, name, sampleRate });
      });
    }

    return { generate };
  })();

  // Raw sample data keyed by name@rate, so it can be prepared before audio is allowed to start.
  const rawCache = new Map();
  function getRaw(name, rate) {
    const key = name + '@' + rate;
    if (!rawCache.has(key)) {
      const p = Gen.generate(name, rate);
      rawCache.set(key, p);
      p.catch(() => rawCache.delete(key));
    }
    return rawCache.get(key);
  }

  const bufferCache = new Map();
  function getBuffer(name) {
    if (!bufferCache.has(name)) {
      const p = getRaw(name, ctx.sampleRate).then((raw) => {
        const len = raw.channels[0].length;
        const buf = ctx.createBuffer(raw.channels.length, len, raw.sampleRate);
        raw.channels.forEach((data, c) => {
          if (buf.copyToChannel) buf.copyToChannel(data, c);
          else buf.getChannelData(c).set(data);
        });
        return buf;
      });
      bufferCache.set(name, p);
      p.catch(() => bufferCache.delete(name));
    }
    return bufferCache.get(name);
  }

  /* ================================================================
   * Audio engine
   *
   *   voices ─► bus ─► warmth (lowpass) ─► master ─► fade ─► limiter ─► speakers
   * ================================================================ */

  let ctx = null;
  let bus, warmthFilter, masterGain, fadeGain, limiter;
  const voices = new Map(); // id -> { gain, sources, trim, stopped }
  let playing = false;      // what the user wants
  let pauseToken = 0;
  let playRequestedAt = 0;

  function ensureContext() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) {
      toast('Sorry, this browser cannot play generated audio.');
      throw new Error('No Web Audio');
    }
    try { ctx = new AC({ latencyHint: 'playback' }); } catch (e) { ctx = new AC(); }

    bus = ctx.createGain();
    warmthFilter = ctx.createBiquadFilter();
    warmthFilter.type = 'lowpass';
    warmthFilter.Q.value = 0;
    masterGain = ctx.createGain();
    fadeGain = ctx.createGain();
    fadeGain.gain.value = 0;
    limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 6;
    limiter.ratio.value = 4;
    limiter.attack.value = 0.01;
    limiter.release.value = 0.4;

    bus.connect(warmthFilter).connect(masterGain).connect(fadeGain).connect(limiter).connect(ctx.destination);
    applyMaster(true);
    applyWarmth(true);

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

  const level = (v) => v * v; // perceptual slider curve

  function setParam(param, value, timeConstant) {
    const now = ctx.currentTime;
    param.cancelScheduledValues(now);
    param.setTargetAtTime(value, now, timeConstant);
  }

  function applyMaster(instant) {
    if (!ctx) return;
    const v = level(state.master) * 1.2;
    instant ? (masterGain.gain.value = v) : setParam(masterGain.gain, v, 0.08);
  }

  function warmthHz() {
    // 0 → 18 kHz (bright), 1 → 700 Hz (very soft)
    return 18000 * Math.pow(700 / 18000, state.warmth);
  }
  function applyWarmth(instant) {
    if (!ctx) return;
    instant ? (warmthFilter.frequency.value = warmthHz()) : setParam(warmthFilter.frequency, warmthHz(), 0.1);
  }

  function fadeTo(target, seconds) {
    const g = fadeGain.gain, now = ctx.currentTime;
    const current = g.value;
    g.cancelScheduledValues(now);
    g.setValueAtTime(current, now);
    g.linearRampToValueAtTime(target, now + seconds);
  }

  async function startVoice(id) {
    if (!ctx || voices.has(id)) return;
    const v = { gain: ctx.createGain(), sources: [], trim: 1, stopped: false };
    v.gain.gain.value = 0;
    v.gain.connect(bus);
    voices.set(id, v);
    setTileLoading(id, true);

    let buf;
    try {
      buf = await getBuffer(id);
    } catch (e) {
      console.error(e);
      voices.delete(id);
      v.gain.disconnect();
      state.sounds[id].on = false;
      renderTile(id);
      toast('Could not create ' + BY_ID[id].name.toLowerCase() + ' sound.');
      return;
    } finally {
      setTileLoading(id, false);
    }
    if (v.stopped) return;

    const t = ctx.currentTime + 0.05;
    const makeSource = () => {
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      return s;
    };

    if (buf.numberOfChannels >= 2) {
      const s = makeSource();
      s.connect(v.gain);
      s.start(t, Math.random() * buf.duration);
      v.sources.push(s);
    } else {
      // Two copies at different points in the loop, panned apart: a wide,
      // natural stereo image from a single mono loop.
      const offset = Math.random() * buf.duration;
      [-0.65, 0.65].forEach((pan, k) => {
        const s = makeSource();
        if (ctx.createStereoPanner) {
          const p = ctx.createStereoPanner();
          p.pan.value = pan;
          s.connect(p).connect(v.gain);
        } else {
          s.connect(v.gain);
        }
        s.start(t, (offset + k * buf.duration * 0.5) % buf.duration);
        v.sources.push(s);
      });
      v.trim = 0.75;
    }
    v.gain.gain.setTargetAtTime(level(state.sounds[id].vol) * v.trim, t, 0.45);
  }

  function stopVoice(id, fadeSeconds = 0.8) {
    const v = voices.get(id);
    if (!v) return;
    voices.delete(id);
    v.stopped = true;
    const end = () => {
      v.sources.forEach((s) => { try { s.stop(); } catch (e) { /* ignore */ } });
      try { v.gain.disconnect(); } catch (e) { /* ignore */ }
    };
    if (!ctx || ctx.state !== 'running') return end();
    const g = v.gain.gain, now = ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + fadeSeconds);
    setTimeout(end, fadeSeconds * 1000 + 150);
  }

  function setVoiceVolume(id) {
    const v = voices.get(id);
    if (v && ctx) setParam(v.gain.gain, level(state.sounds[id].vol) * v.trim, 0.08);
  }

  /* ---------- transport ---------- */

  function play() {
    if (!activeIds().length) {
      applyMixState(DEFAULT_MIX);
      renderAllTiles();
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
        if (token === pauseToken && !playing && ctx.state === 'running') ctx.suspend().catch(() => {});
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

  function toggleSound(id) {
    const s = state.sounds[id];
    s.on = !s.on;
    save();
    renderTile(id);
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
    SOUNDS.forEach(({ id }) => {
      const s = state.sounds[id];
      if (mix[id] != null) {
        s.on = true;
        s.vol = clamp01(mix[id], s.vol);
      } else {
        s.on = false;
      }
    });
  }

  function applyMix(mix) {
    applyMixState(mix);
    save();
    renderAllTiles();
    if (playing) {
      SOUNDS.forEach(({ id }) => {
        if (state.sounds[id].on) {
          voices.has(id) ? setVoiceVolume(id) : startVoice(id);
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
        el.setAttribute('aria-hidden', 'true');
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
    const ms = navigator.mediaSession;
    const handlers = {
      play: () => play(),
      pause: () => pause(),
      stop: () => pause(),
    };
    for (const action in handlers) {
      try { ms.setActionHandler(action, handlers[action]); } catch (e) { /* unsupported */ }
    }
  }

  function updateMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const names = activeIds().map((id) => BY_ID[id].name);
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: names.length ? names.join(' · ') : 'Sleep Tones',
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
      const d = new Date();
      const parts = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).split(/\s+/);
      clock.textContent = parts[0];
      if (parts[1]) {
        const ampm = document.createElement('span');
        ampm.className = 'night-ampm';
        ampm.textContent = parts.slice(1).join(' ');
        clock.appendChild(ampm);
      }
      const bits = [];
      if (playing) bits.push(activeIds().map((id) => BY_ID[id].name).join(' · '));
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
        if (lock) { lock.release().catch(() => {}); lock = null; }
        try {
          if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
        } catch (e) { /* ignore */ }
      },
      isOpen: () => !el.hidden,
      onVisible() { if (!el.hidden && !lock) requestLock(); },
      bind() { el.addEventListener('click', () => this.close()); },
    };
  })();

  /* ================================================================
   * UI
   * ================================================================ */

  const $ = (id) => document.getElementById(id);
  const playBtn = $('playBtn');
  const statusEl = $('status');
  const timerStatusEl = $('timerStatus');

  function iconFor(s) {
    if (s.dot) return `<span class="noise-dot" style="--dot:${s.dot}"></span>`;
    return `<svg viewBox="0 0 24 24">${ICONS[s.icon || s.id]}</svg>`;
  }

  function buildTiles() {
    SOUNDS.forEach((s) => {
      const tile = document.createElement('div');
      tile.className = 'tile';
      tile.dataset.id = s.id;
      tile.innerHTML = `
        <button type="button" class="tile-toggle" aria-pressed="false">
          <span class="tile-icon" aria-hidden="true">${iconFor(s)}</span>
          <span class="tile-name">${s.name}</span>
        </button>
        <div class="tile-vol-wrap">
          <input type="range" min="0" max="1" step="0.01" aria-label="${s.name} volume">
        </div>`;
      const btn = tile.querySelector('button');
      const range = tile.querySelector('input');
      btn.addEventListener('click', () => toggleSound(s.id));
      range.addEventListener('input', () => {
        state.sounds[s.id].vol = parseFloat(range.value);
        paintRange(range);
        setVoiceVolume(s.id);
        save();
      });
      $('group-' + s.group).appendChild(tile);
      renderTile(s.id);
    });
  }

  function tileEl(id) { return document.querySelector(`.tile[data-id="${id}"]`); }

  function renderTile(id) {
    const tile = tileEl(id);
    if (!tile) return;
    const s = state.sounds[id];
    tile.classList.toggle('on', s.on);
    tile.querySelector('button').setAttribute('aria-pressed', String(s.on));
    const range = tile.querySelector('input');
    range.value = s.vol;
    range.tabIndex = s.on ? 0 : -1;
    paintRange(range);
  }
  function renderAllTiles() { SOUNDS.forEach((s) => renderTile(s.id)); }

  function setTileLoading(id, on) {
    const t = tileEl(id);
    if (t) t.classList.toggle('loading', on);
  }

  function paintRange(r) {
    const min = parseFloat(r.min) || 0, max = parseFloat(r.max) || 1;
    r.style.setProperty('--p', ((parseFloat(r.value) - min) / (max - min)) * 100 + '%');
  }

  function renderPlayState() {
    const running = playing && ctx && (ctx.state === 'running' || Date.now() - playRequestedAt < 1500);
    document.body.classList.toggle('is-playing', !!running);
    playBtn.setAttribute('aria-label', running ? 'Pause' : 'Play');
    const names = activeIds().map((id) => BY_ID[id].name);
    if (playing && ctx && ctx.state !== 'running' && Date.now() - playRequestedAt > 1500) {
      statusEl.textContent = 'Tap play to resume';
    } else if (running) {
      statusEl.textContent = names.join(' · ');
    } else if (names.length) {
      statusEl.textContent = 'Paused · ' + names.join(' · ');
    } else {
      statusEl.textContent = 'Tap play, or choose a sound';
    }
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
    const left = Timer.left();
    timerStatusEl.textContent = (playing ? 'Sleep timer · ' : 'Sleep timer (paused) · ') + formatLeft(left);
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
      if (!activeIds().length) { toast('Turn on a sound or two first.'); return; }
      form.hidden = false;
      input.value = '';
      input.focus();
    });
    $('cancelSave').addEventListener('click', () => { form.hidden = true; });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = input.value.trim() || 'My mix ' + (state.mixes.length + 1);
      const sounds = {};
      activeIds().forEach((id) => (sounds[id] = state.sounds[id].vol));
      state.mixes.unshift({ name, sounds });
      state.mixes = state.mixes.slice(0, 20);
      save();
      form.hidden = true;
      input.blur();
      renderMixChips();
      toast(`Saved “${name}”`);
    });
  }

  function setupMasterControls() {
    const vol = $('masterVol'), warmth = $('warmth');
    vol.value = state.master;
    warmth.value = state.warmth;
    paintRange(vol);
    paintRange(warmth);
    vol.addEventListener('input', () => {
      state.master = parseFloat(vol.value);
      paintRange(vol);
      applyMaster();
      save();
    });
    warmth.addEventListener('input', () => {
      state.warmth = parseFloat(warmth.value);
      paintRange(warmth);
      applyWarmth();
      save();
    });
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
    const layers = document.querySelectorAll('.stars');
    layers.forEach((layer, k) => {
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

  function onVisible() {
    if (document.visibilityState !== 'visible') return;
    Timer.check();
    setGreeting();
    if (playing && ctx && ctx.state !== 'running') ctx.resume().catch(() => {}).then(renderPlayState);
    Night.onVisible();
    renderPlayState();
  }

  function init() {
    setGreeting();
    scatterStars();
    buildTiles();
    renderTimerChips();
    renderMixChips();
    setupSaveForm();
    setupMasterControls();
    setupMediaSession();
    Night.bind();
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
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onVisible);
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

    // Prepare the remembered sounds in the background so the first tap is instant.
    // (48 kHz is what nearly every phone uses; anything else is regenerated.)
    const guessRate = 48000;
    (activeIds().length ? activeIds() : Object.keys(DEFAULT_MIX)).forEach((id) => getRaw(id, guessRate));

    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
    }
  }

  init();
})();
