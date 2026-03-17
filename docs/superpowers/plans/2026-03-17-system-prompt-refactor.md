# System Prompt Refactor Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Optimize the system prompt and tool descriptions for Qwen3-32B compliance, reducing latency and improving LLM instruction-following on form workflows.

**Architecture:** All changes are in the `packages/server` and `packages/registries` packages. The system prompt (`systemPrompt.ts`) gets structural rewrites — numbered rules, reordered sections, XML tags. Tool descriptions (`builtinTools.ts`) get factual-only rewrites. The voice pipeline (`voicePipeline.ts`) gets generation param tuning. Client tool handlers (`clientToolHandlers.ts`) switch from `[INTERNAL:]` to `<internal>` XML tags.

**Tech Stack:** TypeScript, Vitest, Vercel AI SDK

**Spec:** `docs/superpowers/specs/2026-03-17-system-prompt-refactor-design.md`

---

### Task 1: Add systemPrompt test infrastructure

No tests exist for `buildSystemPrompt`. Create the test file so all subsequent tasks can follow TDD.

**Files:**
- Create: `packages/server/src/__tests__/systemPrompt.test.ts`

- [ ] **Step 1: Create test file with baseline tests**

```typescript
import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../systemPrompt.js';
import type { SiteConfig } from '@unctad-ai/voice-agent-core';

const stubConfig: SiteConfig = {
  copilotName: 'TestBot',
  siteTitle: 'Test Portal',
  systemPromptIntro: 'You help users with tests.',
  services: [],
  categories: [],
  categoryMap: {},
  routeMap: {},
  synonyms: {},
  getServiceFormRoute: () => null,
};

describe('buildSystemPrompt', () => {
  it('includes copilot name in identity line', () => {
    const prompt = buildSystemPrompt(stubConfig);
    expect(prompt).toContain('You are TestBot');
  });

  it('includes base rules', () => {
    const prompt = buildSystemPrompt(stubConfig);
    expect(prompt).toContain('RULES:');
    expect(prompt).toContain('FORMS:');
  });

  it('appends route when clientState has route', () => {
    const prompt = buildSystemPrompt(stubConfig, { route: '/dashboard/tax' });
    expect(prompt).toContain('Current page: /dashboard/tax');
  });

  it('appends UI_ACTIONS when present', () => {
    const prompt = buildSystemPrompt(stubConfig, {
      uiActions: [{ id: 'switch-tab', description: 'Switch to Documents tab' }],
    });
    expect(prompt).toContain('UI_ACTIONS');
    expect(prompt).toContain('switch-tab');
  });

  it('returns prompt without dynamic section when no clientState', () => {
    const prompt = buildSystemPrompt(stubConfig);
    expect(prompt).not.toContain('Current page:');
    expect(prompt).not.toContain('UI_ACTIONS');
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd packages/server && npx vitest run src/__tests__/systemPrompt.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/__tests__/systemPrompt.test.ts
git commit -m "test(server): add baseline systemPrompt tests"
```

---

### Task 2: Add `/no_think` for Qwen3 (HIGH #1)

Append `/no_think` to the identity line. The `stripChainOfThought` in `textUtils.ts` already strips `<think>` blocks as a safety net — this change suppresses them at the source for lower latency.

**Files:**
- Modify: `packages/server/src/systemPrompt.ts:40` (identity line)
- Test: `packages/server/src/__tests__/systemPrompt.test.ts`

- [ ] **Step 1: Write failing test**

Add to `systemPrompt.test.ts`:

```typescript
it('includes /no_think directive in identity line', () => {
  const prompt = buildSystemPrompt(stubConfig);
  expect(prompt).toContain('/no_think');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && npx vitest run src/__tests__/systemPrompt.test.ts`
Expected: FAIL — `/no_think` not found

- [ ] **Step 3: Append `/no_think` to identity line**

In `systemPrompt.ts`, change line 40:

```typescript
// Before:
let prompt = `You are ${config.copilotName}, a friendly voice assistant for ${config.siteTitle}. ${config.systemPromptIntro} Your name is ${config.copilotName}.\n\n`;

// After:
let prompt = `You are ${config.copilotName}, a friendly voice assistant for ${config.siteTitle}. ${config.systemPromptIntro} Your name is ${config.copilotName}. /no_think\n\n`;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/server && npx vitest run src/__tests__/systemPrompt.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/systemPrompt.ts packages/server/src/__tests__/systemPrompt.test.ts
git commit -m "feat(server): add /no_think to suppress Qwen3 thinking mode"
```

---

### Task 3: Split FORMS into numbered rules + reorder sections (HIGH #2 + MEDIUM #6)

