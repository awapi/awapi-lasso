import React, { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { RequestAuthTab } from './RequestAuthTab';
import type { AuthConfig } from '../../../shared/collectionSchema';

const StatefulAuthTab: React.FC = () => {
  const [auth, setAuth] = useState<AuthConfig>({ type: 'inherit' });
  return (
    <RequestAuthTab
      auth={auth}
      authProfiles={[
        {
          id: 'prof_1',
          name: 'Prod OAuth2',
          type: 'oauth2',
        },
      ]}
      onChange={setAuth}
    />
  );
};

describe('RequestAuthTab', () => {
  it('switches across Inherit, Bearer, Basic, API Key, AWS SigV4, Auth Profile, and OAuth 2.0', () => {
    render(<StatefulAuthTab />);

    expect(screen.getByTestId('auth-inherit-msg')).toBeInTheDocument();

    const select = screen.getByTestId('auth-type-select');

    // Bearer
    fireEvent.change(select, { target: { value: 'bearer' } });
    fireEvent.change(screen.getByTestId('auth-bearer-token-input'), {
      target: { value: '{{jwtToken}}' },
    });
    expect(screen.getByTestId('auth-bearer-token-input')).toHaveValue('{{jwtToken}}');

    // Basic Auth
    fireEvent.change(select, { target: { value: 'basic' } });
    fireEvent.change(screen.getByTestId('auth-basic-username-input'), {
      target: { value: 'admin' },
    });
    expect(screen.getByTestId('auth-basic-username-input')).toHaveValue('admin');

    // API Key
    fireEvent.change(select, { target: { value: 'apikey' } });
    expect(screen.getByTestId('auth-apikey-key-input')).toHaveValue('X-API-Key');

    // AWS SigV4
    fireEvent.change(select, { target: { value: 'awsv4' } });
    expect(screen.getByTestId('auth-awsv4-region-input')).toHaveValue('us-east-1');

    // OAuth 2.0
    fireEvent.change(select, { target: { value: 'oauth2' } });
    expect(screen.getByTestId('oauth2-config-panel')).toBeInTheDocument();
  });
});
