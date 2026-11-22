/*
 * Sleep Tones — procedural sound generator.
 *
 * Every sound is synthesised from scratch (no audio files) into a seamless
 * loop. This file runs either as a Web Worker (preferred, keeps the UI smooth)
 * or as a plain script on the main thread as a fallback.
 *
 * generate(name, sampleRate) -> { sampleRate, channels: Float32Array[] }
 *   1 channel  -> the player makes stereo by playing two offset copies
 *   2 channels -> played as-is
 */
(function (root) {
  'use strict';

  const TAU = Math.PI * 2;
  const rnd = Math.random;
  const noise = () => rnd() * 2 - 1;

  /* ---------- building blocks ---------- */

  // Paul Kellet's refined pink noise filter.
  function pinkSource() {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    return function () {
      const w = noise();
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      const out = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
      b6 = w * 0.115926;
      return out * 0.11;
    };
  }

  // Leaky integrated (Brownian / red) noise.
  function brownSource() {
    let last = 0;
    return function () {
      last = (last + 0.02 * noise()) / 1.02;
      return last * 3.5;
    };
  }

  function lowpass(fc, sr) {
    const a = 1 - Math.exp((-TAU * fc) / sr);
    let y = 0;
    return (x) => (y += a * (x - y));
  }

  function highpass(fc, sr) {
    const lp = lowpass(fc, sr);
    return (x) => x - lp(x);
  }

  // Chamberlin state-variable filter, band-pass output, variable cutoff.
  function bandpassSVF(sr) {
    let low = 0, band = 0;
    const maxFc = sr / 6;
    return function (x, fc, damp) {
      const f = 2 * Math.sin((Math.PI * Math.min(fc, maxFc)) / sr);
      low += f * band;
      const high = x - low - damp * band;
      band += f * high;
      return band;
    };
  }

  function warm(fn, n) {
    for (let i = 0; i < n; i++) fn();
  }

  // Equal-power crossfade of the tail onto the head => seamless loop of N samples.
  function loopify(src, N, F) {
    const out = new Float32Array(N);
    out.set(src.subarray(0, N));
    for (let i = 0; i < F; i++) {
      const x = (i / F) * (Math.PI / 2);
      out[i] = src[i] * Math.sin(x) + src[N + i] * Math.cos(x);
    }
    return out;
  }

  // Smooth random curve that is exactly periodic over N samples.
  // harmonics: [[cyclesPerLoop, amplitude], ...]
  function periodic(N, harmonics) {
    const step = 128;
    const M = Math.ceil(N / step) + 2;
    const ctrl = new Float32Array(M);
    const phases = harmonics.map(() => rnd() * TAU);
    for (let m = 0; m < M; m++) {
      const t = (m * step) / N;
      let v = 0;
      for (let j = 0; j < harmonics.length; j++) {
        v += harmonics[j][1] * Math.sin(TAU * harmonics[j][0] * t + phases[j]);
      }
      ctrl[m] = v;
    }
    const out = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const p = i / step, m = p | 0, f = p - m;
      out[i] = ctrl[m] + (ctrl[m + 1] - ctrl[m]) * f;
    }
    return out;
  }

  function norm01(arr) {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] < lo) lo = arr[i];
      if (arr[i] > hi) hi = arr[i];
    }
    const span = hi - lo || 1;
    for (let i = 0; i < arr.length; i++) arr[i] = (arr[i] - lo) / span;
    return arr;
  }

  function rms(arr) {
    let s = 0;
    for (let i = 0; i < arr.length; i++) s += arr[i] * arr[i];
    return Math.sqrt(s / arr.length) || 1e-9;
  }

  function scaleTo(arr, target) {
    const k = target / rms(arr);
    for (let i = 0; i < arr.length; i++) arr[i] *= k;
    return arr;
  }

  function peakTo(arr, target) {
    let p = 1e-9;
    for (let i = 0; i < arr.length; i++) p = Math.max(p, Math.abs(arr[i]));
    const k = target / p;
    for (let i = 0; i < arr.length; i++) arr[i] *= k;
    return arr;
  }

  // Normalise loudness across channels, then gently soft-limit peaks.
  function finish(channels, targetRms) {
    let s = 0, n = 0;
    for (const ch of channels) {
      for (let i = 0; i < ch.length; i++) s += ch[i] * ch[i];
      n += ch.length;
    }
    const k = targetRms / (Math.sqrt(s / n) || 1e-9);
    const knee = 0.6, room = 1 - knee - 0.03;
    for (const ch of channels) {
      for (let i = 0; i < ch.length; i++) {
        let x = ch[i] * k;
        const a = Math.abs(x);
        if (a > knee) x = Math.sign(x) * (knee + room * Math.tanh((a - knee) / room));
        ch[i] = x;
      }
    }
    return channels;
  }

  // Write a short event into a looping buffer (wraps around the end).
  function addEvent(buf, pos, len, fn) {
    const N = buf.length;
    let idx = pos % N;
    for (let j = 0; j < len; j++) {
      buf[idx] += fn(j);
      if (++idx >= N) idx = 0;
    }
  }

  // Noise burst with exponential decay (incremental, no Math.exp per sample).
  function decayingNoise(amp, tau) {
    const k = Math.exp(-1 / tau);
    let g = amp;
    return () => {
      const v = g * noise();
      g *= k;
      return v;
    };
  }

  // Sine whose pitch rises by `rise` over its length, with attack and decay.
  function chirp(sr, f, rise, len, tau, atk, amp) {
    const k = Math.exp(-1 / tau);
    const w0 = (TAU * f) / sr, dw = (w0 * rise) / len;
    let g = amp, ph = 0;
    return (j) => {
      ph += w0 + dw * j;
      const v = g * Math.sin(ph) * (j < atk ? j / atk : 1);
      g *= k;
      return v;
    };
  }

  function noiseLoop(sr, seconds, fadeSec, sample) {
    const N = Math.round(seconds * sr), F = Math.round(fadeSec * sr);
    const raw = new Float32Array(N + F);
    for (let i = 0; i < raw.length; i++) raw[i] = sample(i);
    return loopify(raw, N, F);
  }

  /* ---------- sounds ---------- */

  const generators = {
    white(sr) {
      const ch = noiseLoop(sr, 9, 0.2, noise);
      // Take the sharpest edge off — pure white noise is fatiguing.
      const lp = lowpass(12000, sr);
      for (let i = 0; i < ch.length; i++) ch[i] = lp(ch[i]);
      return { sampleRate: sr, channels: finish([ch], 0.14) };
    },

    pink(sr) {
      const p = pinkSource();
      warm(p, 20000);
      return { sampleRate: sr, channels: finish([noiseLoop(sr, 11, 0.3, p)], 0.17) };
    },

    brown(sr) {
      const b = brownSource();
      warm(b, 20000);
      const hp = highpass(20, sr); // remove sub-sonic drift
      const ch = noiseLoop(sr, 14, 0.5, () => hp(b()));
      return { sampleRate: sr, channels: finish([ch], 0.2) };
    },

    rain(sr) {
      const T = 15, N = Math.round(T * sr);
      // Steady "shhh" bed.
      const p = pinkSource(), hp = highpass(350, sr), lp = lowpass(6500, sr);
      const b = brownSource(), blp = lowpass(300, sr);
      warm(() => lp(hp(p())) + blp(b()), 4000);
      const bed = noiseLoop(sr, T, 0.4, () => lp(hp(p())) + blp(b()) * 0.25);
      scaleTo(bed, 1);
      const swell = periodic(N, [[1, 0.08], [2, 0.06], [3, 0.05], [7, 0.03]]);
      for (let i = 0; i < N; i++) bed[i] *= 1 + swell[i];

      // Individual drops: tiny noise ticks...
      const drops = new Float32Array(N);
      for (let k = 0; k < T * 420; k++) {
        const amp = rnd() ** 3;
        const tau = sr * (0.0004 + rnd() * 0.0016);
        addEvent(drops, (rnd() * N) | 0, (tau * 6) | 0, decayingNoise(amp, tau));
      }
      const dhp = highpass(900, sr);
      for (let i = 0; i < N; i++) drops[i] = dhp(drops[i]);
      scaleTo(drops, 0.5);

      // ...and a few soft "plinks" on leaves and puddles.
      const plinks = new Float32Array(N);
      for (let k = 0; k < T * 18; k++) {
        const f = 1500 + rnd() * 3500;
        const tau = sr * (0.003 + rnd() * 0.008);
        const len = (tau * 5) | 0, atk = sr * 0.0005, amp = rnd() ** 2;
        addEvent(plinks, (rnd() * N) | 0, len, chirp(sr, f, 0.25, len, tau, atk, amp));
      }
      scaleTo(plinks, 0.18);

      for (let i = 0; i < N; i++) bed[i] += drops[i] + plinks[i];
      return { sampleRate: sr, channels: finish([bed], 0.18) };
    },

    ocean(sr) {
      const T = 48, N = Math.round(T * sr), F = Math.round(1.5 * sr);
      const env = waveEnvelope(N, sr);
      const channels = [];
      for (let c = 0; c < 2; c++) {
        const shift = Math.round(c * 0.35 * sr); // right side lags a touch: width
        const e = (i) => env[i >= shift ? i - shift : i - shift + N];
        const b = brownSource(), blp = lowpass(220, sr);
        const p = pinkSource();
        const foamHp = highpass(2500, sr);
        let y1 = 0, y2 = 0;
        warm(b, 5000); warm(p, 5000);

        const rumble = new Float32Array(N + F);
        const wash = new Float32Array(N + F);
        const foam = new Float32Array(N + F);
        let a = 0;
        for (let i = 0; i < N + F; i++) {
          const v = e(i % N);
          rumble[i] = blp(b()) * (0.3 + 0.7 * v);
          if ((i & 31) === 0) a = 1 - Math.exp((-TAU * (250 + 2600 * v * v)) / sr);
          y1 += a * (p() - y1);
          y2 += a * (y1 - y2);
          wash[i] = y2 * v * Math.sqrt(Math.sqrt(v));
          foam[i] = foamHp(noise()) * v * v * v;
        }
        scaleTo(rumble, 0.55);
        scaleTo(wash, 1);
        scaleTo(foam, 0.22);
        for (let i = 0; i < N + F; i++) rumble[i] += wash[i] + foam[i];
        channels.push(loopify(rumble, N, F));
      }
      return { sampleRate: sr, channels: finish(channels, 0.2) };
    },

    wind(sr) {
      const T = 32, N = Math.round(T * sr), F = Math.round(1 * sr);
      const gust = norm01(periodic(N, [[1, 1], [2, 0.7], [3, 0.5], [5, 0.35], [8, 0.22], [13, 0.14], [21, 0.08]]));
      const body = bandpassSVF(sr), whistle = bandpassSVF(sr);
      const p = pinkSource();
      const a = new Float32Array(N + F), w = new Float32Array(N + F);
      for (let i = 0; i < N + F; i++) {
        const g = gust[i % N];
        const x = noise();
        a[i] = body(p() * 3 + x * 0.3, 140 + 650 * g * g, 0.75) * (0.2 + 0.8 * g);
        w[i] = whistle(x, 380 + 1000 * g, 0.1) * g * g;
      }
      scaleTo(a, 1);
      scaleTo(w, 0.22);
      for (let i = 0; i < N + F; i++) a[i] += w[i];
      return { sampleRate: sr, channels: finish([loopify(a, N, F)], 0.18) };
    },

    stream(sr) {
      const T = 18, N = Math.round(T * sr);
      const svf = bandpassSVF(sr), p = pinkSource(), plp = lowpass(500, sr);
      warm(() => svf(noise(), 1500, 0.9), 2000);
      const bed = noiseLoop(sr, T, 0.4, () => svf(noise(), 1500, 0.9) + plp(p()) * 0.8);
      scaleTo(bed, 0.6);

      // Bubbles: short rising sine chirps, clustered in gurgles.
      const bubbles = new Float32Array(N);
      const density = norm01(periodic(N, [[3, 1], [5, 0.8], [11, 0.6], [17, 0.4], [29, 0.3]]));
      for (let k = 0; k < T * 130; k++) {
        const pos = (rnd() * N) | 0;
        if (rnd() > 0.2 + 0.8 * density[pos]) continue;
        const f0 = 400 * Math.pow(8, rnd());
        const tau = sr * 0.012 * Math.sqrt(1500 / f0) * (0.6 + 0.8 * rnd());
        const len = (tau * 4) | 0, atk = sr * 0.001, amp = rnd() ** 2.2;
        addEvent(bubbles, pos, len, chirp(sr, f0, 0.9, len, tau, atk, amp));
      }
      scaleTo(bubbles, 1);
      for (let i = 0; i < N; i++) bed[i] += bubbles[i];
      return { sampleRate: sr, channels: finish([bed], 0.16) };
    },

    fire(sr) {
      const T = 20, N = Math.round(T * sr);
      const b = brownSource(), blp = lowpass(350, sr);
      const p = pinkSource(), plp = lowpass(1500, sr);
      warm(b, 5000);
      const roar = noiseLoop(sr, T, 0.5, () => blp(b()));
      const hiss = noiseLoop(sr, T, 0.5, () => plp(p()));
      const flicker = periodic(N, [[2, 1], [5, 0.7], [9, 0.5], [23, 0.4], [41, 0.3]]);
      norm01(flicker);
      for (let i = 0; i < N; i++) hiss[i] *= 0.5 + 0.5 * flicker[i];
      scaleTo(roar, 0.2);
      scaleTo(hiss, 0.06);

      // Crackles: bursts of tiny clicks.
      const crackle = new Float32Array(N);
      for (let k = 0; k < T * 4; k++) {
        let pos = (rnd() * N) | 0;
        const clicks = 1 + Math.floor(rnd() ** 2 * 10);
        for (let c = 0; c < clicks; c++) {
          const amp = rnd() ** 2.5 * (rnd() < 0.08 ? 1 : 0.45);
          const tau = sr * (0.00015 + rnd() * 0.0008);
          addEvent(crackle, pos, (tau * 7) | 0, decayingNoise(amp, tau));
          pos += Math.round(sr * (0.002 + rnd() * 0.03));
        }
      }
      // Occasional soft wood pops.
      for (let k = 0; k < T * 0.6; k++) {
        const f = 150 + rnd() * 250, tau = sr * 0.012, amp = 0.4 + rnd() * 0.4;
        addEvent(crackle, (rnd() * N) | 0, (tau * 5) | 0, (j) =>
          amp * (Math.sin((TAU * f * j) / sr) * 0.6 + noise() * 0.4) * Math.exp(-j / tau));
      }
      const chp = highpass(1000, sr);
      for (let i = 0; i < N; i++) crackle[i] = chp(crackle[i]);
      peakTo(crackle, 0.55);
      for (let i = 0; i < N; i++) roar[i] += hiss[i] + crackle[i];
      return { sampleRate: sr, channels: finish([roar], 0.17) };
    },

    crickets(sr) {
      const T = 24, N = Math.round(T * sr);
      // A faint bed of night air under the crickets.
      const channels = [];
      for (let c = 0; c < 2; c++) {
        const b = brownSource(), lp = lowpass(500, sr);
        warm(b, 4000);
        channels.push(scaleTo(noiseLoop(sr, T, 0.5, () => lp(b())), 0.015));
      }
      const count = 6;
      for (let n = 0; n < count; n++) {
        const f = 3900 + rnd() * 1300;
        const pan = 0.1 + rnd() * 0.8;
        const gain = 0.12 + 0.7 * rnd() ** 2;
        const chirps = Math.max(8, Math.round(T / (0.45 + rnd() * 0.9)));
        const period = N / chirps;
        const pulses = 2 + Math.floor(rnd() * 3);
        const pulseLen = Math.round(sr * (0.011 + rnd() * 0.008));
        const spacing = Math.round(pulseLen * (1.8 + rnd() * 0.6));
        const mask = norm01(periodic(N, [[1, 1], [2, 0.7], [3, 0.4]]));
        const gl = gain * Math.sqrt(1 - pan), gr = gain * Math.sqrt(pan);
        for (let k = 0; k < chirps; k++) {
          const start = Math.round(k * period + (rnd() - 0.5) * sr * 0.006);
          const m = Math.min(1, Math.max(0, (mask[((start % N) + N) % N] - 0.3) / 0.15));
          if (m <= 0) continue;
          for (let p = 0; p < pulses; p++) {
            const at = (start + p * spacing + N) % N;
            const fn = (j) => {
              const w = Math.sin((Math.PI * j) / pulseLen);
              const ph = (TAU * f * j) / sr;
              return m * w * w * (Math.sin(ph) + 0.12 * Math.sin(2 * ph));
            };
            addEvent(channels[0], at, pulseLen, (j) => gl * fn(j));
            addEvent(channels[1], at, pulseLen, (j) => gr * fn(j));
          }
        }
      }
      return { sampleRate: sr, channels: finish(channels, 0.08) };
    },

    fan(sr) {
      const T = 12, N = Math.round(T * sr);
      const p = pinkSource(), l1 = lowpass(900, sr), l2 = lowpass(900, sr);
      const b = brownSource();
      warm(() => l2(l1(p())), 4000);
      warm(b, 4000);
      const ch = noiseLoop(sr, T, 0.4, () => l2(l1(p())) * 3 + b() * 0.35);
      scaleTo(ch, 1);
      const blade = Math.round(16 * T) / T; // whole cycles per loop
      const hum = Math.round(100 * T) / T;
      for (let i = 0; i < N; i++) {
        const t = i / sr;
        ch[i] = ch[i] * (1 + 0.05 * Math.sin(TAU * blade * t) + 0.02 * Math.sin(TAU * 2 * blade * t))
          + 0.03 * Math.sin(TAU * hum * t);
      }
      return { sampleRate: sr, channels: finish([ch], 0.2) };
    },

    drone(sr) {
      // A soft open chord whose partials slowly breathe. Every frequency is
      // rounded to a whole number of cycles per loop, so the loop is perfect.
      const T = 40, N = Math.round(T * sr);
      const q = (f) => Math.max(1, Math.round(f * T)) / T;
      const partials = [[55, 1], [82.5, 0.6], [110, 0.5], [165, 0.22], [220, 0.12], [247.5, 0.05]];
      const channels = [new Float32Array(N), new Float32Array(N)];
      partials.forEach(([f0, amp], j) => {
        for (let c = 0; c < 2; c++) {
          const f = q(f0 + (c ? 1 : -1) * (0.05 + 0.03 * j));
          const breath = periodic(N, [[1 + (j % 3), 0.35], [5 + j, 0.08]]);
          const w = (TAU * f) / sr;
          const dc = Math.cos(w), ds = Math.sin(w);
          let ph = rnd() * TAU, co = Math.cos(ph), si = Math.sin(ph);
          const out = channels[c];
          for (let i = 0; i < N; i++) {
            out[i] += amp * (0.65 + breath[i]) * si;
            const nc = co * dc - si * ds;
            si = si * dc + co * ds;
            co = nc;
          }
        }
      });
      return { sampleRate: sr, channels: finish(channels, 0.14) };
    },
  };

  // Periodic envelope of breaking waves (values 0..1).
  function waveEnvelope(N, sr) {
    const total = N / sr;
    const durs = [];
    let sum = 0;
    while (sum < total) {
      const d = 7 + rnd() * 6;
      durs.push(d);
      sum += d;
    }
    const k = total / sum;
    const env = new Float32Array(N);
    const K = 3.5, eK = Math.exp(-K);
    let start = 0;
    for (const d of durs) {
      const len = Math.round(d * k * sr);
      const peak = 0.55 + 0.45 * rnd();
      const r = 0.3 + 0.15 * rnd();
      for (let j = 0; j < len; j++) {
        const x = j / len;
        let e;
        if (x < r) {
          const u = x / r;
          e = u * u * (3 - 2 * u);
        } else {
          const y = (x - r) / (1 - r);
          e = (Math.exp(-K * y) - eK) / (1 - eK);
        }
        const idx = (start + j) % N;
        env[idx] = Math.max(env[idx], 0.12 + 0.88 * peak * e);
      }
      start += len;
    }
    // Smooth (periodically, two passes) so there are no kinks.
    const a = 1 - Math.exp((-TAU * 1.2) / sr);
    let y = env[N - 1];
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < N; i++) env[i] = y += a * (env[i] - y);
    }
    return env;
  }

  // Low-bandwidth sounds are generated at half rate: same sound, half the memory.
  const LOW_RATE = { brown: 1, ocean: 1, wind: 1, fan: 1, drone: 1, crickets: 1 };

  function generate(name, contextRate) {
    const gen = generators[name];
    if (!gen) throw new Error('Unknown sound: ' + name);
    const sr = LOW_RATE[name] ? Math.max(22050, Math.round(contextRate / 2)) : contextRate;
    return gen(sr);
  }

  const api = { generate, names: Object.keys(generators) };

  const isWorker = typeof document === 'undefined' && typeof self !== 'undefined' && typeof self.postMessage === 'function';
  if (isWorker) {
    self.onmessage = function (e) {
      const { id, name, sampleRate } = e.data;
      try {
        const result = generate(name, sampleRate);
        self.postMessage({ id, ok: true, result }, result.channels.map((c) => c.buffer));
      } catch (err) {
        self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
      }
    };
  } else {
    root.SleepToneGen = api;
  }
})(typeof self !== 'undefined' ? self : this);
