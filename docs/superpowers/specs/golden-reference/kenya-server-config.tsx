// Server-side voice config for Kenya
// Uses dynamic import() to load CJS-mode frontend modules from ESM server context.
import type { SiteConfig } from '@unctad-ai/voice-agent-core';
import { tool } from 'ai';
import { z } from 'zod';
import { buildSynonymMap, fuzzySearch } from '@unctad-ai/voice-agent-server';

// Dynamic import bridges ESM→CJS boundary (root package.json has no "type": "module")
const { serviceCategories } = await import('../src/data/services.ts');
const { getServiceFormRoute } = await import('../src/utils/serviceRoutes.ts');

const allServices = serviceCategories.flatMap((c: { services: unknown[] }) => c.services);

export const kenyaSiteConfig: SiteConfig = {
  copilotName: 'Pesa',
  siteTitle: "Kenya's Business Gateway",
  farewellMessage: 'I will close this session now. Feel free to come back anytime.',
  systemPromptIntro: 'You help investors navigate government services, fill forms, and find opportunities.',

  avatarUrl: '/pesa-portrait.png',

  colors: {
    primary: '#DB2129',
    processing: '#F59E0B',
    speaking: '#14B8A6',
    glow: '#f35f3f',
    error: '#DC2626',
  },

  services: allServices,
  categories: serviceCategories,
  synonyms: {
    technology: ['ict', 'bpo', 'digital', 'software'],
    tech: ['ict', 'bpo', 'digital'],
    farming: ['agriculture', 'agri'],
    farm: ['agriculture'],
    fishing: ['blue economy', 'marine', 'aquaculture'],
    building: ['construction', 'infrastructure'],
    tourism: ['tourism', 'hospitality', 'hotel'],
    mining: ['mining', 'extractive', 'mineral'],
    factory: ['manufacturing', 'industrial'],
    visa: ['work permit', 'immigration'],
    tax: ['tax', 'pin', 'vat', 'exemption', 'kra'],
    permit: ['permit', 'license', 'county business'],
    environment: ['environmental', 'impact assessment', 'nema'],
    creative: ['creative', 'arts', 'media', 'film'],
    forestry: ['forestry', 'timber', 'wood'],
    ppp: ['public private partnership', 'ppp'],
    company: ['register', 'registration', 'incorporate', 'incorporation'],
    business: ['register', 'registration', 'company', 'enterprise'],
  },
  categoryMap: {
    investor: 'Investor services',
    permits: 'Permits and licenses',
    investment: 'Investment opportunities',
  },
  routeMap: {
    home: '/',
    dashboard: '/dashboard',
    services: '/dashboard/services',
    applications: '/dashboard/applications',
    account: '/dashboard/account',
    settings: '/dashboard/settings',
    'personal-info': '/dashboard/account/personal-info',
    'business-info': '/dashboard/account/business-info',
  },
  getServiceFormRoute,
  personaEndpoint: '/api/agent',
};

// --- Kenya-specific: recommendServices tool ---
const synonymMap = buildSynonymMap(kenyaSiteConfig.synonyms);

const recommendServices = tool({
  description: 'Recommend relevant services based on investor profile (nationality, business type, investment size).',
  inputSchema: z.object({
    nationality: z.string().describe('Investor nationality or country'),
    businessType: z.string().describe('Type of business or sector'),
    investmentSize: z.string().optional().describe('Investment amount range'),
  }),
  execute: async ({ nationality, businessType, investmentSize }) => {
    const isKenyan = /kenya/i.test(nationality);
    let results = fuzzySearch(businessType, kenyaSiteConfig.services, synonymMap);

    // Always include core registration services for foreign investors
    if (!isKenyan) {
      const coreIds = ['company-registration', 'work-permit', 'investor-certificate'];
      const coreServices = kenyaSiteConfig.services.filter(s => coreIds.includes(s.id));
      results = [...new Map([...results, ...coreServices].map(s => [s.id, s])).values()];
    }

    return {
      totalResults: results.length,
      investorType: isKenyan ? 'domestic' : 'foreign',
      services: results.slice(0, 8).map(s => ({
        id: s.id, title: s.title, category: s.category,
        duration: s.duration, cost: s.cost,
      })),
    };
  },
});

kenyaSiteConfig.extraServerTools = { recommendServices };
