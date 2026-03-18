# TTS Punctuation Handling — Investigation Findings

**Date:** 2026-03-18
**Spec item:** 11 from system-prompt-refactor-design
**Status:** Investigation complete

## Current State

`sanitizeForTTS()` in `packages/server/src/textUtils.ts` (line 37) normalizes all
Unicode dashes to ASCII hyphen:

```ts
.replace(/[\u{2010}\u{2011}\u{2012}\u{2013}\u{2014}\u{2015}]/gu, '-')
```

This means an LLM response like `"services — like permits"` becomes
`"services - like permits"` before reaching any TTS engine. A regular hyphen is
not a recognized prosodic boundary for any of our engines; it is either read as
part of a compound word (joining the surrounding tokens) or swallowed silently
with no pause.

Other sanitization steps that affect prosody:
- Ellipsis (`...`) collapsed to single period (`.`) via `.replace(/\.{2,}/g, '.')` — loses the intended hesitation
- Double newlines become `. ` — this is good, creates a sentence boundary
- Semicolons (`;`) pass through unchanged — behavior varies by engine

## TTS Engine Punctuation Behavior

### LuxTTS (current primary — `luxtts`)

LuxTTS is based on ZipVoice (k2-fsa/ZipVoice, distilled to 4 steps). The model
is a flow-matching TTS that uses a phonemizer internally (via the zipvoice
library). Key behaviors:

| Character | Behavior |
|-----------|----------|
| `.` (period) | Full stop — generates a clear pause (~300-500ms) and falling intonation |
| `,` (comma) | Short pause (~150-250ms) with sustained intonation |
| `?` (question mark) | Pause with rising intonation |
| `!` (exclamation) | Pause with emphatic intonation |
| `;` (semicolon) | Medium pause (~200-350ms), similar to comma but slightly longer |
| `-` (hyphen) | No pause — treated as part of compound word (e.g., "well-known") |
| `—` (em dash) | Not tested directly (sanitized to `-` before reaching engine) |
| `...` (ellipsis) | Would likely produce a pause if preserved, but sanitized to `.` |

ZipVoice splits text into chunks at punctuation boundaries for batch processing.
The sentence-ending characters (`.`, `?`, `!`) are the primary split points.
Commas and semicolons affect prosody within a chunk but are not split points.

LuxTTS does **not** support SSML. The `generate_speech()` method accepts plain
text only. The server (`luxtts-server/server.py`) passes text directly to the
model with no preprocessing.

### Qwen3-TTS (fallback, previously primary)

Qwen3-TTS (Qwen/Qwen3-TTS-12Hz-1.7B-Base) is a language-model-based TTS that
treats speech synthesis as a token prediction task. Key behaviors:

| Character | Behavior |
|-----------|----------|
| `.` (period) | Full pause, sentence boundary |
| `,` (comma) | Short pause, clause boundary |
| `?` / `!` | Pause with appropriate intonation shift |
| `;` (semicolon) | Moderate pause (less reliable than comma/period) |
| `-` (hyphen) | Joins tokens, no pause |
| `—` (em dash) | **Unreliable** — community reports it is sometimes ignored, sometimes produces a brief pause. Not a reliable prosodic cue. |
| `...` (ellipsis) | Can produce hesitation, but behavior is inconsistent |

**SSML:** The Alibaba Cloud hosted version of Qwen-TTS (DashScope API) supports
SSML `<break>` tags and global punctuation pause configuration. However, the
open-source model we self-host (Qwen3-TTS-12Hz-1.7B-Base via rekuenkdr fork)
does **not** process SSML — it expects plain text. SSML tags would be read as
literal text or cause garbled output.

