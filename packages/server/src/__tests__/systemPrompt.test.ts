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
  // --- Structure: decision cascade order ---

  it('SILENT section comes first (before RULES)', () => {
    const prompt = buildSystemPrompt(stubConfig);
    const silentIndex = prompt.indexOf('SILENT:');
    const rulesIndex = prompt.indexOf('RULES:');
    expect(silentIndex).toBeLessThan(rulesIndex);
  });

  it('RULES section comes before TOOLS', () => {
    const prompt = buildSystemPrompt(stubConfig);
    const rulesIndex = prompt.indexOf('RULES:');
    const toolsIndex = prompt.indexOf('TOOLS:');
    expect(rulesIndex).toBeLessThan(toolsIndex);
  });

  it('FORMS section comes after TOOLS', () => {
    const prompt = buildSystemPrompt(stubConfig);
    const toolsIndex = prompt.indexOf('TOOLS:');
    const formsIndex = prompt.indexOf('FORMS');
    expect(toolsIndex).toBeLessThan(formsIndex);
  });

  it('GOODBYE comes last', () => {
    const prompt = buildSystemPrompt(stubConfig);
    const goodbyeIndex = prompt.indexOf('GOODBYE:');
    const formsIndex = prompt.indexOf('FORMS');
    expect(formsIndex).toBeLessThan(goodbyeIndex);
  });

  // --- Identity ---

  it('includes copilot name in identity line', () => {
    const prompt = buildSystemPrompt(stubConfig);
    expect(prompt).toContain('You are TestBot');
  });

  // --- SILENT section ---

  it('SILENT has concrete examples', () => {
    const prompt = buildSystemPrompt(stubConfig);
    expect(prompt).toContain('"hmm yeah okay" → <silent/>');
    expect(prompt).toContain('better to stay silent than to interrupt');
  });

  // --- RULES section ---

  it('includes base rules with numbered format', () => {
    const prompt = buildSystemPrompt(stubConfig);
    expect(prompt).toContain('RULES:');
    expect(prompt).toMatch(/RULES:.*\n1\./s);
  });

  it('rule 1 enforces brevity and bans contractions including "it is"', () => {
    const prompt = buildSystemPrompt(stubConfig);
    expect(prompt).toMatch(/Two sentences max, under 40 words/);
    expect(prompt).toContain('"it is" not "it\'s"');
  });

  it('has BAD/GOOD examples for brevity', () => {
    const prompt = buildSystemPrompt(stubConfig);
    expect(prompt).toContain('BAD:');
    expect(prompt).toContain('GOOD:');
  });

  it('has BAD/GOOD examples for tool-result summarization', () => {
    const prompt = buildSystemPrompt(stubConfig);
    expect(prompt).toContain('BAD (after tool results');
    expect(prompt).toContain('GOOD (after tool results');
  });

  it('rule about <internal> tags keeps them secret', () => {
    const prompt = buildSystemPrompt(stubConfig);
    expect(prompt).toMatch(/Never repeat text inside <internal> tags/);
    expect(prompt).toContain('<internal>');
    expect(prompt).not.toContain('[INTERNAL:');
  });

  it('forbids fabrication — only tool result facts', () => {
    const prompt = buildSystemPrompt(stubConfig);
    expect(prompt).toMatch(/only state facts from tool results/);
  });

  it('requires expanding abbreviations for speech', () => {
    const prompt = buildSystemPrompt(stubConfig);
    expect(prompt).toMatch(/Expand all abbreviations for speech/);
  });

  // --- TONE ---

  it('includes "You are welcome" template to prevent contraction', () => {
    const prompt = buildSystemPrompt(stubConfig);
    expect(prompt).toContain('You are welcome');
  });

  // --- TOOLS (merged section) ---

  it('TOOLS section merges navigation, selection, and context rules', () => {
    const prompt = buildSystemPrompt(stubConfig);
    expect(prompt).toContain('TOOLS:');
    expect(prompt).toContain('searchServices');
    expect(prompt).toContain('viewService AND getServiceDetails');
    expect(prompt).toContain('listServicesByCategory');
    expect(prompt).toContain('startApplication');
    expect(prompt).toContain('/service/*');
    expect(prompt).toContain('/dashboard/*');
    expect(prompt).toContain('Track context');
  });

  // --- FORMS section ---

  it('FORMS section uses numbered sub-rules', () => {
    const prompt = buildSystemPrompt(stubConfig);
    expect(prompt).toMatch(/FORMS.*\n1\./s);
    expect(prompt).toContain('2.');
    expect(prompt).toContain('7.');
  });

  it('FORMS rule 3 checks UI_ACTIONS when no unfilled required fields remain', () => {
    const prompt = buildSystemPrompt(stubConfig);
    expect(prompt).toMatch(/no unfilled required fields.*check UI_ACTIONS/s);
  });

  it('FORMS rule 4 calls performUIAction for gated sections', () => {
    const prompt = buildSystemPrompt(stubConfig);
    expect(prompt).toMatch(/gated with an action.*performUIAction/s);
  });

  it('FORMS rule 5 requires tab param in paramsJson', () => {
    const prompt = buildSystemPrompt(stubConfig);
    expect(prompt).toMatch(/Tab switches.*tab name in paramsJson/s);
  });

  it('FORMS rule 5 forbids premature outcome description', () => {
    const prompt = buildSystemPrompt(stubConfig);
    expect(prompt).toMatch(/Never describe an outcome before executing/);
  });

  it('FORMS rule 6 enforces upload-first, forbids manual entry', () => {
    const prompt = buildSystemPrompt(stubConfig);
    expect(prompt).toMatch(/Do not offer manual entry as an alternative/);
  });

  it('FORMS rule 7 guards completion claims', () => {
    const prompt = buildSystemPrompt(stubConfig);
    expect(prompt).toMatch(/Never claim complete without calling getFormSchema/);
  });

  // --- Dynamic context ---

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

  it('returns prompt without dynamic section when no clientState', () => {
    const prompt = buildSystemPrompt(stubConfig);
    expect(prompt).not.toContain('Current page:');
    expect(prompt).not.toContain('UI_ACTIONS available on this page');
  });

  it('includes currentTab when provided in clientState', () => {
    const prompt = buildSystemPrompt(stubConfig, { currentTab: 'Documents' });
    expect(prompt).toContain('Active form tab: Documents');
  });

  it('omits tab line when currentTab is not set', () => {
    const prompt = buildSystemPrompt(stubConfig, { route: '/dashboard/tax' });
    expect(prompt).not.toContain('Active form tab');
  });

  it('does not include /no_think', () => {
    const prompt = buildSystemPrompt(stubConfig);
    expect(prompt).not.toContain('/no_think');
  });
});
