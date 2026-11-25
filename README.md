# Sleep Tones

A calm, browser-based **white, pink and brown noise** machine for sleep. Works on phones and desktops, installs to the home screen, and runs offline.

## The noise

- **Generated live, never repeats.** Noise is synthesised in real time on the audio thread (AudioWorklet), so there's no loop for your ear to latch on to.
- **Accurate colours.** White is flat, pink falls 3 dB per octave (Paul Kellet's filter), and brown falls 6 dB per octave above ~30 Hz. Brown is built from the device's sample rate, so it sounds the same on 44.1 kHz and 48 kHz phones. Inaudible sub-bass is trimmed so it doesn't waste speaker headroom.
- **Loudness-matched.** The three colours are calibrated to sound about equally loud, so switching or blending them doesn't jump in volume.
- **Tone, per colour.** A gentle spectral tilt (±8 dB shelves around 700 Hz) makes each noise darker or brighter without changing its character. Double-tap the slider to return to natural.
- **Width.** Left and right are independent generators. Slide from mono to fully wide stereo.
- **Drift** (off by default). A very slow, barely-there wander in level and softness, for people who find perfectly static noise tiring. It's a refined version of the original "randomness" control.
- **Sound shape.** A slow, smoothed curve shows the spectrum of your current blend.

## Everything else

- **Mixes:** Balanced, Deep sleep, Pure pink, Soft white, Mask snoring, Low rumble, plus your own saved blends.
- **Sleep timer** (15 min – 3 h) with a slow fade over the last few minutes. The fade is scheduled on the audio clock, so it stays on time with the screen off.
- **Lock-screen and notification controls** (Media Session), and keeps playing with the screen off.
- **Night screen** (moon button): near-black, with a dim clock that drifts slightly to protect OLED screens. It keeps the screen awake; tap to return.
- Remembers your blend and settings. Respects *reduced motion*, and sets `color-scheme: dark` so Samsung Internet's forced dark mode leaves it alone.

## Running it

It's a static site with no build step:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`. On a phone, serve it over **HTTPS** (GitHub Pages works well: *Settings → Pages → Deploy from branch*). Live generation, install, offline mode and the wake lock all need HTTPS. Over plain `http://` on a local network, or opened from disk, it falls back to 45-second pre-rendered stereo loops, and Width and Drift have no effect.

## Tips for Android / Samsung Galaxy

- Install it: browser menu → **Add to Home screen** / **Install app**.
- Phone speakers can't reproduce deep bass, so brown noise sounds thinner on them. Headphones or a bedside speaker bring it out.
- If playback stops after a long time with the screen off, set your browser's battery usage to **Unrestricted** (*Settings → Apps → Chrome / Samsung Internet → Battery*).

## Files

| File | Purpose |
|---|---|
| `index.html`, `style.css` | Page and styles |
| `app.js` | Audio graph, tone/width/drift, timer, media controls, UI, persistence |
| `noise.js` | Noise DSP: the AudioWorklet processor, also used for the fallback loops |
| `sw.js` | Offline cache |
| `manifest.webmanifest`, `icons/` | Install metadata and icons |

When you change any app file, bump `CACHE` in `sw.js` so installed copies pick up the update.

Based on the original *Sleep Tones 2* pen by Steven Roberts (MIT).
