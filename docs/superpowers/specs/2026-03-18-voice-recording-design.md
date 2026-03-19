# Voice Recording for Persona Settings

**Date:** 2026-03-18
**Status:** Approved

## Summary

Add in-browser audio recording as a first-class alternative to WAV file upload in the persona settings voice section. Users read 3 guided prompt sentences aloud, review the recording, and upload it — all inline in the existing panel.

## Architecture

### New hook: `useVoiceRecorder`

Location: `packages/core/src/hooks/useVoiceRecorder.ts`

Wraps `useTenVAD` (reusing existing mic access, AudioWorklet, and RMS level data) and exposes a state machine:

```
idle → ready → recording → review → (upload via existing uploadVoice)
                  ↑           |
                  └── re-record
```

Responsibilities:
- Calls `useTenVAD` with `onRawAudio` to accumulate PCM Float32 chunks into a buffer
- Tracks elapsed time, auto-stops at 45s
- Computes RMS stats from `onFrameProcessed` for level meter + quality checks
- On stop: encodes accumulated Float32 PCM → WAV blob (~40-line inline helper)
- Exposes: `{ state, elapsed, rmsLevel, loading, error, start, stop, reset, wavBlob, qualityWarning }`

`useVoiceRecorder` accumulates PCM in its own buffer via `onRawAudio` — independent from `useTenVAD`'s internal `audioChunksRef`. When `useTenVAD.pause()` is called (recording → review), the VAD tears down its audio graph and resets its own state, but the recorder's PCM buffer is preserved. Quality checks run on the raw Float32 buffer before WAV encoding.

No `MediaRecorder` needed — raw PCM at 16 kHz mono comes from the existing AudioWorklet. WAV encoding is a header + raw PCM bytes.

The VAD WASM module loads regardless (already cached from normal voice usage). VAD speech segmentation callbacks are unused — only `onRawAudio` and `onFrameProcessed` are consumed.

## UI Flow

### Entry point

The current single `"+ Upload voice sample (WAV, max 30s)"` dashed button in `VoiceSection` becomes two side-by-side buttons of equal prominence:

- **"Record voice sample"** — opens inline recording flow
- **"Upload WAV (max 45s)"** — existing file picker behavior, unchanged (label updated from 30s)

When either flow is active, both buttons hide and the active flow takes their place inline. Max 10 voices limit applies to both.

### Recording flow — 3 inline states

All rendered inline in the Voice section, matching existing PersonaSettings inline styles.

#### State 0: Loading / Error

While `useTenVAD` loads WASM (`loading: true`): show "Preparing microphone..." with a subtle spinner. If WASM load fails or mic permission is denied (`error` is set): show error message ("Microphone access denied" or "Could not initialize recorder") with only a **"Cancel"** button — graceful fallback to upload-only.

#### State 1: Ready

- Coaching line: *"Use a quiet room and speak naturally."*
- Numbered prompt sentences displayed statically with clear spacing
- Note: *"Pause briefly between each sentence."*
- Level meter (grey, live from `onFrameProcessed.rms` — mic acquired on mount to confirm it works)
- Buttons: **"Start recording"** (red, with record dot) + **"Cancel"**

#### State 2: Recording

- Same static prompt text (no progression tracking — simple and reliable)
- Level meter (red, active)
- Elapsed timer counting up: `0:14 / 0:45`
- Red recording indicator dot
- Red-tinted border on container
- Button: **"Stop recording"**
- Auto-stops at 45s with a brief timer flash

#### State 3: Review

- Playback button + static waveform (downsampled from PCM buffer to ~100 bars, rendered as divs)
- Quality badge: green "Good quality" or yellow warning (see Quality Gates)
- Editable name field, pre-filled with `"Recording"`
- Buttons: **"Use this recording"** (calls existing `uploadVoice`) + **"Re-record"** (returns to Ready state)

## Prompt Sentences

Three hardcoded sentences designed for voice cloning variance — covering declarative, interrogative, and warm/polite intonation:

1. *"Good morning. I am here to help you with your registration process today."*
2. *"Could you please provide your business name and the type of license you need?"*
3. *"Thank you for your patience. Your application has been submitted successfully."*

Domain-relevant to the single window use case so the cloned voice trains on speech it will actually produce.

## Quality Gates

Three client-side checks run after stopping, before allowing upload:

| Check | Threshold | Message | Blocking? |
|---|---|---|---|
| Too short | < 8 seconds | "Recording too short for good voice cloning. Try again." | **Yes** — hides "Use this recording", only shows "Re-record" |
| Too quiet | Avg RMS < 0.01 | "Recording is very quiet. Try moving closer to your mic." | No — yellow warning |
| Clipping | > 5% samples at ±0.99 | "Audio may be distorted. Try speaking softer." | No — yellow warning |

Only "too short" blocks upload. Quiet/clipping are advisory.

## Server Change

One line in `packages/server/src/createPersonaRoutes.ts`: bump voice duration limit from 30s to 45s. This applies uniformly to both uploads and recordings. TTS engines extract speaker embeddings from reference audio of any length — 45s is well within acceptable range.

## File Inventory

| File | Change |
|---|---|
| `packages/core/src/hooks/useVoiceRecorder.ts` | **New** — hook: state machine, PCM accumulation, WAV encoding, quality checks |
| `packages/core/src/index.ts` | Export `useVoiceRecorder` |
| `packages/ui/src/components/PersonaSettings.tsx` | Modify `VoiceSection`: two buttons + `RecordingFlow` component (3 states) |
| `packages/server/src/createPersonaRoutes.ts` | `30` → `45` in duration check |

## Non-goals

- No teleprompter/sentence progression tracking (VAD-based detection is fragile, not worth the iteration cost for v1)
- No mic device selector (use OS default)
- No server-side audio quality analysis
- No new API endpoints
- No new npm dependencies
