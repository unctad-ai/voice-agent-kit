import { useContext, useEffect, useRef } from 'react';
import { FormFieldRegistryContext } from './FormFieldRegistry';
import type { FormFieldType, FormFieldOption } from './FormFieldRegistry';

export interface ProgressiveFieldConfig {
  id: string;
  label: string;
  type: FormFieldType;
  /** Defaults to false when omitted. */
  required?: boolean;
  options?: FormFieldOption[];
  /** Per-field visibility override — ANDed with step.visible. Defaults to true. */
  visible?: boolean;
  /**
   * [value, setter] tuple — same pattern as useState return.
   * Value is constrained to JSON-safe primitives so the fingerprint comparison
   * (JSON.stringify) never throws or produces non-deterministic output.
   * Inline arrow setters are safe — they are ref-stabilized internally.
   */
  bind: [string | boolean | number | null, (value: unknown) => void];
  /** DOM ref for the visual ring-highlight when the LLM fills this field. */
  elementRef?: React.RefObject<HTMLElement>;
}

export interface ProgressiveStepConfig {
  /** Section name shown to the LLM via getFormSchema grouping. */
  step: string;
  /** Whether this step's fields should be registered. */
  visible: boolean;
  /**
   * Whether the form inputs are actually rendered and interactive.
   * Use this for sections gated behind an "Add" button — set to true
   * only when the sub-form is open. Defaults to true.
   */
  ready?: boolean;
  fields: ProgressiveFieldConfig[];
}

interface FlatField {
  id: string;
  label: string;
  type: FormFieldType;
  required: boolean;
  value: string | boolean | number | null;
  enabled: boolean;
  group: string;
  elementRef?: React.RefObject<HTMLElement>;
}

/**
 * Registers progressive form fields with the global FormFieldRegistry.
 *
 * Replaces N individual `useRegisterFormField` + `useCallback` + `useMemo`
 * calls with one declarative config. Uses the FormFieldRegistryContext
 * directly (not hook-per-field) to avoid rules-of-hooks issues with
 * conditional field counts.
 *
 * @param prefix - Field ID prefix (e.g. 'evaluate-investment')
 * @param steps  - Step configs with visibility and field definitions
 */
export function useProgressiveFields(prefix: string, steps: ProgressiveStepConfig[]) {
  const registry = useContext(FormFieldRegistryContext);

  // Refs for potentially-unstable callbacks and arrays — kept fresh via a
  // passive effect so the render body stays pure (no ref mutations).
  const settersRef = useRef(new Map<string, (value: unknown) => void>());
  const optionsRef = useRef(new Map<string, FormFieldOption[] | undefined>());
  const wrappersRef = useRef(new Map<string, (value: unknown) => void>());

  // ── Pure computation: build flat field list (no side effects) ──
  const flatFields: FlatField[] = [];
  const currentIds = new Set<string>();

  for (const step of steps) {
    for (const field of step.fields) {
      const fullId = `${prefix}.${field.id}`;
      currentIds.add(fullId);
      flatFields.push({
        id: fullId,
        label: field.label,
        type: field.type,
        required: field.required ?? false,
        value: field.bind[0],
        enabled: step.visible && (step.ready ?? true) && (field.visible ?? true),
        group: step.step,
        elementRef: field.elementRef,
      });
    }
  }

  // Lazy-init stable wrapper closures — one per field ID, delegates to the
  // latest setter via ref. Only creates on first encounter (idempotent),
  // which is acceptable during render per React guidelines for lazy init.
  for (const { id } of flatFields) {
    if (!wrappersRef.current.has(id)) {
      wrappersRef.current.set(id, (v: unknown) => {
        settersRef.current.get(id)?.(v);
      });
    }
  }

  // ── Passive effect: sync refs + prune stale entries ──
  // Runs after every render to keep refs fresh without mutating them during
  // the render body. Also prunes orphaned IDs when fields are removed from
  // the steps config (prevents memory leaks from accumulated map entries).
  useEffect(() => {
    for (const step of steps) {
      for (const field of step.fields) {
        const fullId = `${prefix}.${field.id}`;
        settersRef.current.set(fullId, field.bind[1]);
        optionsRef.current.set(fullId, field.options);
      }
    }
    for (const id of [...settersRef.current.keys()]) {
      if (!currentIds.has(id)) {
        settersRef.current.delete(id);
        optionsRef.current.delete(id);
        wrappersRef.current.delete(id);
      }
    }
  });

  // ── Fingerprint: detect meaningful changes ──
  // Includes ALL metadata (not just id/value/enabled) so label, type, required,
  // and group changes also trigger re-registration. Values are constrained to
  // JSON-safe primitives via the FieldConfig type, so stringify is deterministic.
  const fingerprint = JSON.stringify(
    flatFields.map((f) => [f.id, f.label, f.type, f.required, f.value, f.enabled, f.group])
  );

  // ── Registration effect ──
  // The cleanup function unregisters only the IDs this effect registered, so
  // disabled fields or fields from other components are never clobbered.
  // When a field transitions enabled→disabled, the fingerprint changes, the old
  // cleanup runs (unregistering it), and the new effect skips it.
  useEffect(() => {
    if (!registry) return;

    const registeredIds: string[] = [];

    for (const field of flatFields) {
      if (!field.enabled) continue;
      registry.register({
        id: field.id,
        label: field.label,
        type: field.type,
        required: field.required,
        value: field.value,
        options: optionsRef.current.get(field.id),
        setter: wrappersRef.current.get(field.id)!,
        group: field.group,
        elementRef: field.elementRef,
      });
      registeredIds.push(field.id);
    }

    return () => {
      for (const id of registeredIds) {
        registry.unregister(id);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registry, fingerprint]);
}
