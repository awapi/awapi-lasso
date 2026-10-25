import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { CollectionRunnerModal } from './CollectionRunnerModal';
import {
  createDefaultFolder,
  createDefaultHttpRequest,
  createEmptyCollection,
} from '../../../shared/collectionSchema';
import type { HttpResponseResult, PreparedHttpRequest } from '../../../shared/httpTypes';

function buildMockResponse(overrides: Partial<HttpResponseResult> = {}): HttpResponseResult {
  return {
    requestId: 'req_1',
    ok: true,
    finalUrl: 'http://localhost:8080/test',
    method: 'GET',
    status: 200,
    statusText: 'OK',
    httpVersion: '1.1',
    headers: { 'content-type': 'application/json' },
    rawHeaders: [{ key: 'Content-Type', value: 'application/json' }],
    cookies: [],
    body: '{"ok":true}',
    isBinary: false,
    contentType: 'application/json',
    sizeBytes: 11,
    transferSizeBytes: 11,
    timings: { dnsMs: 1, tcpMs: 1, tlsMs: 0, ttfbMs: 5, downloadMs: 1, totalMs: 8 },
    tls: null,
    redirects: [],
    captures: [],
    assertions: [],
    sentHeaders: {},
    ...overrides,
  };
}

describe('CollectionRunnerModal', () => {
  it('executes requests sequentially, forwards captured variables between steps, and exports JSON report', async () => {
    const sentRequests: PreparedHttpRequest[] = [];
    const sendHttpRequest = vi.fn(async (req: PreparedHttpRequest) => {
      sentRequests.push(req);
      if (req.url.includes('/login')) {
        return buildMockResponse({
          status: 200,
          captures: [
            {
              variable: 'authToken',
              scope: 'runtime',
              source: 'jsonpath',
              expression: '$.token',
              value: 'jwt_captured_999',
              matched: true,
            },
          ],
          assertions: [
            {
              rule: { target: 'status', operator: 'equals', expected: 200 },
              passed: true,
              actual: 200,
              message: 'PASS: status equals 200',
            },
          ],
        });
      }
      return buildMockResponse({
        status: 201,
        assertions: [
          {
            rule: { target: 'status', operator: 'equals', expected: 201 },
            passed: true,
            actual: 201,
            message: 'PASS: status equals 201',
          },
        ],
      });
    });

    const copyToClipboard = vi.fn().mockResolvedValue(undefined);
    (window as unknown as { electronAPI: Record<string, unknown> }).electronAPI = {
      ...((window as unknown as { electronAPI?: Record<string, unknown> }).electronAPI ?? {}),
      sendHttpRequest,
      copyToClipboard,
    };

    const req1 = createDefaultHttpRequest({
      id: 'req_login',
      name: '1. Login',
      method: 'POST',
      url: '{{baseUrl}}/login',
    });
    const req2 = createDefaultHttpRequest({
      id: 'req_create_order',
      name: '2. Create Order',
      method: 'POST',
      url: '{{baseUrl}}/orders',
      headers: [{ key: 'Authorization', value: 'Bearer {{authToken}}', enabled: true }],
    });

    const collection = createEmptyCollection('E2E Order Suite', {
      items: [createDefaultFolder('Checkout Flow', [req1, req2], { id: 'fld_checkout' })],
    });

    const onUpdateCapturedVariables = vi.fn();

    render(
      <CollectionRunnerModal
        isOpen={true}
        collection={collection}
        onUpdateCapturedVariables={onUpdateCapturedVariables}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('start-collection-run-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('runner-summary')).toBeInTheDocument();
    });

    expect(sendHttpRequest).toHaveBeenCalledTimes(2);
    // Verify second request received the captured variable from step 1
    expect(sentRequests[1].interpolationContext?.capturedVariables).toEqual([
      {
        key: 'authToken',
        value: 'jwt_captured_999',
        enabled: true,
        secret: undefined,
      },
    ]);

    expect(screen.getByTestId('runner-total-requests')).toHaveTextContent('2');
    expect(screen.getByTestId('runner-passed-requests')).toHaveTextContent('2');
    expect(screen.getByTestId('runner-failed-requests')).toHaveTextContent('0');
    expect(screen.getByTestId('runner-assertions-summary')).toHaveTextContent('2 / 0');

    // Export JSON report
    fireEvent.click(screen.getByTestId('export-runner-report-json-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('runner-exported-json-preview')).toBeInTheDocument();
    });
    expect(copyToClipboard).toHaveBeenCalledWith(expect.stringContaining('"passedRequests": 2'));
  });

  it('stops on first failed assertion when stop-on-failure is enabled', async () => {
    const sendHttpRequest = vi.fn().mockResolvedValue(
      buildMockResponse({
        status: 500,
        assertions: [
          {
            rule: { target: 'status', operator: 'equals', expected: 200 },
            passed: false,
            actual: 500,
            message: 'FAIL: Expected status equals 200, but got 500',
          },
        ],
      }),
    );

    (window as unknown as { electronAPI: Record<string, unknown> }).electronAPI = {
      ...((window as unknown as { electronAPI?: Record<string, unknown> }).electronAPI ?? {}),
      sendHttpRequest,
    };

    const req1 = createDefaultHttpRequest({ id: 'req_step1', name: 'Step 1' });
    const req2 = createDefaultHttpRequest({ id: 'req_step2', name: 'Step 2' });
    const collection = createEmptyCollection('Stop Suite', { items: [req1, req2] });

    render(
      <CollectionRunnerModal
        isOpen={true}
        collection={collection}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('runner-stop-on-failure-checkbox'));
    fireEvent.click(screen.getByTestId('start-collection-run-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('runner-summary')).toBeInTheDocument();
    });

    // Only Step 1 ran because stop-on-failure halted execution
    expect(sendHttpRequest).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('runner-total-requests')).toHaveTextContent('1');
    expect(screen.getByTestId('runner-failed-requests')).toHaveTextContent('1');
  });
});
