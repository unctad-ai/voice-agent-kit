---
'@unctad-ai/voice-agent-core': patch
---

fix(core): resolve Chrome AudioContext sample-rate mismatch in useTenVAD

Create AudioContext at native device rate instead of forcing 16 kHz, and resample
to 16 kHz inside the AudioWorklet processor. Chrome throws DOMException when
MediaStream and AudioContext sample rates differ; Firefox resamples silently.
