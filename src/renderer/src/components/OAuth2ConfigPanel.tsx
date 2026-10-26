import React, { useEffect, useState } from 'react';
import { KeyRound, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import type {
  OAuth2ClientAuthMethod,
  OAuth2Config,
  OAuth2GrantType,
} from '../../../shared/collectionSchema';
import type {
  DecodedJwtToken,
  OAuth2TokenCoordinate,
  OAuth2TokenRecord,
} from '../../../shared/oauth2Types';
import type { VariableInterpolationContext } from '../../../shared/interpolation';
import { KeyValueTable } from './KeyValueTable';
import { useTheme } from '../context/ThemeContext';

export interface OAuth2ConfigPanelProps {
  config: OAuth2Config;
  onChange: (config: OAuth2Config) => void;
  coordinate?: OAuth2TokenCoordinate;
  interpolationContext?: VariableInterpolationContext;
}

function decodeBase64UrlBrowser(segment: string): string {
  const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + '='.repeat(padLen);
  return atob(padded);
}

/**
 * Pure renderer helper to decode a JWT into header & payload claims if `decodedJwt` is not already populated.
 */
export function decodeJwtClaimsInRenderer(token: string): DecodedJwtToken {
  const trimmed = (token || '').trim().replace(/^Bearer\s+/i, '');
  const parts = trimmed.split('.');
  if (parts.length !== 3) {
    return { isJwt: false, header: null, payload: null, error: 'Not a 3-part JWT' };
  }
  try {
    const header = JSON.parse(decodeBase64UrlBrowser(parts[0])) as Record<string, unknown>;
    const payload = JSON.parse(decodeBase64UrlBrowser(parts[1])) as Record<string, unknown>;
    return {
      isJwt: true,
      header,
      payload,
      signature: parts[2],
    };
  } catch (err) {
    return {
      isJwt: false,
      header: null,
      payload: null,
      error: err instanceof Error ? err.message : 'Invalid JWT',
    };
  }
}

export function formatTokenRemainingSeconds(expiresAt?: string, nowMs = Date.now()): string {
  if (!expiresAt) return 'No expiry specified';
  const expMs = Date.parse(expiresAt);
  if (Number.isNaN(expMs)) return 'Unknown expiry';
  const diffSec = Math.floor((expMs - nowMs) / 1000);
  if (diffSec <= 0) return `Expired (${Math.abs(diffSec)}s ago)`;
  const mins = Math.floor(diffSec / 60);
  const secs = diffSec % 60;
  return mins > 0 ? `Expires in ${mins}m ${secs}s` : `Expires in ${secs}s`;
}

export const OAuth2ConfigPanel: React.FC<OAuth2ConfigPanelProps> = ({
  config,
  onChange,
  coordinate,
  interpolationContext,
}) => {
  const { colors } = useTheme();
  const [tokenRecord, setTokenRecord] = useState<OAuth2TokenRecord | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [isLoadingToken, setIsLoadingToken] = useState<boolean>(false);

  useEffect(() => {
    if (!coordinate || !window.electronAPI?.getCachedOAuth2Token) return;
    let mounted = true;
    void window.electronAPI.getCachedOAuth2Token(coordinate).then(cached => {
      if (mounted && cached) {
        setTokenRecord(cached);
      }
    });
    return () => {
      mounted = false;
    };
  }, [coordinate]);

  const updateField = <K extends keyof OAuth2Config>(key: K, value: OAuth2Config[K]) => {
    onChange({
      ...config,
      [key]: value,
    });
  };

  const handleGetNewToken = async () => {
    if (!window.electronAPI?.getOAuth2Token) return;
    setIsLoadingToken(true);
    setStatusError(null);
    try {
      const res = await window.electronAPI.getOAuth2Token({
        config,
        coordinate,
        interpolationContext,
        forceRefresh: true,
      });
      if (res.ok && res.token) {
        setTokenRecord(res.token);
      } else {
        setStatusError(res.error || 'Failed to acquire OAuth 2.0 token');
      }
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : 'Token exchange error');
    } finally {
      setIsLoadingToken(false);
    }
  };

  const handleRefreshToken = async () => {
    if (!window.electronAPI?.refreshOAuth2Token) return;
    setIsLoadingToken(true);
    setStatusError(null);
    try {
      const res = await window.electronAPI.refreshOAuth2Token({
        config,
        refreshToken: tokenRecord?.refreshToken ?? config.refreshToken,
        coordinate,
        interpolationContext,
      });
      if (res.ok && res.token) {
        setTokenRecord(res.token);
      } else {
        setStatusError(res.error || 'Failed to refresh OAuth 2.0 token');
      }
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : 'Refresh error');
    } finally {
      setIsLoadingToken(false);
    }
  };

  const handleClearToken = async () => {
    if (coordinate && window.electronAPI?.clearOAuth2Token) {
      await window.electronAPI.clearOAuth2Token(coordinate);
    }
    setTokenRecord(null);
  };

  const decodedJwt: DecodedJwtToken | null = tokenRecord
    ? (tokenRecord.decodedJwt ?? decodeJwtClaimsInRenderer(tokenRecord.accessToken))
    : null;

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '6px 10px',
    borderRadius: 6,
    border: `1px solid ${colors.border}`,
    backgroundColor: colors.bgPrimary,
    color: colors.textPrimary,
    fontSize: 12,
    fontFamily: 'monospace',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    color: colors.textSecondary,
    marginBottom: 4,
    display: 'block',
  };

  return (
    <div
      data-testid="oauth2-config-panel"
      style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
    >
      {/* Grant Type & Client Auth Method */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label style={labelStyle}>Grant Type</label>
          <select
            aria-label="OAuth 2.0 Grant Type"
            data-testid="oauth2-grant-type-select"
            value={config.grantType}
            onChange={e => updateField('grantType', e.target.value as OAuth2GrantType)}
            style={inputStyle}
          >
            <option value="password">Password Credentials (password)</option>
            <option value="client_credentials">Client Credentials (client_credentials)</option>
            <option value="authorization_code_pkce">
              Authorization Code + PKCE (authorization_code_pkce)
            </option>
            <option value="authorization_code">Authorization Code (authorization_code)</option>
            <option value="refresh_token">Refresh Token (refresh_token)</option>
          </select>
        </div>

        <div>
          <label style={labelStyle}>Client Authentication Method</label>
          <select
            aria-label="Client Auth Method"
            data-testid="oauth2-client-auth-select"
            value={config.clientAuthMethod ?? 'basic_header'}
            onChange={e => updateField('clientAuthMethod', e.target.value as OAuth2ClientAuthMethod)}
            style={inputStyle}
          >
            <option value="basic_header">Send as Basic Auth Header (basic_header)</option>
            <option value="request_body">Send Credentials in Body (request_body)</option>
          </select>
        </div>
      </div>

      {/* Access Token URL & Authorization URL */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label style={labelStyle}>Access Token URL</label>
          <input
            type="text"
            aria-label="Access Token URL"
            data-testid="oauth2-token-url-input"
            value={config.accessTokenUrl}
            placeholder="https://auth.example.com/oauth/token"
            onChange={e => updateField('accessTokenUrl', e.target.value)}
            style={inputStyle}
          />
        </div>

        {(config.grantType === 'authorization_code' ||
          config.grantType === 'authorization_code_pkce') && (
          <div>
            <label style={labelStyle}>Authorization URL</label>
            <input
              type="text"
              aria-label="Authorization URL"
              data-testid="oauth2-auth-url-input"
              value={config.authorizationUrl ?? ''}
              placeholder="https://auth.example.com/oauth/authorize"
              onChange={e => updateField('authorizationUrl', e.target.value)}
              style={inputStyle}
            />
          </div>
        )}
      </div>

      {/* Client ID, Client Secret, Scope */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <div>
          <label style={labelStyle}>Client ID</label>
          <input
            type="text"
            aria-label="Client ID"
            data-testid="oauth2-client-id-input"
            value={config.clientId}
            placeholder="{{clientId}}"
            onChange={e => updateField('clientId', e.target.value)}
            style={inputStyle}
          />
        </div>

        <div>
          <label style={labelStyle}>Client Secret</label>
          <input
            type="password"
            aria-label="Client Secret"
            data-testid="oauth2-client-secret-input"
            value={config.clientSecret ?? ''}
            placeholder="{{clientSecret}}"
            onChange={e => updateField('clientSecret', e.target.value)}
            style={inputStyle}
          />
        </div>

        <div>
          <label style={labelStyle}>Scope</label>
          <input
            type="text"
            aria-label="OAuth Scope"
            data-testid="oauth2-scope-input"
            value={config.scope ?? ''}
            placeholder="openid profile api:read"
            onChange={e => updateField('scope', e.target.value)}
            style={inputStyle}
          />
        </div>
      </div>

      {/* Password Grant Fields */}
      {config.grantType === 'password' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={labelStyle}>Username</label>
            <input
              type="text"
              aria-label="OAuth Username"
              data-testid="oauth2-username-input"
              value={config.username ?? ''}
              placeholder="{{username}}"
              onChange={e => updateField('username', e.target.value)}
              style={inputStyle}
            />
          </div>

          <div>
            <label style={labelStyle}>Password</label>
            <input
              type="password"
              aria-label="OAuth Password"
              data-testid="oauth2-password-input"
              value={config.password ?? ''}
              placeholder="{{password}}"
              onChange={e => updateField('password', e.target.value)}
              style={inputStyle}
            />
          </div>
        </div>
      )}

      {/* Refresh Token Grant Field */}
      {config.grantType === 'refresh_token' && (
        <div>
          <label style={labelStyle}>Refresh Token</label>
          <input
            type="password"
            aria-label="OAuth Refresh Token"
            data-testid="oauth2-refresh-token-input"
            value={config.refreshToken ?? ''}
            placeholder="{{refreshToken}}"
            onChange={e => updateField('refreshToken', e.target.value)}
            style={inputStyle}
          />
        </div>
      )}

      {/* Extra Token Request Parameters */}
      <div>
        <label style={labelStyle}>Extra Token Parameters (e.g. audience, resource, tenant)</label>
        <KeyValueTable
          entries={config.extraParams ?? []}
          onChange={extraParams => updateField('extraParams', extraParams)}
          keyPlaceholder="Param Name"
          valuePlaceholder="Param Value"
          showBulkEdit={false}
          testIdPrefix="oauth2-extra-params"
        />
      </div>

      {/* Token Action Buttons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          data-testid="oauth2-get-token-btn"
          disabled={isLoadingToken}
          onClick={() => void handleGetNewToken()}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '7px 14px',
            borderRadius: 6,
            border: 'none',
            backgroundColor: colors.accent,
            color: '#ffffff',
            fontWeight: 600,
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          <KeyRound size={13} />
          {isLoadingToken ? 'Requesting Token...' : 'Get New Token'}
        </button>

        {tokenRecord && (
          <>
            <button
              type="button"
              data-testid="oauth2-refresh-token-btn"
              onClick={() => void handleRefreshToken()}
              title="Refresh Token"
              aria-label="Refresh Token"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: 7,
                borderRadius: 6,
                border: `1px solid ${colors.border}`,
                backgroundColor: colors.bgSecondary,
                color: colors.textPrimary,
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              <RefreshCw size={12} />
            </button>

            <button
              type="button"
              data-testid="oauth2-clear-token-btn"
              onClick={() => void handleClearToken()}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '7px 12px',
                borderRadius: 6,
                border: `1px solid ${colors.border}`,
                backgroundColor: colors.bgSecondary,
                color: colors.danger,
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              <Trash2 size={12} />
              Clear Token
            </button>
          </>
        )}
      </div>

      {statusError && (
        <div
          data-testid="oauth2-error-banner"
          style={{
            padding: '8px 12px',
            borderRadius: 6,
            backgroundColor: '#7f1d1d33',
            border: `1px solid ${colors.danger}`,
            color: colors.danger,
            fontSize: 12,
          }}
        >
          {statusError}
        </div>
      )}

      {/* Active Token Summary & Decoded JWT Inspector */}
      {tokenRecord && (
        <div
          data-testid="oauth2-active-token-card"
          style={{
            borderRadius: 8,
            border: `1px solid ${colors.border}`,
            backgroundColor: colors.bgSecondary,
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 12,
                fontWeight: 700,
                color: colors.success,
              }}
            >
              <ShieldCheck size={14} />
              Active Token ({tokenRecord.tokenType || 'Bearer'})
            </span>

            <span
              data-testid="oauth2-token-expiry-countdown"
              style={{
                fontSize: 11,
                fontFamily: 'monospace',
                padding: '2px 8px',
                borderRadius: 999,
                backgroundColor: colors.bgPrimary,
                color: colors.textSecondary,
              }}
            >
              {formatTokenRemainingSeconds(tokenRecord.expiresAt)}
            </span>
          </div>

          {decodedJwt?.isJwt && (
            <div
              data-testid="oauth2-jwt-inspector"
              style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}
            >
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 4 }}>JWT Header</div>
                <pre
                  data-testid="oauth2-jwt-header-json"
                  style={{
                    margin: 0,
                    padding: 8,
                    borderRadius: 6,
                    backgroundColor: colors.bgPrimary,
                    fontSize: 11,
                    overflowX: 'auto',
                  }}
                >
                  {JSON.stringify(decodedJwt.header, null, 2)}
                </pre>
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 4 }}>
                  JWT Claims (Payload)
                </div>
                <pre
                  data-testid="oauth2-jwt-claims-json"
                  style={{
                    margin: 0,
                    padding: 8,
                    borderRadius: 6,
                    backgroundColor: colors.bgPrimary,
                    fontSize: 11,
                    overflowX: 'auto',
                  }}
                >
                  {JSON.stringify(decodedJwt.payload, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
