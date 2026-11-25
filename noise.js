/*
 * Sleep Tones — noise DSP.
 *
 * One file, two uses:
 *  - loaded with audioWorklet.addModule(): registers the real-time
 *    "noise-source" processor (endless, never-repeating stereo noise);
 *  - loaded as a normal <script>: exposes window.SleepNoise so the app can
 *    pre-render looped buffers on browsers without AudioWorklet.
 */
(function (g) {
  'use strict';

  const TAU = Math.PI * 2;

  // Gains that make the three colours sound about equally loud, so switching
  // or blending them doesn't jump in volume. Measured at 48 kHz and set halfway
  // (in dB) between A-weighted and plain RMS matching, which suits quiet
  // listening better than either alone, while keeping brown's peaks below 1.0.
  const LEVEL = { white: 0.204, pink: 0.0727, brown: 9.18 };

  function white() {
    return Math.random() * 2 - 1;
  }

  // Pink (-3 dB/octave): Paul Kellet's refined filter.
  function makePink() {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    return function () {
      const w = white();
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      const out = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
      b6 = w * 0.115926;
      return out;
    };
  }

  // Brown (-6 dB/octave above ~30 Hz). Built from the sample rate, so it has
  // the same spectrum on 44.1 kHz and 48 kHz devices. A gentle high-pass keeps
  // inaudible sub-bass from wasting speaker headroom.
  function makeBrown(sr) {
    const a = 1 - Math.exp((-TAU * 30) / sr);
    const h = Math.exp((-TAU * 16) / sr);
    let y = 0, hpIn = 0, hpOut = 0;
    return function () {
      y += a * (white() - y);
      hpOut = h * (hpOut + y - hpIn);
      hpIn = y;
      return hpOut;
    };
  }

  function makeGenerator(color, sr) {
    const level = LEVEL[color];
    let gen;
    if (color === 'white') gen = white;
    else if (color === 'pink') gen = makePink();
    else if (color === 'brown') gen = makeBrown(sr);
    else throw new Error('Unknown noise colour: ' + color);
    for (let i = 0; i < sr; i++) gen(); // settle the filters
    return () => gen() * level;
  }

  /*
   * Drift: a very slow random wander (new direction every 4–12 s, glided
   * with a ~5 s time constant through two smoothing stages, so it never
   * has corners). Used for tiny changes in level and brightness.
   */
  function makeDrift() {
    return { target: 0, cur: 0, out: 0, countdown: 0 };
  }
  function stepDrift(d, dt) {
    if ((d.countdown -= dt) <= 0) {
      d.target = Math.random() * 2 - 1;
      d.countdown = 4 + Math.random() * 8;
    }
    const k = 1 - Math.exp(-dt / 5);
    d.cur += k * (d.target - d.cur);
    d.out += k * (d.cur - d.out);
    return d.out;
  }

  g.SleepNoise = { LEVEL, makeGenerator, makeDrift, stepDrift };

  if (typeof registerProcessor === 'function') {
    class NoiseSource extends AudioWorkletProcessor {
      static get parameterDescriptors() {
        return [
          { name: 'width', defaultValue: 0.7, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
          { name: 'drift', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
        ];
      }

      constructor(options) {
        super();
        const color = options.processorOptions.color;
        // Two fully independent generators: left and right are decorrelated.
        this.a = makeGenerator(color, sampleRate);
        this.b = makeGenerator(color, sampleRate);
        this.da = makeDrift();
        this.db = makeDrift();
        this.la = 0;
        this.lb = 0;
        this.lpK = 1 - Math.exp((-TAU * 1200) / sampleRate);
        this.alive = true;
        this.port.onmessage = (e) => {
          if (e.data === 'stop') this.alive = false;
        };
      }

      process(inputs, outputs, params) {
        const out = outputs[0];
        const L = out[0];
        const R = out[1];
        const n = L.length;
        const width = params.width[0];
        const drift = params.drift[0];

        // Width: right = mix of left's stream and its own, constant power.
        const c = 1 - width;
        const s = Math.sqrt(1 - c * c);

        let ga = 1, gb = 1, ba = 0, bb = 0;
        if (drift > 0) {
          const dt = n / sampleRate;
          const ma = stepDrift(this.da, dt), mb = stepDrift(this.db, dt);
          ga = 1 + 0.28 * drift * ma;                // up to about ±2 dB
          gb = 1 + 0.28 * drift * mb;
          ba = 0.45 * drift * (0.5 + 0.5 * ma);       // gentle softening
          bb = 0.45 * drift * (0.5 + 0.5 * mb);
        }
        const k = this.lpK;
        for (let i = 0; i < n; i++) {
          let x = this.a(), y = this.b();
          if (drift > 0) {
            this.la += k * (x - this.la);
            this.lb += k * (y - this.lb);
            x = (x + (this.la - x) * ba) * ga;
            y = (y + (this.lb - y) * bb) * gb;
          }
          L[i] = x;
          if (R) R[i] = c * x + s * y;
        }
        return this.alive;
      }
    }
    registerProcessor('noise-source', NoiseSource);
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = g.SleepNoise;
})(typeof globalThis !== 'undefined' ? globalThis : this);
