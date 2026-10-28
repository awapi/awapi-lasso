import { describe, expect, it } from 'vitest';
import { AI_PROVIDER_IDS, AI_PROVIDERS, createDefaultAiSettings, isAiProviderId } from './aiTypes';

describe('aiTypes', () => {
  it('validates provider ids', () => {
    expect(isAiProviderId('openai')).toBe(true);
    expect(isAiProviderId('anthropic')).toBe(true);
    expect(isAiProviderId('openai-compatible')).toBe(true);
    expect(isAiProviderId('gemini')).toBe(false);
    expect(isAiProviderId(undefined)).toBe(false);
  });

  it('describes every provider', () => {
    for (const id of AI_PROVIDER_IDS) {
      expect(AI_PROVIDERS[id].id).toBe(id);
      expect(AI_PROVIDERS[id].defaultModel).not.toBe('');
      expect(AI_PROVIDERS[id].defaultBaseUrl).toMatch(/^https?:\/\//);
    }
  });

  it('creates independent default settings', () => {
    const a = createDefaultAiSettings();
    const b = createDefaultAiSettings();
    a.models.openai = 'changed';
    expect(b.models.openai).toBe(AI_PROVIDERS.openai.defaultModel);
    expect(a.confirmBeforeRun).toBe(true);
    expect(a.autoApplyEdits).toBe(false);
    expect(a.shareEnvironmentValues).toBe(true);
  });
});
