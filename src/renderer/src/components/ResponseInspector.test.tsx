import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ResponseInspector } from './ResponseInspector';
import type { HttpResponseResult } from '../../../shared/httpTypes';

const mockResponse: HttpResponseResult = {
  requestId: 'req_1',
  ok: true,
  finalUrl: 'https://api.example.com/v1/items',
  method: 'GET',
  status: 200,
  statusText: 'OK',
  httpVersion: '1.1',
  remoteAddress: '93.184.216.34:443',
  headers: {
    'content-type': 'application/json',
    'x-request-id': 'abc-123',
  },
  rawHeaders: [
    { key: 'Content-Type', value: 'application/json' },
    { key: 'X-Request-Id', value: 'abc-123' },
  ],
  cookies: [
    {
      name: 'sid',
      value: 'xyz987',
      domain: 'example.com',
      path: '/',
      httpOnly: true,
      secure: true,
      raw: 'sid=xyz987; Path=/; HttpOnly; Secure',
    },
  ],
  body: JSON.stringify({
    data: {
      items: [
        { id: 1, name: 'Widget' },
        { id: 2, name: 'Gadget' },
      ],
    },
  }),
  isBinary: false,
  contentType: 'application/json',
  sizeBytes: 128,
  transferSizeBytes: 128,
  timings: {
    dnsMs: 4,
    tcpMs: 8,
    tlsMs: 12,
    ttfbMs: 35,
    downloadMs: 5,
    totalMs: 64,
  },
  tls: {
    subject: 'CN=api.example.com',
    issuer: "CN=Let's Encrypt",
    validFrom: 'Jan 1 2026',
    validTo: 'Dec 31 2026',
    protocol: 'TLSv1.3',
    cipher: 'TLS_AES_256_GCM_SHA384',
  },
  redirects: [],
  captures: [],
  assertions: [
    {
      rule: { target: 'status', operator: 'equals', expected: 200 },
      passed: true,
      actual: 200,
      message: 'status equals 200 (actual: 200)',
    },
    {
      rule: { target: 'responseTime', operator: 'lessThan', expected: 50 },
      passed: false,
      actual: 64,
      message: 'responseTime lessThan 50 (actual: 64)',
    },
  ],
  sentHeaders: {},
};

const previousResponse: HttpResponseResult = {
  ...mockResponse,
  requestId: 'req_0',
  body: JSON.stringify({
    data: {
      items: [{ id: 1, name: 'OldWidget' }],
    },
  }),
};

describe('ResponseInspector', () => {
  it('displays status badge, phase timing breakdown popover, live JSONPath filter, and Side-by-Side Diff view', () => {
    render(<ResponseInspector response={mockResponse} previousResponse={previousResponse} />);

    expect(screen.getByTestId('response-status-badge')).toHaveTextContent('200 OK');
    expect(screen.getByTestId('response-timing-badge')).toHaveTextContent('64 ms');
    expect(screen.getByTestId('response-size-badge')).toHaveTextContent('128 B');

    // Open timing breakdown popover
    fireEvent.click(screen.getByTestId('response-timing-badge'));
    expect(screen.getByTestId('timing-breakdown-popover')).toBeInTheDocument();
    expect(screen.getByTestId('timing-dns')).toHaveTextContent('4 ms');
    expect(screen.getByTestId('timing-ttfb')).toHaveTextContent('35 ms');

    // Filter body with JSONPath
    fireEvent.change(screen.getByTestId('response-jsonpath-input'), {
      target: { value: '$.data.items[*].name' },
    });
    expect(screen.getByTestId('response-body-content')).toHaveTextContent('Widget');
    expect(screen.getByTestId('response-body-content')).toHaveTextContent('Gadget');

    // Switch to Diff mode
    fireEvent.click(screen.getByTestId('resp-body-mode-diff'));
    expect(screen.getByTestId('response-diff-view')).toBeInTheDocument();
    expect(screen.getByTestId('diff-original-content')).toHaveTextContent('OldWidget');
  });

  it('switches across Headers, Cookies, Tests (Pass/Fail summary), and Network/TLS tabs', () => {
    render(<ResponseInspector response={mockResponse} />);

    // Headers tab
    fireEvent.click(screen.getByTestId('resp-tab-headers'));
    expect(screen.getByTestId('response-header-row-x-request-id')).toHaveTextContent('abc-123');

    // Cookies tab
    fireEvent.click(screen.getByTestId('resp-tab-cookies'));
    expect(screen.getByTestId('response-cookie-row-sid')).toHaveTextContent('xyz987');

    // Tests tab
    fireEvent.click(screen.getByTestId('resp-tab-tests'));
    expect(screen.getByTestId('response-tests-summary')).toHaveTextContent('1 passed, 1 failed');
    expect(screen.getByTestId('response-assertion-result-0')).toHaveAttribute(
      'data-passed',
      'true',
    );
    expect(screen.getByTestId('response-assertion-result-1')).toHaveAttribute(
      'data-passed',
      'false',
    );

    // Network / TLS tab
    fireEvent.click(screen.getByTestId('resp-tab-network'));
    expect(screen.getByTestId('response-tls-details')).toHaveTextContent('TLSv1.3');
  });
});
