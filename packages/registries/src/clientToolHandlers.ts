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
        return `Opened "${resolveServiceTitle(service)}" application form. Check UI_ACTIONS for what the user needs to do first — do NOT call getFormSchema yet. Guide the user through the first visible step.`;
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
        if (!result) return `Action "${actionId}" not found or did not execute. Check UI_ACTIONS for valid action IDs on this page.`;
        const firstSentence = result.split(/\.(?:\s|$)/)[0];
        return firstSentence || result;
      }
      case 'getFormSchema': {
        const fields = getFormFields();
        if (fields.length === 0)
          return 'No form fields are visible right now. The form may need a UI action first — check UI_ACTIONS for the next step (e.g. "Add Director").';
        const fieldToSchema = (f: FormField) => ({
          id: f.id,
          label: f.label,
          type: f.type,
          value: f.value ?? null,
          ...(f.options?.length ? { opts: f.options } : {}),
        });
        const hasGroups = fields.some((f) => f.group);
        if (!hasGroups) return JSON.stringify(fields.map(fieldToSchema));
        const sectionMap = new Map<string, FormField[]>();
        for (const f of fields) {
          const key = f.group || '_ungrouped';
          const arr = sectionMap.get(key);
          if (arr) arr.push(f);
          else sectionMap.set(key, [f]);
        }
        return JSON.stringify({
          sections: Array.from(sectionMap.entries()).map(([section, sectionFields]) => ({
            section: section === '_ungrouped' ? 'Other' : section,
            fields: sectionFields.map(fieldToSchema),
          })),
        });
      }
      case 'fillFormFields': {
        const fieldEntries = args.fields as Array<{ fieldId: string; value: string }>;
        const filled: string[] = [];
        const errors: string[] = [];
        const allFields = getFormFields();
        for (const entry of fieldEntries) {
          const fieldDef = allFields.find((f) => f.id === entry.fieldId);
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
