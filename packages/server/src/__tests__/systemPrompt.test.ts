import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../systemPrompt.js';
import type { SiteConfig } from '@unctad-ai/voice-agent-core';

const stubConfig: SiteConfig = {
  copilotName: 'TestBot',
  siteTitle: 'Test Portal',
  systemPromptIntro: 'You help users with tests.',
  services: [],
  categories: [],
  categoryMap: {},
  routeMap: {},
  synonyms: {},
  colors: { primary: '#000', processing: '#111', speaking: '#222', glow: '#333' },
  getServiceFormRoute: () => null,
};

describe('buildSystemPrompt', () => {
  it('includes copilot name in identity line', () => {
    const prompt = buildSystemPrompt(stubConfig);
    expect(prompt).toContain('You are TestBot');
  });

  it('includes base rules', () => {
    const prompt = buildSystemPrompt(stubConfig);
    expect(prompt).toContain('RULES:');
    expect(prompt).toContain('FORMS:');
  });

  it('appends route when clientState has route', () => {
    const prompt = buildSystemPrompt(stubConfig, { route: '/dashboard/tax' });
    expect(prompt).toContain('Current page: /dashboard/tax');
  });

  it('appends UI_ACTIONS when present', () => {
    const prompt = buildSystemPrompt(stubConfig, {
      uiActions: [{ id: 'switch-tab', description: 'Switch to Documents tab' }],
    });
    expect(prompt).toContain('UI_ACTIONS');
    expect(prompt).toContain('switch-tab');
  });

  it('includes /no_think directive in identity line', () => {
    const prompt = buildSystemPrompt(stubConfig);
    expect(prompt).toContain('/no_think');
  });

  it('returns prompt without dynamic section when no clientState', () => {
    const prompt = buildSystemPrompt(stubConfig);
    expect(prompt).not.toContain('Current page:');
    expect(prompt).not.toContain('UI_ACTIONS available on this page');
  });
});
