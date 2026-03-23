# FAB + Tooltip: Virtual Civil Servant — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the FAB larger (68px) and add an animated tooltip that introduces the voice agent as a virtual civil servant.

**Architecture:** Add `CopilotFABTooltip` inline in `GlassCopilotPanel.tsx` (alongside existing `CopilotFAB`). The tooltip manages its own visibility via localStorage keys and timers. The FAB wrapper becomes a flex row with tooltip on the left, FAB on the right.

**Tech Stack:** React, motion/react (framer-motion), localStorage, useSiteConfig hook

**Spec:** `docs/superpowers/specs/2026-03-23-fab-tooltip-virtual-civil-servant.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `packages/core/src/types/config.ts` | Modify | Add `fabTooltip?` to `SiteConfig` |
| `packages/ui/src/components/GlassCopilotPanel.tsx` | Modify | Resize FAB, add tooltip component, update FAB wrapper + panel animation |

---

### Task 1: Add `fabTooltip` to SiteConfig

**Files:**
- Modify: `packages/core/src/types/config.ts:38-74`

- [ ] **Step 1: Add the optional field to SiteConfig**

In `packages/core/src/types/config.ts`, add after the `greetingMessage` field (line 73):

```typescript
  /** Override default FAB tooltip text. {name} is replaced with copilotName. */
  fabTooltip?: {
    firstVisit?: string;
    returnVisit?: string;
  };
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: all packages pass (no consumers use this field yet)

- [ ] **Step 3: Commit**

```
git add packages/core/src/types/config.ts
git commit -m "feat(core): add fabTooltip config to SiteConfig"
```

---

### Task 2: Resize FAB from 54px to 68px

**Files:**
- Modify: `packages/ui/src/components/GlassCopilotPanel.tsx:91-140` (CopilotFAB)
- Modify: `packages/ui/src/components/GlassCopilotPanel.tsx:1227-1229` (panel animation)

- [ ] **Step 1: Update CopilotFAB dimensions**

In `CopilotFAB` (line 91-140), change all `54` → `68` (3 occurrences: button width/height, agent-fab-border width/height). Change fallback "AI" fontSize from `20` to `24`.

```tsx
// Button style (line 104-105):
width: 68,
height: 68,

// Border div (line 110):
style={{ width: 68, height: 68, ...

// Fallback text (line 129):
fontSize: 24,
```

- [ ] **Step 2: Update panel entry/exit animation**

In the panel `motion.div` (line 1227-1229), update initial and exit sizes from `48` to `68` and borderRadius from `24` to `34`:

```tsx
// initial (line 1227) — was { width: 48, height: 48, borderRadius: 24, ... }:
initial={{ width: 68, height: 68, borderRadius: 34, opacity: 0, scale: 0.9 }}

// exit (line 1229) — was { width: 48, height: 48, borderRadius: 24, ... }:
exit={{ width: 68, height: 68, borderRadius: 34, opacity: 0, scale: 0.95, transition: SPRING_PANEL_EXIT }}
```

- [ ] **Step 3: Typecheck and verify**

Run: `pnpm typecheck`
Expected: pass

- [ ] **Step 4: Commit**

```
git add packages/ui/src/components/GlassCopilotPanel.tsx
git commit -m "feat(ui): increase FAB size from 54px to 68px"
```

---

### Task 3: Add CopilotFABTooltip component

**Files:**
- Modify: `packages/ui/src/components/GlassCopilotPanel.tsx` (add component after CopilotFAB, before collapsed header bar section ~line 142)

- [ ] **Step 0: Add `useReducedMotion` to motion/react import**

Line 13 currently imports `{ motion, AnimatePresence }`. Add `useReducedMotion`:

```tsx
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
```

- [ ] **Step 1: Add the tooltip component**

Insert after `CopilotFAB` (after line 140), before the collapsed header bar section:

