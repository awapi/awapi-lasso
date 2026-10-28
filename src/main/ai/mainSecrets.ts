import { listCachedOAuth2TokenValues } from '../oauth2Engine';
import { listVaultSecretValues, type SecretStoreDeps } from '../secretStore';

const TOKEN_FIELDS = ['accessToken', 'refreshToken', 'idToken'] as const;

/** Stored OAuth 2.0 token records are JSON; scrub their token fields as well as the whole string. */
function tokenFieldsOf(value: string): string[] {
  if (!value.startsWith('{')) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object') return [];
    const record = parsed as Record<string, unknown>;
    return TOKEN_FIELDS.map(f => record[f]).filter((v): v is string => typeof v === 'string' && v !== '');
  } catch {
    return [];
  }
}

/**
 * Secrets known only to the Main process (keychain vault values, cached OAuth 2.0 tokens) so the AI
 * service can scrub them from everything it sends. Never throws: a broken vault just yields fewer values.
 */
export function collectMainSecretValues(secretDeps: SecretStoreDeps): string[] {
  const values = new Set<string>(listCachedOAuth2TokenValues());
  try {
    for (const value of listVaultSecretValues(secretDeps)) {
      values.add(value);
      for (const field of tokenFieldsOf(value)) values.add(field);
    }
  } catch {
    // vault unreadable; keep what we have
  }
  return [...values];
}
