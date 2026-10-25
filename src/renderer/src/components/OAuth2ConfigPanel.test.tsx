import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { OAuth2ConfigPanel } from './OAuth2ConfigPanel';
import type { OAuth2Config } from '../../../shared/collectionSchema';

function buildSampleJwt(payload: Record<string, unknown>): string {
  const headerB64 = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payloadB64 = btoa(JSON.stringify(payload));
  return `${headerB64}.${payloadB64}.sig123`;
}

const StatefulOAuthPanel: React.FC = () => {
  const [cfg, setCfg] = useState<OAuth2Config>({
    grantType: 'password',
    accessTokenUrl: 'https://auth.example.com/oauth/token',
    clientId: 'my-client',
    clientSecret: 'my-secret',
    username: 'alice',
    password: 'pw',
    scope: 'read:orders',
    clientAuthMethod: 'basic_header',
    extraParams: [],
  });
  return <OAuth2ConfigPanel config={cfg} onChange={setCfg} />;
};

describe('OAuth2ConfigPanel', () => {
  beforeEach(() => {
    const sampleJwt = buildSampleJwt({
      sub: 'user_alice',
      iss: 'https://auth.example.com',
      scp: ['read:orders'],
    });
    window.electronAPI = {
      ...window.electronAPI,
      getOAuth2Token: vi.fn().mockResolvedValue({
        ok: true,
        token: {
          accessToken: sampleJwt,
          tokenType: 'Bearer',
          expiresIn: 3600,
          acquiredAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
          rawResponse: { access_token: sampleJwt },
        },
      }),
      getCachedOAuth2Token: vi.fn().mockResolvedValue(null),
      clearOAuth2Token: vi.fn().mockResolvedValue(true),
    } as unknown as Window['electronAPI'];
  });

  it('switches grant types, acquires a new token via electronAPI, and displays decoded JWT Header & Claims', async () => {
    render(<StatefulOAuthPanel />);

    expect(screen.getByTestId('oauth2-username-input')).toHaveValue('alice');

    // Switch grant type to client_credentials -> username field disappears
    fireEvent.change(screen.getByTestId('oauth2-grant-type-select'), {
      target: { value: 'client_credentials' },
    });
    expect(screen.queryByTestId('oauth2-username-input')).not.toBeInTheDocument();

    // Click "Get New Token"
    fireEvent.click(screen.getByTestId('oauth2-get-token-btn'));

    await waitFor(() => {
      expect(window.electronAPI.getOAuth2Token).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('oauth2-active-token-card')).toBeInTheDocument();
    });

    expect(screen.getByTestId('oauth2-token-expiry-countdown')).toHaveTextContent(/Expires in/);
    expect(screen.getByTestId('oauth2-jwt-header-json')).toHaveTextContent('"alg": "RS256"');
    expect(screen.getByTestId('oauth2-jwt-claims-json')).toHaveTextContent('"sub": "user_alice"');
  });
});
