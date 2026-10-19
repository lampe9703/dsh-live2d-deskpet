# DSH Live2D Deskpet

A Live2D desktop pet that runs as a [DeepSeek Harness](https://github.com/deepseek-ai) (DSH) plugin.

It maps the DSH agent lifecycle onto Live2D motions, and in *companion* mode periodically captures the screen and starts a conversation through an **independent** OpenAI-compatible LLM. Bubbles are Chinese; the voice is synthesized locally by **GSV-TTS** (Japanese by default).

> **About this repository**
> An enhanced fork of `dsh-live2d-deskpet`. On top of the original five blocks (models / mode / companion LLM / persona / window) it adds:
> 1. **Local voice** — a GSV-TTS bridge plus audio-clocked bubbles (a bubble appears when its audio *starts*, instead of guessing a reading time);
> 2. **Screen-context injection** — every capture carries a fixed prompt with the current time, the foreground app/window title, and guidance, so replies are actually about the screen;
> 3. **Observability** — voice-bridge health and each companion capture stage are visible in the settings page and the log; nothing fails silently.
>
> This repository ships **build artifacts only** (`lib/` holds the bundled ESM and the browser bundle). There is no TypeScript source or build script here.

Chinese documentation: [README.md](README.md).

---

## Features

- **Agent-state driven**: DSH events normalize into `idle / think / working / celebrate / error`; the renderer picks a motion group per state and falls back to parameter transitions when a group is missing.
- **Transparent overlay window**: frameless, click-through except on the model itself, draggable, lockable size, remembered position, soft bottom fade.
- **Screenshot-driven mode**: interval capture → 8×8 perceptual-hash dedupe → vision request to your own LLM → SSE stream split into bubbles, each spoken as it appears.
- **Task milestone voice**: in agent-driven mode the pet announces "needs your confirmation", "task finished" and "task started" — Chinese bubble, Japanese voice. Signals come from an in-page observer, because the Electron window cannot see the DSH DOM.
- **Local voice**: a small Python bridge exposing `POST /tts`; Chinese text on screen, Japanese audio (optionally via a zh→ja translation endpoint).
- **Personas**: SillyTavern v2 character cards, interoperable with `dsh-cosplay`. A persona only shapes the system message — it never changes the fixed capture prompt.
- **Adult-content block** (optional, off by default; 0.1.8): flipping the switch injects the plugin's built-in adult anchor into the companion system prompt — no prompt writing required. An optional text box overrides the built-in body (trimmed, max 8000 chars). Injected between the memory block and the speech style; only affects the companion endpoint. Results vary by model/provider — cloud services may filter the request outright; the plugin only delivers the anchor.

---

## Requirements

| Requirement | Notes |
| --- | --- |
| DSH 0.2.x | the plugin is inserted into a profile through a loader patch |
| **Cubism 4 core** | `live2dcubismcore.min.js`, **not bundled** — bring your own |
| A Live2D model | not bundled |
| Python 3.10+ with `gsv_tts` | voice only; a dedicated venv is fine |
| GSV-TTS models | GPT `.ckpt`, SoVITS `.pth`, two reference audio clips |

The Cubism core must still export `csmGetDrawableRenderOrders` — Core 6.0.1 dropped it while `pixi-live2d-display` 0.4 still calls it. Core 5.1.0 from the official CDN works.

---

## Install

```powershell
npm pack
dsh plugin --profile desktop add .\dsh-live2d-deskpet-0.1.3.tgz
```

Restart DSH once. After that everything is hot-reloadable from **Settings → Live2D Deskpet**.

---

## Voice setup

Every voice path derives from a single **workspace root** (settings field `GSV 工作区根目录`, env `GSV_WORKSPACE`, or `~/Documents/deepseek-harness/default-workspace`):

```text
<workspace>/
├─ gsv-venv/Scripts/python.exe     # Python with gsv_tts installed
├─ gsv_models/                     # GPT .ckpt + SoVITS .pth
├─ gsv-tts-lite/GSV-TTS-Lite-main/examples/{laffey.mp3,AnAn.ogg}
└─ tmp/                            # bridge scratch dir + gsv-bridge.log
```

The bridge keeps its scratch files under the workspace on purpose: on some Windows setups Python hangs forever creating files in `%TEMP%` (while Node/PowerShell write there fine), so the default must not be the system temp dir.

Status shown in settings: **ready** / **loading models** (5–20s cold start) / **unreachable** (only after 15–30s of consecutive failures, with a readable reason and the log path).

---

## Privacy

- Captures happen **only** in screenshot-driven mode with "allow screenshots" on, at most once per screenshot interval (**seconds since 0.1.7**, min 10 s, default 600 s = 10 min, range 10–10800), primary display only.
- Near-duplicate frames are dropped before any request. Accepted PNGs go to **the LLM endpoint you configured**.
- Each capture also sends a **fixed, hard-coded prompt** (`lib/shared/screen-context.js`) containing the current time, the foreground app name, the window title, and guidance text.
- **Companion memory** (optional, off by default; 0.1.7): the time, the foreground app and each spoken line are appended to `~/.dsh/live2d-deskpet/memory/turns.jsonl` and replayed as text-only conversation history on the next request, plus a "recently said" list in the system prompt to stop stock-phrase loops. Only a one-line screen summary is stored — never screen contents; suspected passwords, ID numbers and keys are redacted before writing. The clear button empties the file atomically; a missing or corrupted file simply reads as empty.
- **Adult-content block** (0.1.8): the built-in anchor and any custom override live only in `~/.dsh/settings.yaml` (live2d-deskpet section) on this machine. `nsfw` is never part of a persona and never travels with an exported character card. Logs record only the source (builtin/custom/off) and the injected length — never the text; debug logs mask it like a secret.
- ⚠️ **Window titles leave the machine** and can contain file names or chat participant names. Raise the interval or disable screenshots if that matters to you.
- API keys are stored with the `secret` role in `~/.dsh/settings.yaml`, never echoed back, masked in the UI (first 4 + `••••` + last 4), and redacted as `***` in debug logs.
- The plugin never reads or reuses DSH's own LLM credentials, and never sends companion traffic to DSH's provider.

---

## Layout

```text
lib/
├─ index.js          plugin entry: apply(), Config, Typert Remote manifest
├─ config.js         settings schema (volatile → hot reload)
├─ core/             AgentStateResolver, ModelRegistry
├─ host/             DesktopPetHost: loopback HTTP+WS, model serving, bridge lifecycle & health polling
├─ electron/         main process, preload, renderer page + renderer bundle, services/
├─ shared/           pure helpers shared by host / Electron / browser (no node built-ins)
└─ client/           settings-page bundle
tts/gsv_bridge.py    GSV-TTS local synthesis bridge
cordis.patch.yml     loader patch inserted into the profile
```

---

## Debug switches

| Env var | Effect |
| --- | --- |
| `DESKPET_DEBUG=1` | writes `~/.dsh/live2d-deskpet/bootstrap.log` (off by default; secrets redacted) |
| `DESKPET_CAPTURE=<path>` | the pet window exports its own pixels as PNG |
| `DESKPET_CAPTURE_DELAY_MS` | delay for the above (default 12000) |
| `GSV_WORKSPACE` | overrides the GSV workspace root |

---

## License

MIT — see [LICENSE](LICENSE). Live2D Cubism Core, Live2D models, GSV-TTS and its models, pixi.js and pixi-live2d-display are **not** distributed here; obtain them yourself and follow their terms.

> AI生成