import type { SiteConfig } from '@unctad-ai/voice-agent-core';
import type { FormField } from './FormFieldRegistry';

/** Values the LLM might produce for checkbox "true". */
const TRUTHY = new Set(['true', 'yes', '1', 'on']);

/**
 * Resolve a display-friendly service title.
 * Some consuming projects use `name` instead of the canonical `title` field,
 * so we fall back through: title → name → id.
 */
function resolveServiceTitle(service: Record<string, unknown>): string {
  return (service.title as string) || (service.name as string) || (service.id as string);
}

/** Check if a form field value counts as "filled" (not empty/null/undefined). */
function isFilled(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value !== '';
  return true; // booleans, numbers, arrays are valid filled values
}

/** Collect text items from flex-row list patterns (SVG + span/p). */
function extractListItems(container: Element): string[] {
  const items: string[] = [];
  for (const row of container.querySelectorAll('.flex.items-start, .flex.items-center')) {
    const text = (row.querySelector('span') || row.querySelector('p'))?.textContent?.trim();
    if (text) items.push(text);
  }
  return items;
}

/** Find the tightest container for a heading matching keywords (card > section). */
function findSectionByHeading(root: Element, ...keywords: string[]): Element | null {
  for (const h of root.querySelectorAll('h4, h5')) {
    const text = h.textContent?.toLowerCase().trim() ?? '';
    if (keywords.some(k => text.includes(k))) {
      // Prefer card wrapper (.bg-white) over outer section to avoid scope bleed
      return h.closest('.bg-white') || h.closest('section') || h.parentElement;
    }
  }
  return null;
}

/**
 * Read visible service detail content from the DOM when config lacks rich data.
 * Targets eRegistrations Single Window service page structure:
 *   - <section class="mb-12"> with <h4> headings (left column)
 *   - Tabbed panel with <h5> card headings for Requirements/Duration/Cost (right column)
 * Returns null if not in a browser or no meaningful content found.
 */
function extractServicePageContent(): Record<string, unknown> | null {
  if (typeof document === 'undefined') return null;
  const root = document.getElementById('root') || document.body;
  const result: Record<string, unknown> = {};

  // Overview — hero section description
  const heroP = root.querySelector('.bg-neutral-100 p.text-lg, .bg-neutral-100 p.text-base');
  if (heroP?.textContent?.trim()) result.overview = heroP.textContent.trim().slice(0, 500);

  // Left-column sections: "What you will get", "How to apply", "Who can apply", etc.
  for (const section of root.querySelectorAll('section')) {
    const h4 = section.querySelector('h4');
    const heading = h4?.textContent?.toLowerCase().trim() ?? '';

    if (heading.includes('what you will get') || heading.includes('deliverables')) {
      const items = extractListItems(section);
      if (items.length) result.deliverables = items;
    } else if (heading.includes('how to apply') || heading.includes('process') || heading.includes('procedure')) {
      const p = section.querySelector('p');
      if (p?.textContent?.trim()) result.process = p.textContent.trim();
    } else if (heading.includes('who can apply') || heading.includes('eligibility')) {
      const items = extractListItems(section);
      const intro = section.querySelector('p')?.textContent?.trim();
      if (items.length || intro) result.eligibility = intro ? [intro, ...items] : items;
    } else if (heading.includes('responsible') || heading.includes('authority')) {
      const p = section.querySelector('p');
      if (p?.textContent?.trim()) result.authority = p.textContent.trim();
    } else if (heading.includes('legal basis')) {
      const p = section.querySelector('p');
      if (p?.textContent?.trim()) result.legalBasis = p.textContent.trim();
    }
  }

  // Right-column tabbed cards: Requirements, Duration, Cost
  // These live inside .bg-neutral-100 panels with .bg-white cards containing <h5>
  const reqSection = findSectionByHeading(root, 'requirement');
  if (reqSection) {
    const items = extractListItems(reqSection);
    if (items.length) result.requirements = items;
  }

  const durSection = findSectionByHeading(root, 'duration', 'processing time', 'timeframe');
  if (durSection) {
    const p = durSection.querySelector('p');
    if (p?.textContent?.trim()) result.duration = p.textContent.trim();
  }

  const costSection = findSectionByHeading(root, 'cost', 'fee');
  if (costSection) {
    const entries: string[] = [];
    for (const div of costSection.querySelectorAll('.space-y-3 > div, .space-y-2 > div')) {
      const label = div.querySelector('.font-semibold, strong')?.textContent?.trim();
      const values = Array.from(div.querySelectorAll('p'))
        .map(p => p.textContent?.trim())
        .filter((t): t is string => !!t && !t.includes(label ?? ''));
      if (label && values.length) entries.push(`${label}: ${values.join('; ')}`);
      else if (values.length) entries.push(values.join('; '));
    }
    if (entries.length) result.cost = entries.join('. ');
  }

  return Object.keys(result).length > 0 ? result : null;
}