Replace the FORMS prose blob with numbered sub-rules. Move SILENT (currently rule 5) and GOODBYE after FORMS since they are bail-out behaviors that should come after the main instruction block.

**Files:**
- Modify: `packages/server/src/systemPrompt.ts:11-36` (BASE_RULES)
- Test: `packages/server/src/__tests__/systemPrompt.test.ts`

- [ ] **Step 1: Write failing tests for new structure**

Add to `systemPrompt.test.ts`:

```typescript
it('FORMS section uses numbered sub-rules', () => {
  const prompt = buildSystemPrompt(stubConfig);
  expect(prompt).toMatch(/FORMS:.*\n1\./s);
  expect(prompt).toContain('2.');
  expect(prompt).toContain('3.');
});

it('SILENT rule comes after FORMS section', () => {
  const prompt = buildSystemPrompt(stubConfig);
  const formsIndex = prompt.indexOf('FORMS:');
  const silentIndex = prompt.indexOf('[SILENT]');
  expect(formsIndex).toBeLessThan(silentIndex);
});

it('GOODBYE comes after FORMS section', () => {
  const prompt = buildSystemPrompt(stubConfig);
  const formsIndex = prompt.indexOf('FORMS:');
  const goodbyeIndex = prompt.indexOf('GOODBYE:');
  expect(formsIndex).toBeLessThan(goodbyeIndex);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/server && npx vitest run src/__tests__/systemPrompt.test.ts`
Expected: FAIL — FORMS doesn't have numbered rules; SILENT currently precedes FORMS

- [ ] **Step 3: Rewrite BASE_RULES**

Replace the entire `BASE_RULES` const in `systemPrompt.ts` with:

```typescript
const BASE_RULES = `RULES:
1. Two sentences max, under 40 words. Plain spoken English — no markdown, lists, formatting, or bracketed tags like [Awaiting response]. Never use contractions (say "you would" not "you'd", "I am" not "I'm", "do not" not "don't").
2. Summarize, never enumerate. Say "three categories like investor services and permits" — never list every item. Never use numbered lists, bullet points, or "You can: 1..." patterns — describe options naturally in one flowing sentence.
3. After tool calls, do not narrate the tools — focus on the result. Say "Kenya has three investor services" not "I searched and found three services." Never repeat text inside <internal> tags to the user — those are instructions for you, not content to speak.
4. Never fabricate information. Never say you lack a capability your tools provide. Never promise to perform an action you have no tool for — if the user asks for something outside your tools, say so honestly and suggest what you can do instead.

TONE: Sound like a warm, knowledgeable human — not a machine reading a script. Jump straight to the answer most of the time. Only occasionally use a brief opener like "Sure" or "Great question" — never the same one twice in a row. Vary your phrasing naturally.

SPEECH RECOGNITION: The user speaks through a microphone and speech-to-text may mishear words. When a transcript seems odd, interpret charitably using phonetic similarity and conversation context. Examples: "no more" after viewing a service likely means "know more"; "text registration" likely means "tax registration". Never take nonsensical transcripts literally — infer the most plausible intent. If truly ambiguous, ask: "Did you mean X or Y?"

TOOL RESULTS: When getServiceDetails returns structured data (requirements, steps, cost, duration), USE that specific data in your response. If the user asks "what are the requirements", read the requirements array and summarize it — do not give the generic overview instead.

CONTEXT AWARENESS: Track what was discussed. If the user says "yes", "tell me more", or a bare affirmation, it refers to the last topic. Do not repeat the same response — advance the conversation by offering the next piece of information (requirements, steps, cost, or how to apply). If nothing new to add, ask what specifically they want to know.

PROACTIVE NAVIGATION: When the user asks about a service, call searchServices first. Then call BOTH viewService (to show the page) AND getServiceDetails (to get data you can speak about) — do not call one without the other. When the user wants to APPLY, call startApplication instead of viewService.

TOOL SELECTION: Use searchServices when the user has a specific keyword or service in mind. Use listServicesByCategory when the user wants to BROWSE or see ALL services in a category.

