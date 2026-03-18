# Offline UX Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the voice agent UI honestly reflect backend availability — gray FAB when offline, disabled text input with "Reconnecting..." placeholder, and auto-retry with countdown.

**Architecture:** Three surgical changes to existing components. The FAB gets an `isOffline` prop to swap its ring color. The ComposerBar disables its `<input>` and swaps placeholder when offline. The health-check polling in `WiredPanelInner` switches from fixed 30s to exponential backoff (3→6→12→24→30s cap) with a countdown displayed on the retry button.

**Tech Stack:** React, Framer Motion, existing `checkBackendHealth()` infrastructure

**Note on testing:** No React component test infrastructure exists in this project (no jsdom, no testing-library). Each task includes manual verification steps instead. Adding component test infra is out of scope for this polish task.

---

### Task 1: FAB ring → gray when offline

**Files:**
- Modify: `packages/ui/src/components/GlassCopilotPanel.tsx:85-134` (CopilotFAB component)
- Modify: `packages/ui/src/components/GlassCopilotPanel.tsx:906-990` (GlassCopilotPanel — the outer component that renders CopilotFAB)

**Context:** `CopilotFAB` is rendered by `GlassCopilotPanel` (line 966), NOT by `WiredPanelInner`. The FAB is only visible when `!isVisible` (panel is hidden) — at that point `WiredPanelInner` is not mounted and its `backendDown` state doesn't exist. We need a standalone health check at the `GlassCopilotPanel` level to drive the FAB's offline indicator.

- [ ] **Step 1: Add `isOffline` prop to CopilotFAB**

In `GlassCopilotPanel.tsx`, update the `CopilotFAB` signature and the `--agent-primary` value:

```tsx
function CopilotFAB({ onClick, portraitSrc, isOffline = false }: { onClick: () => void; portraitSrc?: string; isOffline?: boolean }) {
  const { colors } = useSiteConfig();
  // ...
  <div className="agent-fab-border" style={{
    width: 54, height: 54,
    '--agent-primary': isOffline ? '#9ca3af' : colors.primary,
    animation: isOffline ? 'none' : undefined,
  } as React.CSSProperties}>
```

When `isOffline`, the ring turns gray (`#9ca3af` = Tailwind gray-400) and the rotation animation stops.

- [ ] **Step 2: Add FAB health check in GlassCopilotPanel**

In the `GlassCopilotPanel` component (around line 906), add a health check that runs when the FAB is visible (panel is hidden). This is separate from `WiredPanelInner`'s health check which runs when the panel is open.

```tsx
// Inside GlassCopilotPanel, after existing state declarations (around line 928):
const [fabOffline, setFabOffline] = useState(false);
useEffect(() => {
  if (isOpen) return; // WiredPanelInner handles health when panel is visible
  let cancelled = false;
  const check = () => {
    checkBackendHealth().then(({ available }) => {
      if (!cancelled) setFabOffline(!available);
    });
  };
  check(); // immediate check
  const timer = setInterval(check, RECOVERY_POLL_MS);
  return () => { cancelled = true; clearInterval(timer); };
}, [isOpen]);
```

Note: `checkBackendHealth` and `RECOVERY_POLL_MS` are already imported from `@unctad-ai/voice-agent-core` (line 18-20).

- [ ] **Step 3: Pass `isOffline` to CopilotFAB**

Find where `<CopilotFAB>` is rendered (line 966) and add the prop:

```tsx
<CopilotFAB onClick={handleOpen} portraitSrc={resolvedPortrait} isOffline={fabOffline} />
```

- [ ] **Step 4: Verify manually**

