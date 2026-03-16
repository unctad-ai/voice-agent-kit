import { tool } from 'ai';
import { z } from 'zod';
import type { SiteConfig, ServiceBase } from '@unctad-ai/voice-agent-core';

// --- Synonym map builder ---

export function buildSynonymMap(synonyms: Record<string, string[]>): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const [key, values] of Object.entries(synonyms)) {
    if (!map[key]) map[key] = [];
    map[key].push(...values);
    for (const v of values) {
      if (!map[v]) map[v] = [];
      if (!map[v].includes(key)) map[v].push(key);
    }
  }
  return map;
}

// --- Levenshtein distance ---

export function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

// --- Fuzzy search ---

export function fuzzySearch(
  query: string,
  services: ServiceBase[],
  synonymMap: Record<string, string[]>
): ServiceBase[] {
  const q = query.toLowerCase();
  const searchTerms = [q];
  for (const [term, synonyms] of Object.entries(synonymMap)) {
    if (q.includes(term)) searchTerms.push(...synonyms);
  }
  const queryWords = q.split(/\s+/).filter((w) => w.length >= 3);
  return services.filter((s) => {
    const titleLower = (s.title || '').toLowerCase();
    const overviewLower = (s.overview || '').toLowerCase();
    const categoryLower = (s.category || '').toLowerCase();
    const corpus = `${titleLower} ${overviewLower} ${categoryLower}`;
    const substringMatch = searchTerms.some(
      (term) => titleLower.includes(term) || overviewLower.includes(term) || categoryLower.includes(term)
    );
    if (substringMatch) return true;
    const corpusWords = corpus.split(/\s+/);
    return queryWords.some(
      (qw) => qw.length >= 5 && corpusWords.some((cw) => cw.length >= 5 && levenshtein(qw, cw) <= 2)
    );
  });
}

// --- Tool factory ---

export function createBuiltinTools(config: SiteConfig) {
  const synonymMap = buildSynonymMap(config.synonyms);

  // Helper: find service by ID
  function getServiceById(id: string): ServiceBase | undefined {
    return config.services.find((s) => s.id === id);
  }

  // --- Server-side tools (have execute) ---

  const serverTools = {
    searchServices: tool({
      description: `Search ${config.siteTitle} services by keyword. Supports synonyms. When the search returns a single clear match, immediately follow up with viewService to show the page.`,
      inputSchema: z.object({ query: z.string().describe('Search query') }),
      execute: async ({ query }) => {
        const results = fuzzySearch(query, config.services, synonymMap);
        return {
          totalResults: results.length,
          services: results.map((s) => ({
            id: s.id, title: s.title, category: s.category, duration: s.duration, cost: s.cost,
          })),
        };
      },
    }),
    // getServiceDetails is a CLIENT tool — the client has the full rich data
    // (requirements, steps, cost, eligibility). See clientToolHandlers.ts.
    listServicesByCategory: tool({
      description: 'List all services in a category. Use when the user asks what services are available or wants to browse.',
      inputSchema: z.object({
        category: z.enum(Object.keys(config.categoryMap) as [string, ...string[]]).describe('Category to list'),
      }),
      execute: async ({ category }) => {
        const categoryTitle = config.categoryMap[category];
        const cat = config.categories.find((c) => c.title.toLowerCase() === categoryTitle?.toLowerCase());
        if (!cat) return { error: 'Category not found' };
        return cat.services.map((s) => ({ id: s.id, title: s.title, duration: s.duration, cost: s.cost }));
      },
    }),
    compareServices: tool({
      description: 'Compare two or more services side by side.',
      inputSchema: z.object({ serviceIds: z.array(z.string()).min(2) }),
      execute: async ({ serviceIds }) => {
        const services = serviceIds.map((id) => getServiceById(id)).filter(Boolean);
        if (services.length < 2) return 'Could not find enough valid services to compare.';
        return services.map((s) => ({
          id: s!.id, title: s!.title, duration: s!.duration, cost: s!.cost,
          requirements: s!.requirements, eligibility: s!.eligibility,
        }));
      },
    }),
  };

  // --- Client-side tools (NO execute — handled via onToolCall in useChat) ---

  const clientTools = {
    navigateTo: tool({
      description: `Navigate to a page in ${config.siteTitle}.`,
      inputSchema: z.object({
        page: z.enum(Object.keys(config.routeMap) as [string, ...string[]]).describe('Page key from route map'),
      }),
    }),
    viewService: tool({
      description: 'Navigate to a specific service detail page. Use the id from searchServices.',
      inputSchema: z.object({ serviceId: z.string() }),
    }),
    getServiceDetails: tool({
      description: 'Get full details about a service (requirements, steps, cost, duration) so you can answer verbally. Call searchServices first to get the id. Use alongside viewService.',
      inputSchema: z.object({ serviceId: z.string() }),
    }),
    startApplication: tool({
      description: 'Navigate to an application form for a service. Use when the user wants to apply or register.',
      inputSchema: z.object({ serviceId: z.string() }),
    }),
    performUIAction: tool({
      description: 'Execute a UI action on the current page such as clicking a button, switching a tab, or toggling a view.',
      inputSchema: z.object({
        actionId: z.string().describe('The action id from UI_ACTIONS context'),
        paramsJson: z.string().optional().describe('JSON params string, e.g. {"tab":"taxes"}'),
      }),
    }),
    getFormSchema: tool({
      description: 'Get available form field IDs and types. Call this ONCE before fillFormFields.',
      inputSchema: z.object({}),
    }),
    fillFormFields: tool({
      description: 'Fill one or more form fields. Use field IDs from getFormSchema.',
      inputSchema: z.object({
        fields: z.array(z.object({
          fieldId: z.string().describe('The field ID from getFormSchema'),
          value: z.string().describe('The value to set'),
        })),
      }),
    }),
  };

  return { serverTools, clientTools };
}