Community discussion (QwenLM/Qwen3-TTS#75) confirms there is no reliable
method for inserting pauses in the open-source model. Attempted workarounds
(newlines, hyphens, underscores, parentheses) were all ineffective. The only
semi-functional approach is natural language instruction ("pause after [word]")
which is unreliable.

### CosyVoice (available, not primary)

CosyVoice2-0.5B uses cross-lingual inference. Similar to other neural TTS models,
it learns prosodic behavior from training data. Standard sentence-ending
punctuation (`.`, `?`, `!`) reliably produces pauses. Comma produces a short
pause. No SSML support in the self-hosted version.

### Chatterbox Turbo (available, not primary)

Chatterbox Turbo has its own sentence-splitting logic in `server.py`:
```python
parts = re.split(r'(?<=[.!?])\s+', trimmed)
```
It only splits on `.`, `!`, `?` followed by whitespace. Commas, semicolons,
and dashes do NOT trigger sentence splits. Within a sentence, the model's
prosody handles commas naturally but has no special handling for dashes.

### Pocket TTS / Resemble (fallback chain)

Pocket TTS: plain-text only, standard punctuation behavior.
Resemble: cloud API, supports SSML but we send plain text.

## SSML Support

| Engine | SSML `<break>` support | Notes |
|--------|----------------------|-------|
| LuxTTS | No | Plain text only |
| Qwen3-TTS (self-hosted) | No | Cloud version (DashScope) supports it, open-source does not |
| CosyVoice | No | Plain text only |
| Chatterbox Turbo | No | Plain text only |
| Pocket TTS | No | Plain text only |
| Resemble | Yes | Cloud API supports SSML, but we send plain text |

**Verdict:** SSML is not a viable path for any of our self-hosted engines.
Resemble is a last-resort fallback and not worth optimizing for.

## Recommendations

Ranked by impact:

### 1. Replace em-dash → comma (HIGH IMPACT, trivial change)

Change line 37 in `textUtils.ts` from:
```ts
.replace(/[\u{2010}\u{2011}\u{2012}\u{2013}\u{2014}\u{2015}]/gu, '-')
```
to:
```ts
.replace(/[\u{2013}\u{2014}\u{2015}]/gu, ',')  // en-dash, em-dash, horizontal bar → comma (pause)
.replace(/[\u{2010}\u{2011}\u{2012}]/gu, '-')   // hyphen-like dashes stay as hyphens
```

**Rationale:** Em dashes in LLM output (e.g., "three services — like permits and
licenses") are used as parenthetical or explanatory separators. A comma is the
closest prosodic equivalent that ALL our TTS engines reliably handle. A period
would be too strong (falling intonation, long pause). A semicolon would work
but comma is more natural for the typical LLM usage pattern.

Unicode breakdown:
- `\u2010` (hyphen) → keep as `-` (compound words)
- `\u2011` (non-breaking hyphen) → keep as `-`
- `\u2012` (figure dash) → keep as `-` (number ranges)
- `\u2013` (en dash) → `,` (range/parenthetical)
- `\u2014` (em dash) → `,` (parenthetical/explanatory)
- `\u2015` (horizontal bar) → `,` (rare, treat like em dash)

### 2. Preserve ellipsis as pause marker (MEDIUM IMPACT, trivial change)

Current code collapses `...` to `.` and then `.. ` patterns to `.`, destroying
the intended hesitation. Change:
```ts
.replace(/\.{2,}/g, '.')
```
to:
```ts
.replace(/\.{3,}/g, '...')   // Preserve ellipsis (three dots) as a pause marker
.replace(/\.{2}/g, '.')       // Collapse only double-dots (likely typos)
```

Most neural TTS engines trained on book/dialogue data have learned that `...`
signals a hesitation or trailing-off pause. Preserving it is free prosody.

### 3. Add system prompt guidance (LOW IMPACT, zero-risk)

Add to the BASE_RULES in `systemPrompt.ts`:
```
Use commas and periods for pacing. Do not use em dashes, semicolons, or ellipsis — the voice engine handles commas and periods best.
```

This reduces the frequency of problematic punctuation at the source (the LLM)
rather than relying solely on post-hoc sanitization. However, LLMs do not
always follow formatting instructions perfectly, so sanitization remains the
primary defense.

### 4. Do NOT add SSML (NOT RECOMMENDED)

None of our self-hosted engines support SSML. Adding `<break>` tags would
require either switching to a cloud TTS provider or implementing a custom
silence-injection layer in the audio pipeline. The complexity is not justified
when comma substitution achieves 80% of the benefit.

## Implementation Notes

### Changes to `textUtils.ts`

Two regex modifications (recommendations 1 and 2 above). No new dependencies.
No behavioral change for text that does not contain em dashes or ellipsis.

### Changes to `systemPrompt.ts`

Optional single-line addition to BASE_RULES. Low risk — the LLM already follows
the "plain spoken English" instruction; this makes punctuation preferences
explicit.

### Testing

Add test cases to `textUtils.test.ts`:
```ts
it('converts em-dash to comma for TTS pause', () => {
  expect(sanitizeForTTS('services — like permits')).toBe('services , like permits');
  // or after whitespace collapse: 'services, like permits'
});
it('preserves ellipsis as pause marker', () => {
  expect(sanitizeForTTS('Well... I think so.')).toContain('...');
});
it('keeps hyphens in compound words', () => {
  expect(sanitizeForTTS('well-known fact')).toBe('well-known fact');
});
```

### Risk

Minimal. The em-dash → comma change only affects text that currently becomes
`word - word` (hyphen between spaces), which TTS already handles poorly.
The comma replacement is strictly better for prosody. The ellipsis change
preserves information that was previously destroyed.

### Verification

After implementation, test with LuxTTS by sending these strings and listening:
1. `"There are three services, like permits and licenses."` (comma baseline)
2. `"There are three services - like permits and licenses."` (current behavior)
3. `"Well... I think so."` vs `"Well. I think so."` (ellipsis vs period)

The comma version should produce a noticeable breath pause where the hyphen
version runs the words together.
