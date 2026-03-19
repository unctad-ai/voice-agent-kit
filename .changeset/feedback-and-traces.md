---
"@unctad-ai/voice-agent-core": minor
"@unctad-ai/voice-agent-registries": minor
"@unctad-ai/voice-agent-server": minor
"@unctad-ai/voice-agent-ui": minor
---

Conversation feedback and session trace retrieval

- feat(server): POST/GET `/api/feedback` for reporting bad assistant responses
- feat(server): GET `/api/traces` and `/api/traces/:sessionId` for session trace retrieval
- feat(server): session logger buffers structured trace entries, flushes to disk on session close
- feat(core): expose `sessionId` from `session.created` WebSocket event
- feat(ui): feedback pill on assistant messages with "Feedback" label on hover
- feat(ui): amber feedback composer mode with positive "How could this be better?" placeholder
- feat(ui): deduplicate consecutive assistant name labels in transcript