```tsx
// ---------------------------------------------------------------------------
// FAB Tooltip — animated greeting to the left of the FAB
// ---------------------------------------------------------------------------
const FAB_GREETED_KEY = (name: string) => `voice-fab-greeted:${name}`;
const FAB_LAST_SHOWN_KEY = (name: string) => `voice-fab-last-shown:${name}`;
const FAB_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes
const FAB_TOOLTIP_MIN_WIDTH = 480; // hide tooltip on narrow viewports

function CopilotFABTooltip({ onClick, dismissed: externalDismissed }: { onClick: () => void; dismissed?: boolean }) {
  const { copilotName, colors, fabTooltip } = useSiteConfig();
  const prefersReduced = useReducedMotion();
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const isFirstVisit = useRef(false);

  // Hide on narrow viewports
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth < FAB_TOOLTIP_MIN_WIDTH) {
      setDismissed(true);
    }
  }, []);

  // External dismissal (e.g. FAB clicked)
  useEffect(() => {
    if (externalDismissed) setDismissed(true);
  }, [externalDismissed]);

  useEffect(() => {
    const greeted = localStorage.getItem(FAB_GREETED_KEY(copilotName));
    const lastShown = localStorage.getItem(FAB_LAST_SHOWN_KEY(copilotName));
    const now = Date.now();

    if (!greeted) {
      isFirstVisit.current = true;
      // First visit: show after 2s
      const timer = setTimeout(() => {
        setVisible(true);
        localStorage.setItem(FAB_GREETED_KEY(copilotName), 'true');
        localStorage.setItem(FAB_LAST_SHOWN_KEY(copilotName), new Date().toISOString());
      }, 2000);
      return () => clearTimeout(timer);
    }

    // Return visit: check cooldown
    if (lastShown && now - new Date(lastShown).getTime() < FAB_COOLDOWN_MS) return;

    // Show after 5s
    const timer = setTimeout(() => {
      setVisible(true);
      localStorage.setItem(FAB_LAST_SHOWN_KEY(copilotName), new Date().toISOString());
    }, 5000);
    return () => clearTimeout(timer);
  }, [copilotName]);

  // Auto-hide timer
  useEffect(() => {
    if (!visible) return;
    const duration = isFirstVisit.current ? 8000 : 5000;
    const timer = setTimeout(() => setDismissed(true), duration);
    return () => clearTimeout(timer);
  }, [visible]);

  // Scroll dismissal
  useEffect(() => {
    if (!visible || dismissed) return;
    const handleScroll = () => setDismissed(true);
    window.addEventListener('scroll', handleScroll, { passive: true, once: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [visible, dismissed]);

  const handleClick = () => {
    setDismissed(true);
    onClick();
  };

  const firstVisitText = fabTooltip?.firstVisit
    ? fabTooltip.firstVisit.replace('{name}', copilotName)
    : `I'm ${copilotName}, your virtual civil servant. How may I help you?`;
  const returnVisitText = fabTooltip?.returnVisit ?? 'How may I help you?';

  const show = visible && !dismissed;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          data-testid="voice-agent-fab-tooltip"
          initial={prefersReduced ? { opacity: 0 } : { opacity: 0, x: 20 }}
          animate={prefersReduced ? { opacity: 1 } : { opacity: 1, x: 0 }}
          exit={prefersReduced ? { opacity: 0 } : { opacity: 0, x: 10 }}
          transition={
            prefersReduced
              ? { duration: 0.2 }
              : { type: 'spring', stiffness: 300, damping: 25 }
          }
          onClick={handleClick}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 0,
            cursor: 'pointer',
          }}
        >
          <div
            style={{
              background: 'white',
              borderRadius: 20,
              padding: isFirstVisit.current ? '12px 20px' : '10px 18px',
              boxShadow: '0 2px 12px rgba(0,0,0,0.10), 0 0 0 1px rgba(0,0,0,0.04)',
              maxWidth: 340,
            }}
          >
            <div
              style={{
                fontSize: isFirstVisit.current ? 14 : 13,
                color: '#1a1a1a',
                fontWeight: 500,
                lineHeight: 1.4,
              }}
            >
              {isFirstVisit.current ? firstVisitText : returnVisitText}
            </div>
            {isFirstVisit.current && (
              <button
                data-testid="voice-agent-fab-tooltip-cta"
                style={{
                  marginTop: 8,
                  padding: '6px 16px',
                  background: colors.primary,
                  color: 'white',
                  border: 'none',
                  borderRadius: 12,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Try it now
              </button>
            )}
          </div>
          {/* Arrow pointing right toward FAB */}
          <div
            style={{
              width: 0,
              height: 0,
              borderTop: '8px solid transparent',
              borderBottom: '8px solid transparent',
              borderLeft: '8px solid white',
              flexShrink: 0,
              filter: 'drop-shadow(2px 0 1px rgba(0,0,0,0.06))',
            }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: pass (component defined but not yet rendered)

- [ ] **Step 3: Commit**

```
git add packages/ui/src/components/GlassCopilotPanel.tsx
git commit -m "feat(ui): add CopilotFABTooltip component"
```

---

### Task 4: Wire tooltip into FAB wrapper

**Files:**
- Modify: `packages/ui/src/components/GlassCopilotPanel.tsx:1218-1223` (FAB render site)

- [ ] **Step 1: Update FAB wrapper to flex row with tooltip**

Replace lines 1218-1223:

```tsx
// BEFORE:
<AnimatePresence>
  {!isVisible && (
    <motion.div ref={fabRef} key="copilot-fab" initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0, opacity: 0 }} transition={{ duration: 0.25, ease: 'easeOut' }} className="fixed" style={{ bottom: PANEL_BOTTOM, right: PANEL_RIGHT, zIndex: PANEL_Z_INDEX }}>
      <CopilotFAB onClick={handleOpen} portraitSrc={resolvedPortrait} isOffline={fabOffline} />
    </motion.div>
  )}
```

```tsx
// AFTER:
<AnimatePresence>
  {!isVisible && (
    <motion.div ref={fabRef} key="copilot-fab" initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0, opacity: 0 }} transition={{ duration: 0.25, ease: 'easeOut' }} className="fixed" style={{ bottom: PANEL_BOTTOM, right: PANEL_RIGHT, zIndex: PANEL_Z_INDEX, display: 'flex', alignItems: 'center', gap: 12 }}>
      <CopilotFABTooltip onClick={handleOpen} dismissed={isVisible} />
      <CopilotFAB onClick={handleOpen} portraitSrc={resolvedPortrait} isOffline={fabOffline} />
    </motion.div>
  )}
```

Note: `isVisible` goes `true` when `handleOpen` is called (panel opens), so clicking the FAB triggers `handleOpen` → `isVisible=true` → `dismissed={true}` prop propagates to tooltip. This also handles the exit animation: the `!isVisible` guard unmounts the whole wrapper, and the `AnimatePresence` handles the exit.

- [ ] **Step 2: Typecheck and build**

Run: `pnpm typecheck && pnpm build`
Expected: all pass

- [ ] **Step 3: Commit**

```
git add packages/ui/src/components/GlassCopilotPanel.tsx
git commit -m "feat(ui): wire FAB tooltip into panel layout"
```

---

### Task 5: Visual verification with Docker

- [ ] **Step 1: Build and start Kenya Docker dev**

Run: `pnpm build && pnpm docker:kenya`
Expected: builds and starts at http://localhost:3000

- [ ] **Step 2: Verify first-visit tooltip**

Open http://localhost:3000 in an incognito window. After ~2s the tooltip should slide in from the right with "I'm Pesa, your virtual civil servant. How may I help you?" and a "Try it now" button. The FAB should be 68px.

- [ ] **Step 3: Verify dismissal and return-visit**

Click "Try it now" — panel opens, tooltip gone. Close panel. Manually clear `voice-fab-last-shown:Pesa` from localStorage (keep `voice-fab-greeted:Pesa`). Refresh. After ~5s, compact pill "How may I help you?" should appear.

- [ ] **Step 4: Verify reduced motion**

In browser DevTools, enable "Prefers reduced motion" emulation. Refresh. Tooltip should fade in/out without sliding.

- [ ] **Step 5: Final commit if any tweaks needed**

```
git add -A && git commit -m "fix(ui): tooltip visual adjustments"
```

---

### Task 6: Release

- [ ] **Step 1: Create changeset**

Create `.changeset/fab-tooltip.md`:

```markdown
---
'@unctad-ai/voice-agent-core': minor
'@unctad-ai/voice-agent-ui': minor
---

Larger FAB (68px) with animated tooltip introducing the voice agent as a virtual civil servant. First-visit greeting with CTA, return-visit re-engagement with 30min cooldown. VoiceOnboarding is now superseded by the built-in FAB tooltip.
```

- [ ] **Step 2: Commit and release**

```
git add .changeset/fab-tooltip.md && git commit -m "chore: add changeset for FAB tooltip"
./scripts/release.sh --yes
```
