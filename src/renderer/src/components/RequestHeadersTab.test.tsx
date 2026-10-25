import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { RequestHeadersTab, STANDARD_HTTP_HEADERS } from './RequestHeadersTab';

describe('RequestHeadersTab', () => {
  it('renders request headers with standard header autocomplete and toggles inherited headers', () => {
    const onChange = vi.fn();

    render(
      <RequestHeadersTab
        headers={[{ key: 'Content-Type', value: 'application/json', enabled: true }]}
        inheritedHeaders={[
          {
            key: 'Accept',
            value: 'application/json',
            enabled: true,
            sourceName: 'Collection Defaults',
          },
          {
            key: 'X-Org-ID',
            value: '{{orgId}}',
            enabled: true,
            sourceName: 'Folder: Admin',
          },
        ]}
        onChange={onChange}
      />,
    );

    expect(STANDARD_HTTP_HEADERS).toContain('Authorization');
    expect(screen.getByTestId('request-headers-key-0')).toHaveValue('Content-Type');

    // Expand inherited headers
    const toggleBtn = screen.getByTestId('toggle-inherited-headers-btn');
    expect(toggleBtn).toHaveTextContent('Inherited Headers (2)');
    fireEvent.click(toggleBtn);

    expect(screen.getByTestId('inherited-headers-table')).toBeInTheDocument();
    expect(screen.getByTestId('inherited-header-row-0')).toHaveTextContent('Accept');
    expect(screen.getByTestId('inherited-header-row-1')).toHaveTextContent('Folder: Admin');
  });
});
