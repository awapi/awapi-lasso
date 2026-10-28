import { describe, expect, it } from 'vitest';
import { createDefaultAiSettings } from '../../shared/aiTypes';
import { SecretEncryptionUnavailableError, type SecretStoreDeps } from '../secretStore';
import {
  AI_SETTINGS_FILENAME,
  aiKeyCoordinate,
  clearAiKey,
  hasAiKey,
  loadAiSettings,
  readAiKey,
  saveAiSettings,
  setAiKey,
  type AiSettingsFsDeps,
} from './aiSettingsStore';

function createDeps(encryptionAvailable = true) {
  const files = new Map<string, string>();
  const dirs = new Set<string>(['/userdata']);
  const secretDeps: SecretStoreDeps = {
    userDataDir: '/userdata',
    isEncryptionAvailable: () => encryptionAvailable,
    encryptString: plain => Buffer.from(`cipher:${plain}`, 'utf-8'),
    decryptString: buf => buf.toString('utf-8').slice('cipher:'.length),
    exists: p => files.has(p) || dirs.has(p),
    readFile: p => {
      const v = files.get(p);
      if (v === undefined) throw new Error(`ENOENT: ${p}`);
      return v;
    },
    writeFile: (p, c) => void files.set(p, c),
    mkdir: p => void dirs.add(p),
  };
  const fsDeps: AiSettingsFsDeps = { ...secretDeps, joinPath: (...parts) => parts.join('/') };
  return { files, secretDeps, fsDeps };
}

describe('AI settings persistence', () => {
  it('returns defaults when nothing is saved or the file is corrupt', () => {
    const { files, fsDeps } = createDeps();
    expect(loadAiSettings(fsDeps)).toEqual(createDefaultAiSettings());
    files.set(`/userdata/${AI_SETTINGS_FILENAME}`, '{not json');
    expect(loadAiSettings(fsDeps)).toEqual(createDefaultAiSettings());
  });

  it('merges and persists partial updates', () => {
    const { files, fsDeps } = createDeps();
    const saved = saveAiSettings({ provider: 'anthropic', models: { anthropic: 'claude-x' } as never }, fsDeps);
    expect(saved.provider).toBe('anthropic');
    expect(saved.models.anthropic).toBe('claude-x');
    expect(saved.models.openai).toBe(createDefaultAiSettings().models.openai);
    expect(JSON.parse(files.get(`/userdata/${AI_SETTINGS_FILENAME}`) as string).provider).toBe('anthropic');
    expect(loadAiSettings(fsDeps)).toEqual(saved);
  });

  it('sanitizes invalid values', () => {
    const { fsDeps } = createDeps();
    const saved = saveAiSettings(
      {
        provider: 'bogus' as never,
        temperature: 9,
        maxTokens: -5,
        baseUrls: { 'openai-compatible': 'ftp://nope' } as never,
      },
      fsDeps,
    );
    const defaults = createDefaultAiSettings();
    expect(saved.provider).toBe(defaults.provider);
    expect(saved.temperature).toBe(defaults.temperature);
    expect(saved.maxTokens).toBe(defaults.maxTokens);
    expect(saved.baseUrls['openai-compatible']).toBe(defaults.baseUrls['openai-compatible']);
  });

  it('normalizes trailing slashes in base URLs', () => {
    const { fsDeps } = createDeps();
    const saved = saveAiSettings(
      { baseUrls: { 'openai-compatible': 'http://localhost:1234/v1///' } as never },
      fsDeps,
    );
    expect(saved.baseUrls['openai-compatible']).toBe('http://localhost:1234/v1');
  });
});

describe('AI key storage', () => {
  it('stores keys encrypted per provider and never in the settings file', () => {
    const { files, secretDeps, fsDeps } = createDeps();
    expect(hasAiKey('openai', secretDeps)).toBe(false);
    setAiKey('openai', '  sk-test-123  ', secretDeps);
    saveAiSettings({ provider: 'openai' }, fsDeps);
    expect(hasAiKey('openai', secretDeps)).toBe(true);
    expect(hasAiKey('anthropic', secretDeps)).toBe(false);
    expect(readAiKey('openai', secretDeps)).toBe('sk-test-123');
    for (const content of files.values()) {
      expect(content).not.toContain('sk-test-123');
    }
    expect(aiKeyCoordinate('openai').scopeId).toBe('provider:openai');
  });

  it('rejects empty keys', () => {
    const { secretDeps } = createDeps();
    expect(() => setAiKey('openai', '   ', secretDeps)).toThrow(/empty/);
  });

  it('refuses to store when keychain encryption is unavailable', () => {
    const { secretDeps } = createDeps(false);
    expect(() => setAiKey('openai', 'sk-test', secretDeps)).toThrow(SecretEncryptionUnavailableError);
    expect(hasAiKey('openai', secretDeps)).toBe(false);
  });

  it('clears a stored key', () => {
    const { secretDeps } = createDeps();
    setAiKey('anthropic', 'sk-ant', secretDeps);
    expect(clearAiKey('anthropic', secretDeps)).toBe(true);
    expect(hasAiKey('anthropic', secretDeps)).toBe(false);
    expect(clearAiKey('anthropic', secretDeps)).toBe(false);
  });
});
