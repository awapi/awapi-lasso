import {
  AI_PROVIDER_IDS,
  DEFAULT_AI_MAX_TOKENS,
  DEFAULT_AI_TEMPERATURE,
  createDefaultAiSettings,
  isAiProviderId,
  type AiProviderId,
  type AiSettings,
} from '../../shared/aiTypes';
import {
  deleteSecret,
  getSecret,
  setSecret,
  type SecretCoordinate,
  type SecretStoreDeps,
} from '../secretStore';

export const AI_SETTINGS_FILENAME = 'ai-settings.json';
const AI_SECRET_COLLECTION_ID = '__ai__';

export interface AiSettingsFsDeps {
  userDataDir: string;
  exists: (filePath: string) => boolean;
  readFile: (filePath: string) => string;
  writeFile: (filePath: string, content: string) => void;
  mkdir: (dirPath: string) => void;
  joinPath: (...parts: string[]) => string;
}

export function aiKeyCoordinate(provider: AiProviderId): SecretCoordinate {
  return { collectionId: AI_SECRET_COLLECTION_ID, scopeId: `provider:${provider}`, key: 'apiKey' };
}

function sanitizeSettings(raw: unknown): AiSettings {
  const defaults = createDefaultAiSettings();
  if (!raw || typeof raw !== 'object') return defaults;
  const parsed = raw as Partial<Record<keyof AiSettings, unknown>>;

  const models = { ...defaults.models };
  const baseUrls = { ...defaults.baseUrls };
  for (const id of AI_PROVIDER_IDS) {
    const model = (parsed.models as Record<string, unknown> | undefined)?.[id];
    if (typeof model === 'string' && model.trim()) models[id] = model.trim();
    const baseUrl = (parsed.baseUrls as Record<string, unknown> | undefined)?.[id];
    if (typeof baseUrl === 'string' && /^https?:\/\//i.test(baseUrl.trim())) {
      baseUrls[id] = baseUrl.trim().replace(/\/+$/, '');
    }
  }

  const temperature =
    typeof parsed.temperature === 'number' && parsed.temperature >= 0 && parsed.temperature <= 2
      ? parsed.temperature
      : DEFAULT_AI_TEMPERATURE;
  const maxTokens =
    typeof parsed.maxTokens === 'number' && Number.isInteger(parsed.maxTokens) && parsed.maxTokens > 0
      ? Math.min(parsed.maxTokens, 200000)
      : DEFAULT_AI_MAX_TOKENS;

  return {
    provider: isAiProviderId(parsed.provider) ? parsed.provider : defaults.provider,
    models,
    baseUrls,
    temperature,
    maxTokens,
    confirmBeforeRun: typeof parsed.confirmBeforeRun === 'boolean' ? parsed.confirmBeforeRun : true,
    autoApplyEdits: typeof parsed.autoApplyEdits === 'boolean' ? parsed.autoApplyEdits : false,
    shareEnvironmentValues:
      typeof parsed.shareEnvironmentValues === 'boolean' ? parsed.shareEnvironmentValues : true,
  };
}

export function loadAiSettings(deps: AiSettingsFsDeps): AiSettings {
  const file = deps.joinPath(deps.userDataDir, AI_SETTINGS_FILENAME);
  try {
    if (deps.exists(file)) return sanitizeSettings(JSON.parse(deps.readFile(file)));
  } catch {
    // corrupt settings fall back to defaults
  }
  return createDefaultAiSettings();
}

export function saveAiSettings(partial: Partial<AiSettings>, deps: AiSettingsFsDeps): AiSettings {
  const current = loadAiSettings(deps);
  const merged = sanitizeSettings({
    ...current,
    ...partial,
    models: { ...current.models, ...(partial.models ?? {}) },
    baseUrls: { ...current.baseUrls, ...(partial.baseUrls ?? {}) },
  });
  deps.mkdir(deps.userDataDir);
  deps.writeFile(deps.joinPath(deps.userDataDir, AI_SETTINGS_FILENAME), JSON.stringify(merged, null, 2));
  return merged;
}

export function hasAiKey(provider: AiProviderId, secretDeps: SecretStoreDeps): boolean {
  try {
    return Boolean(getSecret(aiKeyCoordinate(provider), secretDeps));
  } catch {
    return false;
  }
}

/** @throws SecretEncryptionUnavailableError when OS keychain encryption is unavailable. */
export function setAiKey(provider: AiProviderId, apiKey: string, secretDeps: SecretStoreDeps): void {
  const trimmed = apiKey.trim();
  if (!trimmed) {
    throw new Error('API key must not be empty.');
  }
  setSecret(aiKeyCoordinate(provider), trimmed, secretDeps);
}

export function clearAiKey(provider: AiProviderId, secretDeps: SecretStoreDeps): boolean {
  return deleteSecret(aiKeyCoordinate(provider), secretDeps);
}

/** Main-process only: reads the plaintext key. Never expose this over IPC. */
export function readAiKey(provider: AiProviderId, secretDeps: SecretStoreDeps): string | null {
  try {
    return getSecret(aiKeyCoordinate(provider), secretDeps);
  } catch {
    return null;
  }
}
