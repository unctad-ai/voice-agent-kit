---
'@unctad-ai/voice-agent-core': patch
'@unctad-ai/voice-agent-ui': patch
---

Reduce mic idle timeout from 60s to 15s and prevent background noise from resetting it. VAD bouncing no longer extends the countdown; long utterances are safely rescheduled instead of cut off.
