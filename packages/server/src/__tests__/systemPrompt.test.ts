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

  it('does not include /no_think — thinking is stripped by sanitizeForTTS instead', () => {
    const prompt = buildSystemPrompt(stubConfig);
    expect(prompt).not.toContain('/no_think');
  });

  it('FORMS section uses numbered sub-rules', () => {
    const prompt = buildSystemPrompt(stubConfig);
    expect(prompt).toMatch(/FORMS:.*\n1\./s);
    expect(prompt).toContain('2.');
    expect(prompt).toContain('3.');
  });

  it('FORMS includes critical "never say complete" guard rule', () => {
    const prompt = buildSystemPrompt(stubConfig);
    expect(prompt).toMatch(/NEVER say a form is complete without calling getFormSchema/);
  });

  it('FORMS rule 7 forbids premature completion claims', () => {
    const prompt = buildSystemPrompt(stubConfig);
    expect(prompt).toMatch(/NEVER describe the outcome of an action before it executes/);
  });

  it('FORMS rule 8 enforces upload-first ordering', () => {
    const prompt = buildSystemPrompt(stubConfig);
    expect(prompt).toMatch(/handle uploads FIRST/);
  });

  it('SILENT rule comes after FORMS section', () => {
    const prompt = buildSystemPrompt(stubConfig);
    const formsIndex = prompt.indexOf('FORMS:');
    const silentIndex = prompt.indexOf('[SILENT]');
    expect(formsIndex).toBeLessThan(silentIndex);
  });

  it('GOODBYE comes after FORMS section', () => {
    const prompt = buildSystemPrompt(stubConfig);
    const formsIndex = prompt.indexOf('FORMS:');
    const goodbyeIndex = prompt.indexOf('GOODBYE:');
    expect(formsIndex).toBeLessThan(goodbyeIndex);
  });

  it('returns prompt without dynamic section when no clientState', () => {
    const prompt = buildSystemPrompt(stubConfig);
    expect(prompt).not.toContain('Current page:');
    expect(prompt).not.toContain('UI_ACTIONS available on this page');
  });

  it('rule 3 references <internal> tags, not [INTERNAL:]', () => {
    const prompt = buildSystemPrompt(stubConfig);
    expect(prompt).toContain('<internal>');
    expect(prompt).not.toContain('[INTERNAL:');
  });

  it('includes currentTab when provided in clientState', () => {
    const prompt = buildSystemPrompt(stubConfig, { currentTab: 'Documents' });
    expect(prompt).toContain('Active form tab: Documents');
  });

  it('omits tab line when currentTab is not set', () => {
    const prompt = buildSystemPrompt(stubConfig, { route: '/dashboard/tax' });
    expect(prompt).not.toContain('Active form tab');
  });
});
