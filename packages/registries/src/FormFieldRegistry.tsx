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

export type FormFieldType = 'text' | 'email' | 'tel' | 'date' | 'select' | 'radio' | 'checkbox' | 'upload';

export interface FormFieldOption {
  value: string;
  label: string;
}

export interface FormField {
  id: string;
  label: string;
  type: FormFieldType;
  required: boolean;
  value: unknown;
  options?: FormFieldOption[];
  setter: (value: unknown) => void;
  elementRef?: React.RefObject<HTMLElement>;
  /** Step/section name for progressive forms — used by getFormSchema to group fields. */
  group?: string;
  /** When set, this field is a placeholder for a gated section that needs an action to open. */
  gatedAction?: string;
}

interface FormFieldRegistry {
  register(field: FormField): void;
  unregister(id: string): void;
  getFields(): FormField[];
  /** Returns the field label on success, or null if the field was not found / value was invalid. */
  setValue(id: string, value: unknown): string | null;
  subscribe(listener: () => void): () => void;
  getSnapshot(): FormField[];
}

export const FormFieldRegistryContext = createContext<FormFieldRegistry | null>(null);

const EMPTY_FIELDS: FormField[] = [];

export function FormFieldRegistryProvider({ children }: { children: ReactNode }) {
  const fieldsRef = useRef(new Map<string, FormField>());
  const listenersRef = useRef(new Set<() => void>());
  const snapshotRef = useRef<FormField[]>(EMPTY_FIELDS);
  const highlightTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  // Batched notification — coalesces rapid register/unregister calls (e.g. 30 fields
  // mounting simultaneously on PinRegistration) into a single snapshot + listener flush.
  const pendingNotifyRef = useRef(false);
  const notify = useCallback(() => {
    if (!pendingNotifyRef.current) {
      pendingNotifyRef.current = true;
      queueMicrotask(() => {
        pendingNotifyRef.current = false;
        snapshotRef.current = Array.from(fieldsRef.current.values());
        listenersRef.current.forEach((l) => l());
      });
    }
  }, []);

  const registry = useMemo<FormFieldRegistry>(
    () => ({
      register(field: FormField) {
        fieldsRef.current.set(field.id, field);
        notify();
      },
      unregister(id: string) {
        fieldsRef.current.delete(id);
        // Clear any pending highlight timer for this field
        const timer = highlightTimersRef.current.get(id);
        if (timer) {
          clearTimeout(timer);
          highlightTimersRef.current.delete(id);
        }
        notify();
      },
      getFields() {
        return snapshotRef.current;
      },
      setValue(id: string, value: unknown): string | null {
        const field = fieldsRef.current.get(id);
        if (!field) return null;

        // Validate select/radio values against declared options
        if ((field.type === 'select' || field.type === 'radio') && field.options) {
          if (!field.options.some((o) => o.value === String(value))) {
            return null;
          }
        }

        field.setter(value);

        // Visual highlight on the element if available and motion is not reduced
        if (
          field.elementRef?.current &&
          !window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ) {
          const el = field.elementRef.current;

          // Clear any existing timer for this field to prevent flicker on rapid calls
          const existing = highlightTimersRef.current.get(id);
          if (existing) clearTimeout(existing);

          el.classList.add('ring-2', 'ring-blue-500/50', 'transition-shadow');
          highlightTimersRef.current.set(
            id,
            setTimeout(() => {
              el.classList.remove('ring-2', 'ring-blue-500/50', 'transition-shadow');
              highlightTimersRef.current.delete(id);
            }, 1000)
          );
        }

        return field.label;
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
    <FormFieldRegistryContext.Provider value={registry}>
      {children}
    </FormFieldRegistryContext.Provider>
  );
}

export function useFormFieldRegistry() {
  const registry = useContext(FormFieldRegistryContext);
  if (!registry)
    throw new Error('useFormFieldRegistry must be used within FormFieldRegistryProvider');

  const fields = useSyncExternalStore(
    registry.subscribe,
    registry.getSnapshot,
    // SSR-safe: return empty array during server render
    () => EMPTY_FIELDS
  );
  return {
    fields,
    setValue: registry.setValue,
    register: registry.register,
    unregister: registry.unregister,
  };
}

/**
 * Hook — registers a form field in the global registry on mount,
 * unregisters on unmount, and keeps the stored value in sync.
 *
 * The `setter` and `options` arguments are stored in refs so that
 * inline arrow functions and inline arrays do NOT cause infinite
 * re-registration loops. Only `value` changes (and truly static props
 * like id/label/type) trigger a re-registration.
 */
export function useRegisterFormField(config: {
  id: string;
  label: string;
  type: FormFieldType;
  required: boolean;
  value: unknown;
  options?: FormFieldOption[];
  setter: (value: unknown) => void;
  elementRef?: React.RefObject<HTMLElement>;
  /** When false the field is unregistered (hidden sections). Defaults to true. */
  enabled?: boolean;
  /** Step/section name for progressive forms — used by getFormSchema to group fields. */
  group?: string;
}) {
  const registry = useContext(FormFieldRegistryContext);
  const enabled = config.enabled ?? true;

  // Refs for potentially-unstable callback and array — always kept fresh
  // but never listed as effect dependencies. Updated in a layout-time effect
  // so the latest setter is available before any CopilotKit handler fires.
  const setterRef = useRef(config.setter);
  const optionsRef = useRef(config.options);
  useEffect(() => {
    setterRef.current = config.setter;
    optionsRef.current = config.options;
  });

  // Stable setter wrapper — created once, delegates to the latest setter via ref.

  const stableSetter = useCallback((v: unknown) => setterRef.current(v), []);

  useEffect(() => {
    if (!registry) return;
    if (!enabled) {
      registry.unregister(config.id);
      return;
    }
    registry.register({
      id: config.id,
      label: config.label,
      type: config.type,
      required: config.required,
      value: config.value,
      options: optionsRef.current,
      setter: stableSetter,
      elementRef: config.elementRef,
      group: config.group,
    });
    return () => registry.unregister(config.id);
  }, [
    config.id,
    config.label,
    config.type,
    config.required,
    config.value,
    // setter excluded — stored in ref, accessed via stableSetter
    // options excluded — stored in ref, read at registration time
    config.elementRef,
    config.group,
    stableSetter,
    registry,
    enabled,
  ]);
}