interface ClientToolDeps {
  navigate: (path: string) => void;
  executeUIAction: (
    actionId: string,
    params?: Record<string, unknown>
  ) => string | undefined | Promise<string | undefined>;
  getFormFields: () => FormField[];
  setFormValue: (id: string, value: unknown) => string | null;
  config: SiteConfig;
}

export function createClientToolHandler(deps: ClientToolDeps) {
  const { navigate, executeUIAction, getFormFields, setFormValue, config } = deps;

  return async (toolName: string, args: Record<string, unknown>): Promise<string> => {
    switch (toolName) {
      case 'navigateTo': {
        const page = args.page as string;
        navigate(config.routeMap[page] || '/');
        return page;
      }
      case 'viewService': {
        const serviceId = args.serviceId as string;
        const service = config.services.find(s => s.id === serviceId);
        if (!service) return 'Service not found';
        navigate(`/service/${serviceId}`);
        return `Navigated to ${resolveServiceTitle(service)} info page.`;
      }
      case 'getServiceDetails': {
        const serviceId = args.serviceId as string;
        const service = config.services.find(s => s.id === serviceId);
        if (!service) return 'Service not found';
        const { id, ...details } = service;
        const hasArray = (v: unknown) => Array.isArray(v) && v.length > 0;
        const hasRichData = details.duration || details.cost || details.overview
          || hasArray(details.requirements) || hasArray(details.steps)
          || hasArray(details.eligibility) || hasArray(details.process);
        if (!hasRichData) {
          // Attempt to read visible page content when config lacks rich data
          const pageContent = extractServicePageContent();
          if (pageContent) {
            return JSON.stringify({ ...details, ...pageContent });
          }
          return JSON.stringify({
            ...details,
            _note: 'Only basic info is available to the assistant. The page may show additional details like duration, cost, and requirements that are not loaded here. Do not claim these details are absent — say you do not have that information.',
          });
        }
        return JSON.stringify(details);
      }
      case 'startApplication': {
        const serviceId = args.serviceId as string;
        const service = config.services.find(s => s.id === serviceId);
        if (!service) return 'Service not found';
        const route = config.getServiceFormRoute(serviceId);
        if (!route) {
          navigate(`/service/${serviceId}`);
          return `No online application form exists for "${resolveServiceTitle(service)}" yet — tell the user clearly that only the information page is available. Navigated to the info page instead.`;
        }
        navigate(route);
        return `Opened "${resolveServiceTitle(service)}" application form.`;
      }
      case 'performUIAction': {
        const actionId = args.actionId as string;
        let params: Record<string, unknown> | undefined;
        if (args.paramsJson) {
          let jsonStr = (args.paramsJson as string).trim();
          jsonStr = jsonStr.replace(/([{,]\s*)([a-zA-Z_]\w*)\s*:/g, '$1"$2":');
          jsonStr = jsonStr.replace(/,\s*([}\]])/g, '$1');
          try {
            params = JSON.parse(jsonStr);
          } catch {
            return `Could not parse params "${args.paramsJson}". Use valid JSON like {"key": "value"}.`;
          }
        }
        const result = await executeUIAction(actionId, params);
        if (!result) return `Action "${actionId}" not found or did not execute. <internal>Check UI_ACTIONS for valid action IDs.</internal>`;
        const firstSentence = result.split(/\.(?:\s|$)/)[0];
        return firstSentence || result;
      }
      case 'getFormSchema': {
        const allFields = getFormFields();
        // Separate gated marker fields from real fields
        const gatedFields = allFields.filter(f => f.gatedAction);
        const fields = allFields.filter(f => !f.gatedAction);

        if (fields.length === 0 && gatedFields.length === 0)
          return 'No form fields are visible right now. <internal>A UI action may be needed first — check UI_ACTIONS for the next step.</internal>';

        const fieldToSchema = (f: FormField) => ({
          id: f.id,
          label: f.label,
          type: f.type,
          value: f.value ?? null,
          ...(f.options?.length ? { opts: f.options } : {}),
        });
        const fillableFields = fields.filter(f => f.type !== 'upload');
        const allFilled = fillableFields.length > 0 && fillableFields.every(f => isFilled(f.value));
        const hint = allFilled
          ? 'All visible fields are filled. <internal>Check UI_ACTIONS for the next tab or submit action.</internal>'
          : undefined;

        // Build gated section placeholders — deduplicate by action ID
        const seenActions = new Set<string>();
        const gatedSections: Array<{ section: string; gated: true; action: string }> = [];
        for (const f of gatedFields) {
          const action = f.gatedAction!;
          if (seenActions.has(action)) continue;
          seenActions.add(action);
          gatedSections.push({ section: f.group || f.label, gated: true, action });
        }

        const hasGroups = fields.some((f) => f.group);
        if (!hasGroups && gatedSections.length === 0) {
          if (hint) return JSON.stringify({ fields: fields.map(fieldToSchema), hint });
          return JSON.stringify(fields.map(fieldToSchema));
        }
        const sectionMap = new Map<string, FormField[]>();
        for (const f of fields) {
          const key = f.group || '_ungrouped';
          const arr = sectionMap.get(key);
          if (arr) arr.push(f);
          else sectionMap.set(key, [f]);
        }
        const sections = [
          ...gatedSections,
          ...Array.from(sectionMap.entries()).map(([section, sectionFields]) => ({
            section: section === '_ungrouped' ? 'Other' : section,
            fields: sectionFields.map(fieldToSchema),
          })),
        ];
        const result: Record<string, unknown> = { sections };
        // Gated-section hint takes priority: if gated sections exist, the form
        // cannot truly be "all filled" — the gated fields aren't even visible yet.
        if (gatedSections.length > 0) {
          const actions = gatedSections.map(s => `${s.action} (opens ${s.section})`).join(', ');
          result.hint = `<internal>FIRST call performUIAction for: ${actions}. Then call getFormSchema again.</internal>`;
        } else if (hint) {
          result.hint = hint;
        }
        return JSON.stringify(result);
      }
      case 'fillFormFields': {
        const fieldEntries = args.fields as Array<{ fieldId: string; value: string }>;
        const filled: string[] = [];
        const errors: string[] = [];
        const allFields = getFormFields();
        for (const entry of fieldEntries) {
          const fieldDef = allFields.find((f) => f.id === entry.fieldId);
          if (fieldDef?.gatedAction) { errors.push(`"${entry.fieldId}" is gated — call ${fieldDef.gatedAction} first`); continue; }
          if (fieldDef?.type === 'upload') { errors.push(`"${entry.fieldId}" is a file upload — the user must handle it manually`); continue; }
          const coerced =
            fieldDef?.type === 'checkbox'
              ? typeof entry.value === 'boolean'
                ? entry.value
                : TRUTHY.has(String(entry.value).toLowerCase())
              : entry.value;
          const result = setFormValue(entry.fieldId, coerced);
          if (result === null) errors.push(`Field "${entry.fieldId}" not found or invalid value`);
          else filled.push(result);
        }
        if (filled.length === 0) return errors.length > 0 ? errors.join('; ') : 'No fields matched';
        const summary = filled.join(', ');
        return errors.length > 0 ? `${summary} (${errors.length} failed)` : summary;
      }
      default:
        return `Unknown tool: ${toolName}`;
    }
  };
}