1. Start the dev server: `pnpm dev`
2. In a consuming project (Swkenya Docker): kill the backend, observe FAB ring turns gray and stops spinning
3. Restart backend, observe FAB ring returns to primary color and resumes animation

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/GlassCopilotPanel.tsx
git commit -m "feat(ui): gray FAB ring when backend is offline"
```

---

### Task 2: Disable text input and show "Reconnecting..." when offline

**Files:**
- Modify: `packages/ui/src/components/GlassCopilotPanel.tsx:353-598` (ComposerBar component)

**Context:** `ComposerBar` receives `disabled` when `voiceError === 'network_error'`. When disabled, it forces text mode — but the `<input>` field itself remains editable. The user can type but nothing useful happens.

- [ ] **Step 1: Disable the input element and change placeholder**

In `ComposerBar`'s text mode JSX (around line 513-548), update the `<input>`:

```tsx
<input
  ref={inputRef}
  type="text"
  value={text}
  onChange={(e) => setText(e.target.value)}
  disabled={disabled}
  onKeyDown={(e) => {
    if (e.key === 'Enter') handleSubmit();
    if (e.key === 'Escape') handleCancel();
  }}
  // ... existing onFocus/onBlur handlers ...
  placeholder={disabled ? 'Reconnecting...' : 'Ask about services...'}
  // ... rest unchanged ...
  style={{
    fontSize: '14px',
    color: '#1a1a1a',
    background: 'transparent',
    border: 'none',
    outline: 'none',
    padding: 0,
    opacity: disabled ? 0.5 : 1,
    cursor: disabled ? 'not-allowed' : undefined,
  }}
/>
```

- [ ] **Step 2: Hide send button when disabled**

The send button already only shows when `text.trim().length > 0`. Since the input is now disabled, users can't type — so the send button naturally stays hidden. No change needed.

However, also hide the "back to voice" button when disabled (it's already handled — line 575: `{!disabled && (...)}` renders the mic button only when not disabled). Confirm this is correct.

- [ ] **Step 3: Verify manually**

1. Kill backend, open panel, observe:
   - Input shows "Reconnecting..." placeholder in muted text
   - Input is not editable (cursor shows not-allowed)
   - No send button visible
   - No "back to voice" button visible
2. Restart backend, observe input returns to normal

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/GlassCopilotPanel.tsx
git commit -m "feat(ui): disable text input with Reconnecting placeholder when offline"
```

---

### Task 3: Auto-retry with exponential backoff and countdown

**Files:**
- Modify: `packages/ui/src/components/GlassCopilotPanel.tsx:790-872` (WiredPanelInner health check + retry logic)
- Modify: `packages/ui/src/components/GlassCopilotPanel.tsx:700-709` (ExpandedContent retry button text)
- Modify: `packages/ui/src/components/GlassCopilotPanel.tsx:229-264` (CollapsedBar retry display)

**Context:** Current health check uses fixed `RECOVERY_POLL_MS` (30s). Spec wants exponential backoff: 3s → 6s → 12s → 24s → 30s cap. The retry button currently shows static "Retry connection" → should show "Retrying in Ns...". Manual click resets backoff and retries immediately.

- [ ] **Step 1: Add backoff state and countdown to WiredPanelInner**

Add state variables for backoff delay and countdown seconds:

```tsx
const [retryCountdown, setRetryCountdown] = useState<number | null>(null);
const backoffDelayRef = useRef(3000); // Start at 3s
const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
```

- [ ] **Step 2: Replace fixed poll with exponential backoff + countdown**

Rewrite `runHealthCheck` to use exponential backoff and drive a per-second countdown. **Important:** `scheduleRetry` needs to call `runHealthCheck`, and `runHealthCheck` needs to call `scheduleRetry` — break the cycle with a ref.

Add these constants at the top of `WiredPanelInner` (replace the `RECOVERY_POLL_MS` usage):

```tsx
const RETRY_INITIAL_MS = 3000;
const RETRY_MAX_MS = 30000;
```

Then add the functions in this order (the ref pattern avoids the circular dependency):

