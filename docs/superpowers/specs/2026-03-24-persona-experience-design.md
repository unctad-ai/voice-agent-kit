# Batch 3: Persona & Experience

## Summary

Align the system prompt with the "virtual civil servant" concept and add audio feedback on mic toggle. These changes make the agent feel like a professional government employee, not a chatbot.

## Changes

### 1. System prompt — virtual civil servant persona

Adapt `packages/server/src/systemPrompt.ts` to reflect the virtual civil servant concept. This is the most sensitive file in the kit — changes follow the process in CLAUDE.md.

**Key adaptations:**
- Identity: "You are {copilotName}, a virtual civil servant for {siteTitle}"
- Tone: professional, courteous, service-oriented (not casual or chatty)
- First response pattern: greet, identify yourself, ask how you can help
- Language: use government-appropriate phrasing ("I can assist you with...", "Let me guide you through...")
- Avoid: slang, excessive friendliness, tech jargon, marketing language
- Keep existing rules: SILENT detection, brevity, no contractions, tool calling behavior

**Approach:**
1. Run `python3 scripts/test-llm-compliance.py` baseline
2. Modify the TONE and SPEECH sections of the prompt
3. Re-run compliance tests
4. A/B test 3+ Groq API calls comparing old vs new
5. Only commit if compliance score is equal or better

**Files:**
- Modify: `packages/server/src/systemPrompt.ts` (TONE and SPEECH sections only)

### 2. Sound feedback on mic toggle

Play a subtle audio cue when the mic activates and deactivates. Provides confirmation for users who aren't looking at the screen (accessibility) and reinforces the toggle affordance.

**Design:**
- **Mic on**: short rising tone (~100ms, 440Hz → 880Hz fade)
- **Mic off**: short falling tone (~100ms, 880Hz → 440Hz fade)
- Generated programmatically via Web Audio API `OscillatorNode` — no audio file assets needed
- Volume follows the `settings.volume` setting
- Respects `prefers-reduced-motion` — disabled when reduced motion is preferred (audio cues can be disorienting)
- Gated behind a new `SiteConfig.micSoundEnabled?: boolean` (default: `true`)

**Implementation:**
- New utility: `packages/core/src/utils/micSound.ts` — exports `playMicOn()` and `playMicOff()`
- Called from `useVoiceAgent.ts` in the `start()` and `stop()` callbacks
- Uses the existing `AudioContext` from `useAudioPlayback` if available, falls back to creating a temporary one

**Files:**
- Create: `packages/core/src/utils/micSound.ts`
- Modify: `packages/core/src/hooks/useVoiceAgent.ts` (call mic sounds in start/stop)
- Modify: `packages/core/src/types/config.ts` (add `micSoundEnabled`)

### 3. Suggested prompt chips in voice mode

When the mic is paused and there are no messages, show the same suggestion chips from Batch 2's empty state in the composer area. Gives users a starting point without switching to text mode.

**Behavior:**
- Show chips horizontally scrollable above the composer bar
- Only visible when: `micPaused === true` AND `messages.length === 0`
- Tapping a chip: sends as text message (same as empty state chips)
- Chips disappear after first message or when mic starts

**Files:**
- Modify: `packages/ui/src/components/GlassCopilotPanel.tsx` (above ComposerBar in ExpandedContent)

## Not in scope

- Custom sound assets (WAV/MP3) for mic toggle
- Haptic feedback (not available in web APIs reliably)
- Per-country persona variations (handled by consuming project's `systemPromptIntro`)
- Voice cloning / TTS persona changes
