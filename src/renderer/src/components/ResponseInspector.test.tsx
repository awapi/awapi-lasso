import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
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
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('keeps the same pin toggle highlighted across responses and unpins when clicked', () => {
    const onPinResponse = vi.fn();
    const { rerender } = render(
      <ResponseInspector response={previousResponse} onPinResponse={onPinResponse} />,
    );
    fireEvent.click(screen.getByTestId('pin-response-btn'));
    expect(onPinResponse).toHaveBeenCalledWith(previousResponse);
    const unpinnedBorder = screen.getByTestId('pin-response-btn').style.border;

    rerender(
      <ResponseInspector response={previousResponse} pinnedResponse={previousResponse} onPinResponse={onPinResponse} />,
    );
    expect(screen.getByTestId('pin-response-btn')).toHaveTextContent('Pinned');
    expect(screen.getByTestId('pin-response-btn')).toBeEnabled();
    expect(screen.getByTestId('pin-response-btn')).toHaveAttribute('aria-pressed', 'true');
    const pinnedBorder = screen.getByTestId('pin-response-btn').style.border;
    expect(pinnedBorder).not.toBe(unpinnedBorder);
    expect(screen.getByRole('status')).toHaveTextContent('Send another request');

    rerender(
      <ResponseInspector response={mockResponse} previousResponse={mockResponse} pinnedResponse={previousResponse} onPinResponse={onPinResponse} />,
    );
    expect(screen.getByTestId('pin-response-btn')).toHaveTextContent('Pinned');
    expect(screen.getByTestId('pin-response-btn')).toHaveStyle({ border: pinnedBorder });
    fireEvent.click(screen.getByTestId('resp-body-mode-diff'));
    expect(screen.getByTestId('diff-original-content')).toHaveTextContent('OldWidget');
    expect(screen.getByTestId('diff-modified-content')).toHaveTextContent('Gadget');
    fireEvent.click(screen.getByTestId('pin-response-btn'));
    expect(onPinResponse).toHaveBeenLastCalledWith(null);
    rerender(
      <ResponseInspector response={mockResponse} previousResponse={mockResponse} pinnedResponse={null} onPinResponse={onPinResponse} />,
    );
    expect(screen.getByTestId('diff-original-content')).toHaveTextContent('Gadget');
    expect(screen.getByTestId('pin-response-btn')).toHaveStyle({ border: unpinnedBorder });
    expect(screen.getByTestId('pin-response-btn')).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByTestId('pin-response-btn'));
    expect(onPinResponse).toHaveBeenLastCalledWith(mockResponse);
  });

  it.each([mockResponse, previousResponse])('allows removing either the current or an older pinned response ($requestId)', pinned => {
    const onPinResponse = vi.fn();
    const { rerender } = render(
      <ResponseInspector
        response={mockResponse}
        pinnedResponse={pinned}
        onPinResponse={onPinResponse}
      />,
    );
    expect(screen.queryByTestId('unpin-response-btn')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('pin-response-btn'));
    expect(onPinResponse).toHaveBeenCalledExactlyOnceWith(null);
    rerender(
      <ResponseInspector
        response={mockResponse}
        pinnedResponse={null}
        onPinResponse={onPinResponse}
      />,
    );
    expect(screen.queryByTestId('unpin-response-btn')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByTestId('pin-response-btn')).toHaveTextContent('Pin for Diff');
    expect(screen.getByTestId('pin-response-btn')).toBeEnabled();
    fireEvent.click(screen.getByTestId('resp-body-mode-diff'));
    expect(screen.getByTestId('diff-original-content')).toHaveTextContent('No pinned or previous response');
  });

  it.each([
    ['pretty', '', JSON.stringify(JSON.parse(mockResponse.body), null, 2)],
    ['raw', '$.data.items[*].name', mockResponse.body],
    ['pretty', '$.data.items[*].name', JSON.stringify(['Widget', 'Gadget'], null, 2)],
  ])('copies the displayed %s body with filter "%s" and confirms success', async (mode, filter, expected) => {
    const copyToClipboard = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('electronAPI', { copyToClipboard });
    render(<ResponseInspector response={mockResponse} />);
    fireEvent.click(screen.getByTestId(`resp-body-mode-${mode}`));
    fireEvent.change(screen.getByTestId('response-jsonpath-input'), { target: { value: filter } });
    fireEvent.click(screen.getByTestId('copy-response-btn'));
    expect(copyToClipboard).toHaveBeenCalledWith(expected);
    await waitFor(() => expect(screen.getByTestId('copy-response-btn')).toHaveTextContent('Copied!'));
  });

  it('uses the browser clipboard when the Electron bridge is unavailable', async () => {
    vi.stubGlobal('electronAPI', undefined);
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    render(<ResponseInspector response={mockResponse} />);
    fireEvent.click(screen.getByTestId('copy-response-btn'));
    expect(writeText).toHaveBeenCalledWith(JSON.stringify(JSON.parse(mockResponse.body), null, 2));
    await waitFor(() => expect(screen.getByTestId('copy-response-btn')).toHaveTextContent('Copied!'));
  });

  it('reports clipboard errors and allows retrying', async () => {
    const copyToClipboard = vi.fn().mockRejectedValueOnce(new Error('Access denied')).mockResolvedValue(undefined);
    vi.stubGlobal('electronAPI', { copyToClipboard });
    render(<ResponseInspector response={mockResponse} />);
    fireEvent.click(screen.getByTestId('copy-response-btn'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not copy response: Access denied');
    expect(screen.getByTestId('copy-response-btn')).not.toHaveTextContent('Copied!');
    fireEvent.click(screen.getByTestId('copy-response-btn'));
    await waitFor(() => expect(screen.getByTestId('copy-response-btn')).toHaveTextContent('Copied!'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('reports unavailable clipboard access rather than silently succeeding', async () => {
    vi.stubGlobal('electronAPI', undefined);
    render(<ResponseInspector response={mockResponse} />);
    fireEvent.click(screen.getByTestId('copy-response-btn'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Clipboard access is unavailable.');
    expect(screen.getByTestId('copy-response-btn')).not.toHaveTextContent('Copied!');
  });

  it('waits for the clipboard write and ignores completion after switching responses', async () => {
    let resolveCopy!: () => void;
    const copyToClipboard = vi.fn(() => new Promise<void>(resolve => { resolveCopy = resolve; }));
    vi.stubGlobal('electronAPI', { copyToClipboard });
    const { rerender } = render(<ResponseInspector response={mockResponse} />);
    fireEvent.click(screen.getByTestId('copy-response-btn'));
    expect(screen.getByTestId('copy-response-btn')).toHaveTextContent('Copying...');
    expect(screen.getByTestId('copy-response-btn')).toBeDisabled();
    rerender(<ResponseInspector response={previousResponse} />);
    await act(async () => { resolveCopy(); });
    expect(screen.getByTestId('copy-response-btn')).toHaveTextContent(/^Copy$/);
    expect(screen.getByTestId('copy-response-btn')).toBeEnabled();
  });

  it('clears the success feedback after a short delay', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('electronAPI', { copyToClipboard: vi.fn().mockResolvedValue(undefined) });
    render(<ResponseInspector response={mockResponse} />);
    await act(async () => { fireEvent.click(screen.getByTestId('copy-response-btn')); });
    expect(screen.getByTestId('copy-response-btn')).toHaveTextContent('Copied!');
    act(() => { vi.advanceTimersByTime(1800); });
    expect(screen.getByTestId('copy-response-btn')).toHaveTextContent(/^Copy$/);
  });

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