```tsx
const clearCountdown = useCallback(() => {
  if (countdownTimerRef.current) { clearInterval(countdownTimerRef.current); countdownTimerRef.current = null; }
  setRetryCountdown(null);
}, []);

// Ref to break circular dep: scheduleRetry → runHealthCheck → scheduleRetry
const runHealthCheckRef = useRef<() => void>(() => {});

const scheduleRetry = useCallback((delayMs: number) => {
  if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
  clearCountdown();
  const seconds = Math.ceil(delayMs / 1000);
  setRetryCountdown(seconds);
  let remaining = seconds;
  countdownTimerRef.current = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) { clearCountdown(); return; }
    setRetryCountdown(remaining);
  }, 1000);
  pollTimerRef.current = setTimeout(() => runHealthCheckRef.current(), delayMs);
  backoffDelayRef.current = Math.min(delayMs * 2, RETRY_MAX_MS);
}, [clearCountdown]);

const runHealthCheck = useCallback(() => {
  clearCountdown();
  checkBackendHealth().then(({ available }) => {
    if (cancelledRef.current) return;
    setBackendDown(!available);
    if (available) {
      backoffDelayRef.current = RETRY_INITIAL_MS; // reset backoff
      dismissError();
      if (!autoStartedRef.current && settings.autoListen) { autoStartedRef.current = true; startRef.current(); }
    } else {
      scheduleRetry(backoffDelayRef.current);
    }
  });
}, [dismissError, settings.autoListen, scheduleRetry, clearCountdown]);

// Keep ref in sync
useEffect(() => { runHealthCheckRef.current = runHealthCheck; }, [runHealthCheck]);
```

- [ ] **Step 3: Reset backoff on manual retry**

Update `handleRetryClick` to reset backoff:

```tsx
const handleRetryClick = useCallback(() => {
  if (isRetrying) return;
  setIsRetrying(true);
  backoffDelayRef.current = RETRY_INITIAL_MS; // reset backoff
  clearCountdown();
  checkBackendHealth().then(({ available }) => {
    if (cancelledRef.current) return;
    setIsRetrying(false);
    setBackendDown(!available);
    if (available) {
      dismissError();
      if (!autoStartedRef.current && settings.autoListen) { autoStartedRef.current = true; startRef.current(); }
    } else {
      scheduleRetry(backoffDelayRef.current);
    }
  }).catch(() => setIsRetrying(false));
}, [isRetrying, clearCountdown, scheduleRetry, dismissError, settings.autoListen]);
```

- [ ] **Step 4: Clean up countdown on unmount**

Add cleanup to the existing unmount effect:

```tsx
useEffect(() => {
  cancelledRef.current = false; runHealthCheck();
  return () => {
    cancelledRef.current = true;
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
  };
}, [runHealthCheck]);
```

- [ ] **Step 5: Pass countdown to child components**

Pass `retryCountdown` to `CollapsedBar` and `ExpandedContent`:

```tsx
// In the collapsed return:
<CollapsedBar ... retryCountdown={retryCountdown} />

// In the expanded return:
<ExpandedContent ... retryCountdown={retryCountdown} />
```

Add `retryCountdown?: number | null` to both components' prop types.

- [ ] **Step 6: Display countdown on ExpandedContent retry button**

In `ExpandedContent` (around line 706), replace the static text:

```tsx
{isRetrying ? 'Checking...' : retryCountdown ? `Retrying in ${retryCountdown}s...` : 'Retry connection'}
```

- [ ] **Step 7: Display countdown on CollapsedBar**

In `CollapsedBar` (around line 231), update the "Offline" text to include countdown when available:

```tsx
{isOffline ? (
  <span className="inline-flex items-center gap-1">
    {retryCountdown ? `Retrying in ${retryCountdown}s` : 'Offline'}
    {onRetry && !retryCountdown && (
      // ... existing retry button ...
    )}
  </span>
) : /* ... rest unchanged ... */}
```

When a countdown is active, show "Retrying in Ns" instead of "Offline" + retry icon (since retry is already scheduled). The manual retry icon reappears when countdown is null (between checks).

- [ ] **Step 8: Verify manually**

1. Kill backend, observe:
   - FAB turns gray (Task 1)
   - Retry button shows "Retrying in 3s...", counts down to 1, then checks
   - On failure: next countdown is 6s, then 12s, 24s, then caps at 30s
   - Collapsed bar shows "Retrying in Ns" during countdown
2. Click "Retry connection" during countdown → countdown resets, immediate check, then starts from 3s again on failure
3. Restart backend during countdown → next check succeeds, FAB turns primary, input re-enables

- [ ] **Step 9: Build and typecheck**

```bash
pnpm build && pnpm typecheck
```

- [ ] **Step 10: Commit**

```bash
git add packages/ui/src/components/GlassCopilotPanel.tsx
git commit -m "feat(ui): auto-retry with exponential backoff and countdown display"
```
