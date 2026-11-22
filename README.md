# Sleep Tones

A calm, browser-based sleep sound machine. Works on phones and desktops, installs to the home screen, and runs offline.

Every sound is **generated in the browser**: no audio files are downloaded. Each one is synthesised into a seamless loop, so there are no clicks or gaps.

## Sounds

| Noise | Nature | Ambient |
|---|---|---|
| White, Pink, Brown | Rain, Ocean, Wind, Stream, Fireplace, Crickets | Fan, Deep tone |

You can layer any of them, each with its own volume. There are built-in mixes (Rainy night, Seaside, Campfire, …), and you can save your own.

## Features

- **Sleep timer** (15 min – 3 h) with a slow fade over the last few minutes. The fade is scheduled on the audio clock, so it stays on time with the screen off.
- **Lock-screen and notification controls** (Media Session) for play and pause.
- **Keeps playing with the screen off.** A quiet media element runs alongside Web Audio so Android treats the page as a media player.
- **Night screen** (moon button): near-black, with a dim clock that drifts slightly to protect OLED screens. It keeps the screen awake; tap to return.
- **Warmth** control softens the whole mix, from bright down to a soft, muffled sound.
- Remembers your last mix, volumes, timer and saved mixes.
- Installable PWA, works offline after the first visit.
- Respects *reduced motion*, and sets `color-scheme: dark` so Samsung Internet's forced dark mode leaves it alone.

## Running it

It's a static site with no build step. Serve the folder over HTTP(S):

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`. To test on a phone, the page must be served over **HTTPS** (or localhost) for install, offline mode and wake lock to work. GitHub Pages works well: *Settings → Pages → Deploy from branch*.

Opening `index.html` directly from disk still plays sound, but without offline or install support.

## Tips for Android / Samsung Galaxy

- Install it: browser menu → **Add to Home screen** / **Install app**.
- If playback stops after a long time with the screen off, set your browser's battery usage to **Unrestricted** (*Settings → Apps → Chrome / Samsung Internet → Battery*).

## Files

| File | Purpose |
|---|---|
| `index.html` | Page structure |
| `style.css` | Styles |
| `app.js` | Audio engine, timer, media controls, UI, persistence |
| `sounds.js` | Procedural sound synthesis (runs in a Web Worker) |
| `sw.js` | Offline cache |
| `manifest.webmanifest`, `icons/` | Install metadata and icons |

When you change any app file, bump `CACHE` in `sw.js` so installed copies pick up the update.

Based on the original *Sleep Tones 2* pen by Steven Roberts (MIT).
