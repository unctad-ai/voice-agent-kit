---
"@unctad-ai/voice-agent-server": patch
---

fix(server): emit conversation.item.created for assistant in voice pipeline

The voice pipeline only sent response.text.done but not conversation.item.created
for assistant messages. The client relies on conversation.item.created to add messages
to the transcript — without it, LLM responses were never shown in the panel.
