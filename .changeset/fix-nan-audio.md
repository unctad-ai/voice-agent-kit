---
"@unctad-ai/voice-agent-core": patch
---

fix(core): fix NaN in AudioWorklet resampler causing STT "not finite" errors

When resamplePos landed exactly on (input.length - 1), the loop exited without
processing and subtracting input.length produced -1. Next call: input[-1] is
undefined → NaN propagated through the entire audio pipeline to STT.

Reproduced: NaN occurs every ~3 process() calls with 48kHz→16kHz resampling.
Fix: clamp carry position to 0. Verified with 10,000 iterations, zero NaN.
