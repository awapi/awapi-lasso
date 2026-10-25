import React from 'react';
import type { AuthConfig, AuthProfile, AuthType } from '../../../shared/collectionSchema';
import type { VariableInterpolationContext } from '../../../shared/interpolation';
import { OAuth2ConfigPanel } from './OAuth2ConfigPanel';
import { useTheme } from '../context/ThemeContext';

export interface RequestAuthTabProps {
  auth: AuthConfig;
  authProfiles?: AuthProfile[];
  interpolationContext?: VariableInterpolationContext;
  onChange: (auth: AuthConfig) => void;
}

export const RequestAuthTab: React.FC<RequestAuthTabProps> = ({
  auth,
  authProfiles = [],
  interpolationContext,
  onChange,
}) => {
  const { colors } = useTheme();

  const handleTypeChange = (nextType: AuthType) => {
    const next: AuthConfig = { ...auth, type: nextType };
    if (nextType === 'bearer' && !next.bearer) {
      next.bearer = { token: '', prefix: 'Bearer' };
    } else if (nextType === 'basic' && !next.basic) {
      next.basic = { username: '', password: '' };
    } else if (nextType === 'apikey' && !next.apikey) {
      next.apikey = { key: 'X-API-Key', value: '', in: 'header' };
    } else if (nextType === 'digest' && !next.digest) {
      next.digest = { username: '', password: '', realm: '' };
    } else if (nextType === 'awsv4' && !next.awsv4) {
      next.awsv4 = { accessKeyId: '', secretAccessKey: '', region: 'us-east-1', service: 'execute-api' };
    } else if (nextType === 'oauth2' && !next.oauth2) {
      next.oauth2 = {
        grantType: 'client_credentials',
        accessTokenUrl: '',
        clientId: '',
        clientSecret: '',
        scope: '',
        clientAuthMethod: 'basic_header',
      };
    }
    onChange(next);
  };

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
      data-testid="request-auth-tab"
      style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
    >
      {/* Auth Type Selector */}
      <div style={{ maxWidth: 320 }}>
        <label style={labelStyle}>Authentication Type</label>
        <select
          aria-label="Authentication Type"
          data-testid="auth-type-select"
          value={auth.type}
          onChange={e => handleTypeChange(e.target.value as AuthType)}
          style={inputStyle}
        >
          <option value="inherit">Inherit auth from parent</option>
          <option value="none">No Auth</option>
          <option value="profile">Reusable Auth Profile</option>
          <option value="bearer">Bearer Token</option>
          <option value="basic">Basic Auth</option>
          <option value="apikey">API Key</option>
          <option value="digest">Digest Auth</option>
          <option value="awsv4">AWS Signature v4</option>
          <option value="oauth2">OAuth 2.0</option>
        </select>
      </div>

      {auth.type === 'inherit' && (
        <div
          data-testid="auth-inherit-msg"
          style={{ fontSize: 12, color: colors.textSecondary }}
        >
          This request inherits authentication settings from its parent Folder or Collection
          defaults.
        </div>
      )}

      {auth.type === 'none' && (
        <div data-testid="auth-none-msg" style={{ fontSize: 12, color: colors.textSecondary }}>
          This request does not use authentication.
        </div>
      )}

      {auth.type === 'profile' && (
        <div style={{ maxWidth: 360 }}>
          <label style={labelStyle}>Auth Profile</label>
          <select
            aria-label="Auth Profile"
            data-testid="auth-profile-select"
            value={auth.profileId ?? ''}
            onChange={e => onChange({ ...auth, profileId: e.target.value })}
            style={inputStyle}
          >
            <option value="">Select an Auth Profile...</option>
            {authProfiles.map(prof => (
              <option key={prof.id} value={prof.id}>
                {prof.name} ({prof.type})
              </option>
            ))}
          </select>
        </div>
      )}

      {auth.type === 'bearer' && (
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
          <div>
            <label style={labelStyle}>Token</label>
            <input
              type="text"
              aria-label="Bearer Token"
              data-testid="auth-bearer-token-input"
              value={auth.bearer?.token ?? ''}
              placeholder="{{accessToken}}"
              onChange={e =>
                onChange({
                  ...auth,
                  bearer: {
                    ...auth.bearer,
                    token: e.target.value,
                  },
                })
              }
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Header Prefix</label>
            <input
              type="text"
              aria-label="Bearer Prefix"
              data-testid="auth-bearer-prefix-input"
              value={auth.bearer?.prefix ?? 'Bearer'}
              onChange={e =>
                onChange({
                  ...auth,
                  bearer: {
                    token: auth.bearer?.token ?? '',
                    ...auth.bearer,
                    prefix: e.target.value,
                  },
                })
              }
              style={inputStyle}
            />
          </div>
        </div>
      )}

      {auth.type === 'basic' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={labelStyle}>Username</label>
            <input
              type="text"
              aria-label="Basic Auth Username"
              data-testid="auth-basic-username-input"
              value={auth.basic?.username ?? ''}
              placeholder="{{username}}"
              onChange={e =>
                onChange({
                  ...auth,
                  basic: { ...auth.basic, username: e.target.value },
                })
              }
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Password</label>
            <input
              type="password"
              aria-label="Basic Auth Password"
              data-testid="auth-basic-password-input"
              value={auth.basic?.password ?? ''}
              placeholder="{{password}}"
              onChange={e =>
                onChange({
                  ...auth,
                  basic: {
                    username: auth.basic?.username ?? '',
                    ...auth.basic,
                    password: e.target.value,
                  },
                })
              }
              style={inputStyle}
            />
          </div>
        </div>
      )}

      {auth.type === 'apikey' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <div>
            <label style={labelStyle}>Key</label>
            <input
              type="text"
              aria-label="API Key Name"
              data-testid="auth-apikey-key-input"
              value={auth.apikey?.key ?? ''}
              onChange={e =>
                onChange({
                  ...auth,
                  apikey: {
                    in: auth.apikey?.in ?? 'header',
                    ...auth.apikey,
                    key: e.target.value,
                  },
                })
              }
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Value</label>
            <input
              type="password"
              aria-label="API Key Value"
              data-testid="auth-apikey-value-input"
              value={auth.apikey?.value ?? ''}
              onChange={e =>
                onChange({
                  ...auth,
                  apikey: {
                    key: auth.apikey?.key ?? '',
                    in: auth.apikey?.in ?? 'header',
                    ...auth.apikey,
                    value: e.target.value,
                  },
                })
              }
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Add To</label>
            <select
              aria-label="API Key Location"
              data-testid="auth-apikey-in-select"
              value={auth.apikey?.in ?? 'header'}
              onChange={e =>
                onChange({
                  ...auth,
                  apikey: {
                    key: auth.apikey?.key ?? '',
                    ...auth.apikey,
                    in: e.target.value as 'header' | 'query',
                  },
                })
              }
              style={inputStyle}
            >
              <option value="header">Header</option>
              <option value="query">Query Params</option>
            </select>
          </div>
        </div>
      )}

      {auth.type === 'digest' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <div>
            <label style={labelStyle}>Username</label>
            <input
              type="text"
              data-testid="auth-digest-username-input"
              value={auth.digest?.username ?? ''}
              onChange={e =>
                onChange({
                  ...auth,
                  digest: { ...auth.digest, username: e.target.value },
                })
              }
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Password</label>
            <input
              type="password"
              data-testid="auth-digest-password-input"
              value={auth.digest?.password ?? ''}
              onChange={e =>
                onChange({
                  ...auth,
                  digest: {
                    username: auth.digest?.username ?? '',
                    ...auth.digest,
                    password: e.target.value,
                  },
                })
              }
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Realm</label>
            <input
              type="text"
              data-testid="auth-digest-realm-input"
              value={auth.digest?.realm ?? ''}
              onChange={e =>
                onChange({
                  ...auth,
                  digest: {
                    username: auth.digest?.username ?? '',
                    ...auth.digest,
                    realm: e.target.value,
                  },
                })
              }
              style={inputStyle}
            />
          </div>
        </div>
      )}

      {auth.type === 'awsv4' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={labelStyle}>Access Key ID</label>
            <input
              type="text"
              data-testid="auth-awsv4-access-key-input"
              value={auth.awsv4?.accessKeyId ?? ''}
              onChange={e =>
                onChange({
                  ...auth,
                  awsv4: {
                    region: auth.awsv4?.region ?? 'us-east-1',
                    service: auth.awsv4?.service ?? 'execute-api',
                    ...auth.awsv4,
                    accessKeyId: e.target.value,
                  },
                })
              }
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Secret Access Key</label>
            <input
              type="password"
              data-testid="auth-awsv4-secret-key-input"
              value={auth.awsv4?.secretAccessKey ?? ''}
              onChange={e =>
                onChange({
                  ...auth,
                  awsv4: {
                    accessKeyId: auth.awsv4?.accessKeyId ?? '',
                    region: auth.awsv4?.region ?? 'us-east-1',
                    service: auth.awsv4?.service ?? 'execute-api',
                    ...auth.awsv4,
                    secretAccessKey: e.target.value,
                  },
                })
              }
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>AWS Region</label>
            <input
              type="text"
              data-testid="auth-awsv4-region-input"
              value={auth.awsv4?.region ?? 'us-east-1'}
              onChange={e =>
                onChange({
                  ...auth,
                  awsv4: {
                    accessKeyId: auth.awsv4?.accessKeyId ?? '',
                    service: auth.awsv4?.service ?? 'execute-api',
                    ...auth.awsv4,
                    region: e.target.value,
                  },
                })
              }
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Service Name</label>
            <input
              type="text"
              data-testid="auth-awsv4-service-input"
              value={auth.awsv4?.service ?? 'execute-api'}
              onChange={e =>
                onChange({
                  ...auth,
                  awsv4: {
                    accessKeyId: auth.awsv4?.accessKeyId ?? '',
                    region: auth.awsv4?.region ?? 'us-east-1',
                    ...auth.awsv4,
                    service: e.target.value,
                  },
                })
              }
              style={inputStyle}
            />
          </div>
        </div>
      )}

      {auth.type === 'oauth2' && auth.oauth2 && (
        <OAuth2ConfigPanel
          config={auth.oauth2}
          onChange={oauth2 => onChange({ ...auth, oauth2 })}
          interpolationContext={interpolationContext}
        />
      )}
    </div>
  );
};
