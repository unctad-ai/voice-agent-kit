# FAB + Tooltip: Virtual Civil Servant

## Summary

Increase the FAB size from 54px to 68px and add an animated tooltip that slides in from the left, introducing the voice agent as a virtual civil servant. The tooltip re-engages users on return visits with a short professional prompt.

## Changes

### 1. FAB size: 54 → 68px

Update `CopilotFAB` in `GlassCopilotPanel.tsx`: both the outer button and inner `.agent-fab-border` go from 54 to 68px. Fallback "AI" font-size goes from 20 to 24px.

The panel's entry/exit animation initial size updates from `{ width: 48, height: 48, borderRadius: 24 }` to `{ width: 68, height: 68, borderRadius: 34 }` so the panel morphs from the FAB size.

### 2. Tooltip component

New component: `CopilotFABTooltip` — rendered alongside the FAB inside the existing `motion.div` wrapper at line ~1220. Not a separate floating element; positioned via flexbox relative to the FAB so it tracks perfectly.

**Two modes:**

| Mode | Trigger | Content | Duration |
|------|---------|---------|----------|
| First visit | 2s after FAB mount | "I'm {name}, your virtual civil servant. How may I help you?" + "Try it now" button | 8s then auto-hide |
| Return visit | 5s after FAB mount | "How may I help you?" (compact pill) | 5s then auto-hide |

Delay timers start on component mount (after the FAB scale-in animation completes at ~250ms, the tooltip has plenty of margin).

**"Try it now" button**: calls the same `onClick` handler as the FAB (opens the panel). Tooltip dismisses simultaneously.

**First visit** = `localStorage` key `voice-fab-greeted:{copilotName}` not set. Set it after first show. Namespaced by copilotName to avoid collision when multiple kit instances share the same origin.

**Return visit cooldown**: `localStorage` key `voice-fab-last-shown:{copilotName}` stores last-shown ISO timestamp. 30-minute minimum gap between re-shows. Checked on mount.

**Dismissal**: clicking the FAB, clicking the tooltip, or scrolling `window` (single `scroll` event listener, passive, removed after dismissal). All set `dismissed` state and trigger exit animation.

**Animation:**
- Entry: `translateX(20px) → 0`, `opacity: 0 → 1`, spring transition (stiffness 300, damping 25)
- Exit: `translateX(10px)`, `opacity: 0`, 200ms ease-out
- Respects `prefers-reduced-motion`: opacity-only, no slide

### 3. Layout

The FAB wrapper changes from a single element to a flex row:

```
<motion.div ref={fabRef} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
  <CopilotFABTooltip ... />   ← tooltip (left)
  <CopilotFAB ... />           ← avatar button (right)
</motion.div>
```

`fabRef` stays on the outer wrapper (no external code references it directly; it's only used for layout).

The wrapper stays `fixed` at `bottom: PANEL_BOTTOM, right: PANEL_RIGHT`. The tooltip extends to the left naturally via flexbox. No absolute positioning needed.

### 4. Props and config

`CopilotFABTooltip` reads `copilotName` and `colors` from `useSiteConfig()` (the provider wraps the entire `GlassCopilotPanel`, so it's accessible inside the FAB area).

The tooltip description and return-visit text can be overridden via `SiteConfig.fabTooltip`:

```typescript
fabTooltip?: {
  firstVisit?: string;   // default: "I'm {name}, your virtual civil servant. How may I help you?"
  returnVisit?: string;  // default: "How may I help you?"
}
```

`{name}` in `firstVisit` is replaced with `copilotName` at render time.

### 5. Test IDs

| Test ID | Element |
|---------|---------|
| `voice-agent-fab-tooltip` | Tooltip container |
| `voice-agent-fab-tooltip-cta` | "Try it now" button (first visit only) |

### 6. VoiceOnboarding deprecation

`VoiceOnboarding` remains exported for backward compatibility but the new tooltip replaces its purpose. Consuming projects can remove their `VoiceOnboarding` usage.

### 7. Styling

The tooltip uses inline styles + motion props (consistent with the rest of GlassCopilotPanel). No new CSS classes or external styles needed.

- Background: white, `border-radius: 20px`
- Shadow: `0 2px 12px rgba(0,0,0,0.10), 0 0 0 1px rgba(0,0,0,0.04)`
- Text: 14px/500 weight (first visit), 13px/500 (return visit)
- Arrow: CSS triangle pointing right toward the FAB
- CTA button: `colors.primary` background, 12px bold, rounded-lg

## Files to modify

| File | Change |
|------|--------|
| `packages/ui/src/components/GlassCopilotPanel.tsx` | Resize FAB to 68px, add `CopilotFABTooltip`, adjust panel entry/exit animation, update FAB wrapper to flex row |
| `packages/core/src/types/config.ts` | Add optional `fabTooltip` to SiteConfig |

## Not in scope

- System prompt changes for "virtual civil servant" persona (separate follow-up)
- Removing VoiceOnboarding export (backward compatibility)
- RTL layout support (no consuming project uses RTL currently)
- Mobile-specific tooltip positioning (tooltip hides on viewports < 480px via `@media` check in component)
