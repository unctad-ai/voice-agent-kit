import {
  createContext,
  useContext,
  useRef,
  useCallback,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

export interface UIActionParam {
  name: string;
  description: string;
  type: string;
}

export interface UIAction {
  id: string;
  description: string;
  category: string;
  handler: (params?: Record<string, unknown>) => unknown;
  params?: UIActionParam[];
}

interface UIActionRegistry {
  register(action: UIAction): void;
  unregister(id: string): void;
  execute(id: string, params?: Record<string, unknown>): unknown;
  getActions(): UIAction[];
  subscribe(listener: () => void): () => void;
  getSnapshot(): UIAction[];
}

const UIActionRegistryContext = createContext<UIActionRegistry | null>(null);

const EMPTY_ACTIONS: UIAction[] = [];

export function UIActionRegistryProvider({ children }: { children: ReactNode }) {
  const actionsRef = useRef(new Map<string, UIAction>());
  const listenersRef = useRef(new Set<() => void>());
  const snapshotRef = useRef<UIAction[]>(EMPTY_ACTIONS);

  // Batched notification — coalesces rapid register/unregister calls into a
  // single snapshot + listener flush (same pattern as FormFieldRegistry).
  const pendingNotifyRef = useRef(false);
  const notify = useCallback(() => {
    if (!pendingNotifyRef.current) {
      pendingNotifyRef.current = true;
      queueMicrotask(() => {
        pendingNotifyRef.current = false;
        snapshotRef.current = Array.from(actionsRef.current.values());
        listenersRef.current.forEach((l) => l());
      });
    }
  }, []);

  // useMemo (not useRef) avoids the "Cannot access refs during render" lint error.
  // The registry object is stable across renders because it closes over refs.

  const registry = useMemo<UIActionRegistry>(
    () => ({
      register(action: UIAction) {
        actionsRef.current.set(action.id, action);
        notify();
      },
      unregister(id: string) {
        actionsRef.current.delete(id);
        notify();
      },
      execute(id: string, params?: Record<string, unknown>) {
        const action = actionsRef.current.get(id);
        if (!action) {
          const available = Array.from(actionsRef.current.keys());
          return available.length > 0
            ? `Action "${id}" not found. Available actions: ${available.join(', ')}`
            : `Action "${id}" not found. No UI actions are registered on this page.`;
        }
        return action.handler(params);
      },
      getActions() {
        return snapshotRef.current;
      },
      subscribe(listener: () => void) {
        listenersRef.current.add(listener);
        return () => listenersRef.current.delete(listener);
      },
      getSnapshot() {
        return snapshotRef.current;
      },
    }),
    [notify]
  );

  return (
    <UIActionRegistryContext.Provider value={registry}>{children}</UIActionRegistryContext.Provider>
  );
}

export function useUIActionRegistry() {
  const registry = useContext(UIActionRegistryContext);
  if (!registry)
    throw new Error('useUIActionRegistry must be used within UIActionRegistryProvider');

  const actions = useSyncExternalStore(
    registry.subscribe,
    registry.getSnapshot,
    () => EMPTY_ACTIONS
  );
  return {
    actions,
    execute: registry.execute,
    register: registry.register,
    unregister: registry.unregister,
  };
}

/**
 * Hook — registers a UI action in the global registry on mount,
 * unregisters on unmount.
 *
 * The `handler` and `params` arguments are stored in refs so that
 * inline arrow functions and inline arrays do NOT cause infinite
 * re-registration loops. Only truly static props (id, description,
 * category) trigger a re-registration.
 */
export function useRegisterUIAction(
  id: string,
  description: string,
  handler: (params?: Record<string, unknown>) => unknown,
  options?: { category?: string; params?: UIActionParam[] }
) {
  const registry = useContext(UIActionRegistryContext);

  // Refs for potentially-unstable callback and params array
  const handlerRef = useRef(handler);
  const paramsRef = useRef(options?.params);
  useEffect(() => {
    handlerRef.current = handler;
    paramsRef.current = options?.params;
  });

  // Stable handler wrapper — created once, delegates to the latest handler via ref
  const stableHandler = useCallback((p?: Record<string, unknown>) => handlerRef.current(p), []);

  useEffect(() => {
    if (!registry) return;
    registry.register({
      id,
      description,
      category: options?.category ?? 'general',
      handler: stableHandler,
      params: paramsRef.current,
    });
    return () => registry.unregister(id);
  }, [id, description, options?.category, stableHandler, registry]);
}

// ---------------------------------------------------------------------------
// Convenience hooks — reduce boilerplate for common action patterns
// ---------------------------------------------------------------------------

/**
 * Registers a view-mode toggle action (table/card) for a dashboard section.
 *
 * @param prefix  Action ID prefix, e.g. `'dashboard.taxes'`
 * @param label   Human-readable label for the section, e.g. `'tax registrations'`
 * @param setViewMode  State setter for `'table' | 'card'`
 */
export function useRegisterViewModeAction(
  prefix: string,
  label: string,
  setViewMode: (mode: 'table' | 'card') => void
) {
  useRegisterUIAction(
    `${prefix}.setViewMode`,
    `Switch between table and card view for ${label}`,
    (params?: Record<string, unknown>) => {
      const mode = params?.mode as string;
      if (mode !== 'table' && mode !== 'card') return 'Invalid mode. Use "table" or "card"';
      setViewMode(mode);
      return `Switched ${label} to ${mode} view`;
    },
    {
      category: 'dashboard',
      params: [{ name: 'mode', description: 'View mode: table or card', type: 'string' }],
    }
  );
}

/**
 * Registers a tab-switching action.
 *
 * @param prefix      Action ID prefix, e.g. `'film'` → registers `'film.switchTab'`
 * @param validTabs   Array of valid tab values
 * @param setActiveTab State setter
 * @param category    Optional category (defaults to prefix)
 */
export function useRegisterTabSwitchAction(
  prefix: string,
  validTabs: readonly string[],
  setActiveTab: (tab: string) => void,
  category?: string
) {
  useRegisterUIAction(
    `${prefix}.switchTab`,
    `Switch between ${validTabs.join(', ')} tabs`,
    (params?: Record<string, unknown>) => {
      const tab = params?.tab as string;
      if (!validTabs.includes(tab)) return `Invalid tab "${tab}". Use: ${validTabs.join(', ')}.`;
      setActiveTab(tab);
      return `Switched to ${tab} tab`;
    },
    {
      category: category ?? prefix,
      params: [
        {
          name: 'tab',
          description: `Tab to switch to: ${validTabs.join(', ')}`,
          type: 'string',
        },
      ],
    }
  );
}

/**
 * Registers a form-submit action with optional guard.
 *
 * @param prefix   Action ID prefix, e.g. `'pin-reg'` → registers `'pin-reg.submitApplication'`
 * @param options  Configuration object
 */
export function useRegisterSubmitAction(
  prefix: string,
  options: {
    description?: string;
    guard?: () => string | null;
    onSubmit: () => void;
    successMessage?: string;
    category?: string;
  }
) {
  useRegisterUIAction(
    `${prefix}.submitApplication`,
    options.description ?? 'Submit the application',
    () => {
      if (options.guard) {
        const err = options.guard();
        if (err) return err;
      }
      options.onSubmit();
      return (
        options.successMessage ??
        'Application submitted successfully. The user has been redirected to the dashboard.'
      );
    },
    { category: options.category ?? prefix }
  );
}