PAGE TYPES:
- /service/:id pages are INFORMATIONAL — they show overview, requirements, and steps. After viewService, briefly describe the service. Do NOT call getFormSchema or fillFormFields on these pages.
- /dashboard/* pages MAY have fillable forms. Only call getFormSchema when the user explicitly asks to fill or start an application.

FORMS: When on a /dashboard/* page:
1. ALWAYS call getFormSchema first — never guess field content.
2. Ask for a few details at a time, never dump all fields.
3. Batch-fill with fillFormFields once you have answers.
4. After every fillFormFields, call getFormSchema again — new sections may appear.
5. If a section has "gated":true with an "action", call performUIAction BEFORE asking for that section's data.
6. After filling all visible fields, check UI_ACTIONS for the next step (tab switch, etc.).
7. Advance actions (tab switches) — execute immediately. Submit/send actions — confirm with user first.
8. NEVER say a form is complete without calling getFormSchema to verify.

SILENT: Say exactly [SILENT] if the speaker is not addressing you — side conversations, background noise, or filler words. When unsure, choose [SILENT].

GOODBYE: When the user says goodbye or "that is all", respond with a warm farewell. Do NOT end for "thank you" or polite acknowledgments — those are conversational, not farewells.`;
```

**Key changes vs. current:**
- Rule 5 (SILENT) removed from numbered rules, moved to its own section after FORMS
- FORMS rewritten as 8 numbered sub-rules instead of prose blob
- Rule 3 updated: `[INTERNAL: ...]` → `<internal>` (combines with Task 5)
- GOODBYE moved after SILENT (was already at end, now explicitly after SILENT)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/server && npx vitest run src/__tests__/systemPrompt.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/systemPrompt.ts packages/server/src/__tests__/systemPrompt.test.ts
git commit -m "refactor(server): restructure system prompt — numbered FORMS, reorder SILENT/GOODBYE"
```

---

### Task 4: Fix getFormSchema tool description (HIGH #3)

The current description says "Call this ONCE" which directly contradicts the system prompt's "call again after every fillFormFields."

**Files:**
- Modify: `packages/server/src/builtinTools.ts:151`
- Test: `packages/server/src/__tests__/builtinTools.test.ts`

- [ ] **Step 1: Write failing test**

Add to `builtinTools.test.ts`:

```typescript
import { createBuiltinTools } from '../builtinTools.js';

const stubConfig = {
  copilotName: 'TestBot',
  siteTitle: 'Test Portal',
  systemPromptIntro: '',
  services: [],
  categories: [],
  categoryMap: { general: 'General' },
  routeMap: { home: '/' },
  synonyms: {},
  getServiceFormRoute: () => null,
} as any;

describe('tool descriptions', () => {
  it('getFormSchema does not say ONCE', () => {
    const { clientTools } = createBuiltinTools(stubConfig);
    const desc = (clientTools.getFormSchema as any).description;
    expect(desc.toLowerCase()).not.toContain('once');
  });

  it('getFormSchema mentions calling again after fill', () => {
    const { clientTools } = createBuiltinTools(stubConfig);
    const desc = (clientTools.getFormSchema as any).description;
    expect(desc).toContain('again after');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && npx vitest run src/__tests__/builtinTools.test.ts`
Expected: FAIL — description contains "ONCE"

- [ ] **Step 3: Update description**

In `builtinTools.ts` line 151, change:

```typescript
// Before:
description: 'Get available form field IDs and types. Call this ONCE before fillFormFields.',

// After:
description: 'Get currently visible form fields. Call before fillFormFields and again after each fill to discover new sections.',
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/server && npx vitest run src/__tests__/builtinTools.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/builtinTools.ts packages/server/src/__tests__/builtinTools.test.ts
git commit -m "fix(server): correct getFormSchema description — remove misleading ONCE"
```

---

### Task 5: Switch [INTERNAL:] to `<internal>` XML tags (MEDIUM #4)

`[INTERNAL: ...]` is a custom convention Qwen3 has no training on. XML tags align with Qwen3's ChatML/XML training. Rule 3 in the system prompt was already updated in Task 3, so this task only touches `clientToolHandlers.ts`.

**Files:**
- Modify: `packages/registries/src/clientToolHandlers.ts` (4 occurrences)
- Test: `packages/server/src/__tests__/systemPrompt.test.ts` (verify rule 3)

- [ ] **Step 1: Write failing test for rule 3 in system prompt**

Add to `systemPrompt.test.ts`:

```typescript
it('rule 3 references <internal> tags, not [INTERNAL:]', () => {
  const prompt = buildSystemPrompt(stubConfig);
  expect(prompt).toContain('<internal>');
  expect(prompt).not.toContain('[INTERNAL:');
});
```

- [ ] **Step 2: Verify test passes (already done in Task 3)**

Run: `cd packages/server && npx vitest run src/__tests__/systemPrompt.test.ts`
Expected: PASS (Task 3 already changed rule 3)

- [ ] **Step 3: Replace all [INTERNAL:] occurrences in clientToolHandlers.ts**

4 replacements in `packages/registries/src/clientToolHandlers.ts`:

Line 68:
```typescript
// Before:
return `Opened "${resolveServiceTitle(service)}" application form. [INTERNAL: check UI_ACTIONS for the first step — do NOT call getFormSchema yet.]`;

// After:
return `Opened "${resolveServiceTitle(service)}" application form. <internal>Check UI_ACTIONS for the first step — do NOT call getFormSchema yet.</internal>`;
```

Line 84:
```typescript
// Before:
if (!result) return `Action "${actionId}" not found or did not execute. [INTERNAL: check UI_ACTIONS for valid action IDs.]`;

// After:
if (!result) return `Action "${actionId}" not found or did not execute. <internal>Check UI_ACTIONS for valid action IDs.</internal>`;
```

Line 95:
```typescript
// Before:
return 'No form fields are visible right now. [INTERNAL: a UI action may be needed first — check UI_ACTIONS for the next step.]';

// After:
return 'No form fields are visible right now. <internal>A UI action may be needed first — check UI_ACTIONS for the next step.</internal>';
```

Line 106:
```typescript
// Before:
? 'All visible fields are filled. [INTERNAL: check UI_ACTIONS for the next tab or submit action.]'

// After:
? 'All visible fields are filled. <internal>Check UI_ACTIONS for the next tab or submit action.</internal>'
```

- [ ] **Step 4: Add `<internal>` stripping to sanitizeForTTS**

The old `[INTERNAL: ...]` was stripped by the bracketed-text regex (`\[[^\]]{2,}\]`) on line 46 of `textUtils.ts`. The `<`/`>` removal on lines 49-50 would only strip the angle brackets, leaving `internalCheck UI_ACTIONS...internal` in the TTS audio — a regression. Add an explicit `<internal>` stripping regex **before** the angle-bracket removal.

In `packages/server/src/textUtils.ts`, add after the `stripChainOfThought` call (line 31) and before emoji stripping:

```typescript
// Strip <internal>...</internal> tags and their content (LLM-only instructions)
.replace(/<internal>[\s\S]*?<\/internal>/gi, '')
```

- [ ] **Step 5: Write test for `<internal>` stripping**

Add to `packages/server/src/__tests__/textUtils.test.ts`:

```typescript
it('strips <internal> tags and content from TTS output', () => {
  const input = 'Action completed. <internal>Check UI_ACTIONS for valid action IDs.</internal>';
  expect(sanitizeForTTS(input)).toBe('Action completed.');
});

it('strips <internal> tags that span multiple lines', () => {
  const input = 'Done. <internal>\nCheck UI_ACTIONS\nfor next step.\n</internal> Great.';
  const result = sanitizeForTTS(input);
  expect(result).not.toContain('UI_ACTIONS');
  expect(result).toContain('Great');
});
```

- [ ] **Step 6: Run textUtils tests**

Run: `cd packages/server && npx vitest run src/__tests__/textUtils.test.ts`
Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add packages/registries/src/clientToolHandlers.ts packages/server/src/textUtils.ts packages/server/src/__tests__/textUtils.test.ts packages/server/src/__tests__/systemPrompt.test.ts
git commit -m "refactor: switch [INTERNAL:] to <internal> XML tags for Qwen3 compliance"
```

---

### Task 6: Add currentTab to dynamic context (MEDIUM #5)

Inject the active form tab into the system prompt so the LLM knows which tab is selected without having to call `getFormSchema`.

**Files:**
- Modify: `packages/server/src/systemPrompt.ts:3,48-66` (ClientState interface + buildSystemPrompt)
- Test: `packages/server/src/__tests__/systemPrompt.test.ts`

- [ ] **Step 1: Write failing test**

Add to `systemPrompt.test.ts`:

```typescript
it('includes currentTab when provided in clientState', () => {
  const prompt = buildSystemPrompt(stubConfig, { currentTab: 'Documents' });
  expect(prompt).toContain('Active form tab: Documents');
});

it('omits tab line when currentTab is not set', () => {
  const prompt = buildSystemPrompt(stubConfig, { route: '/dashboard/tax' });
  expect(prompt).not.toContain('Active form tab');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/server && npx vitest run src/__tests__/systemPrompt.test.ts`
Expected: FAIL — `Active form tab` not found

- [ ] **Step 3: Add currentTab to ClientState and buildSystemPrompt**

In `systemPrompt.ts`:

Add `currentTab` to the `ClientState` interface:

```typescript
export interface ClientState {
  route?: string;
  currentService?: { id: string; title: string; category: string } | null;
  categories?: Array<{ category: string; count: number }>;
  uiActions?: Array<{ id: string; description: string; category?: string; params?: unknown }>;
  formStatus?: { fieldCount: number; groups: string[] } | null;
  currentTab?: string;
}
```

Add emission after the `formStatus` block:

```typescript
if (clientState.currentTab) {
  prompt += `\nActive form tab: ${clientState.currentTab}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/server && npx vitest run src/__tests__/systemPrompt.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/systemPrompt.ts packages/server/src/__tests__/systemPrompt.test.ts
git commit -m "feat(server): inject currentTab into system prompt dynamic context"
```

**Note:** The client-side plumbing to actually send `currentTab` via `session.update` is out of scope for this plan — it requires changes in consuming projects. The system prompt will simply ignore the field until clients start sending it.

---

### Task 7: Set Qwen3 generation params (LOW #8)

Qwen3's recommended non-thinking params: `temperature=0.7, topP=0.8`. Currently `temperature: 0` is hardcoded. Update to the recommended values.

**Note:** The spec also recommends `topK=20`, but `@ai-sdk/groq` may not forward `topK` to the Groq API (it depends on the provider adapter, not the SDK). Only set `temperature` and `topP` which are universally supported. The spec also mentions setting `enable_thinking=false` at the Groq API level — Groq does not currently expose this parameter, so `/no_think` in the prompt (Task 2) is the only mechanism.

**Files:**
- Modify: `packages/server/src/voicePipeline.ts:440-447` (streamText call)

- [ ] **Step 1: Update streamText params**

In `voicePipeline.ts`, in the `runLlmLoop` method, update the `streamText` call:

```typescript
// Before:
const result = streamText({
  model: groq(model),
  system: buildSystemPrompt(siteConfig, this.session.clientState),
  messages,
  tools: toolsForModel,
  temperature: 0,
  abortSignal: roundSignal,
});

// After:
const result = streamText({
  model: groq(model),
  system: buildSystemPrompt(siteConfig, this.session.clientState),
  messages,
  tools: toolsForModel,
  temperature: 0.7,
  topP: 0.8,
  abortSignal: roundSignal,
});
```

- [ ] **Step 2: Build to verify no type errors**

Run: `cd packages/server && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/voicePipeline.ts
git commit -m "feat(server): set Qwen3 recommended generation params (temp=0.7, topP=0.8)"
```

---

### Task 8: Remove behavioral instructions from tool descriptions (LOW #9)

Tool descriptions should be factual — behavioral instructions belong in the system prompt (single source of truth). The `searchServices` description currently says "immediately follow up with viewService" which duplicates PROACTIVE NAVIGATION.

**Files:**
- Modify: `packages/server/src/builtinTools.ts:82` (searchServices description)
- Test: `packages/server/src/__tests__/builtinTools.test.ts`

- [ ] **Step 1: Write failing test**

Add to `builtinTools.test.ts`:

```typescript
it('searchServices description does not contain behavioral instructions', () => {
  const { serverTools } = createBuiltinTools(stubConfig);
  const desc = (serverTools.searchServices as any).description;
  expect(desc).not.toContain('immediately');
  expect(desc).not.toContain('follow up');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && npx vitest run src/__tests__/builtinTools.test.ts`
Expected: FAIL — description contains "immediately follow up"

- [ ] **Step 3: Update searchServices description**

In `builtinTools.ts` line 82:

```typescript
// Before:
description: `Search ${config.siteTitle} services by keyword. Supports synonyms. When the search returns a single clear match, immediately follow up with viewService to show the page.`,

// After:
description: `Search ${config.siteTitle} services by keyword. Supports synonyms and fuzzy matching.`,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/server && npx vitest run src/__tests__/builtinTools.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/builtinTools.ts packages/server/src/__tests__/builtinTools.test.ts
git commit -m "refactor(server): remove behavioral instructions from tool descriptions"
```

---

### Task 9: Full build + typecheck

Verify everything compiles and all tests pass across the monorepo.

**Files:** None (verification only)

- [ ] **Step 1: Typecheck all packages**

Run: `pnpm typecheck`
Expected: No errors

- [ ] **Step 2: Run all server tests**

Run: `cd packages/server && npx vitest run`
Expected: All tests PASS

- [ ] **Step 3: Full build**

Run: `pnpm build`
Expected: Clean build

- [ ] **Step 4: Final commit (if any fixes needed)**

---

## Notes

**Contractions rule (LOW #7):** The spec suggests reconsidering "Never use contractions." Current rationale is likely TTS pronunciation quality with apostrophes. Decision deferred — requires voice testing to compare TTS output with and without contractions. No code change in this plan.

**Client-side `currentTab` plumbing:** Task 6 adds server-side support only. Consuming projects (Swkenya etc.) need to send `currentTab` in their `session.update` WebSocket events. This is a follow-up task.
