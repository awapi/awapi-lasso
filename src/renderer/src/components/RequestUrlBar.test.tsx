import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { RequestUrlBar } from './RequestUrlBar';

describe('RequestUrlBar', () => {
  it('highlights resolved vs unresolved {{variables}} and :path parameters and opens hover popover', () => {
    const onEditVariable = vi.fn();

    render(
      <RequestUrlBar
        method="GET"
        url="{{baseUrl}}/v1/users/:userId?token={{apiKey}}&missing={{unknownVar}}"
        pathParams={[{ key: 'userId', value: '42' }]}
        interpolationContext={{
          environmentVariables: [
            { key: 'baseUrl', value: 'https://api.example.com', enabled: true },
            { key: 'apiKey', value: 'sec_999', enabled: true, secret: true },
          ],
        }}
        onMethodChange={vi.fn()}
        onUrlChange={vi.fn()}
        onSend={vi.fn()}
        onEditVariable={onEditVariable}
      />,
    );

    const baseUrlPill = screen.getByTestId('url-var-pill-baseUrl');
    const apiKeyPill = screen.getByTestId('url-var-pill-apiKey');
    const unknownPill = screen.getByTestId('url-var-pill-unknownVar');
    const pathPill = screen.getByTestId('url-path-pill-userId');

    expect(baseUrlPill).toHaveAttribute('data-resolved', 'true');
    expect(apiKeyPill).toHaveAttribute('data-resolved', 'true');
    expect(unknownPill).toHaveAttribute('data-resolved', 'false');
    expect(pathPill).toHaveTextContent(':userId=42');

    // Hover over secret variable {{apiKey}}
    fireEvent.mouseEnter(apiKeyPill);
    expect(screen.getByTestId('variable-hover-popover')).toBeInTheDocument();
    expect(screen.getByTestId('variable-popover-scope')).toHaveTextContent('Environment');
    expect(screen.getByTestId('variable-popover-value')).toHaveTextContent('••••••••');

    // Reveal secret
    fireEvent.click(screen.getByTestId('variable-secret-reveal-btn'));
    expect(screen.getByTestId('variable-popover-value')).toHaveTextContent('sec_999');

    // Quick edit
    fireEvent.click(screen.getByTestId('variable-quick-edit-btn'));
    expect(onEditVariable).toHaveBeenCalledWith('apiKey', 'environment');
  });

  it('supports custom HTTP verbs, Cmd/Ctrl+Enter to send, and Cancel when sending', () => {
    const onMethodChange = vi.fn();
    const onSend = vi.fn();
    const onCancel = vi.fn();

    const { rerender } = render(
      <RequestUrlBar
        method="GET"
        url="https://api.example.com/health"
        onMethodChange={onMethodChange}
        onUrlChange={vi.fn()}
        onSend={onSend}
        onCancel={onCancel}
      />,
    );

    fireEvent.change(screen.getByTestId('method-select'), { target: { value: '__CUSTOM__' } });
    const customInput = screen.getByTestId('custom-method-input');
    fireEvent.change(customInput, { target: { value: 'propfind' } });
    expect(onMethodChange).toHaveBeenCalledWith('PROPFIND', 'http');

    // Enter or Cmd+Enter on URL input sends request
    fireEvent.keyDown(screen.getByTestId('url-input'), { key: 'Enter' });
    expect(onSend).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(screen.getByTestId('url-input'), { key: 'Enter', metaKey: true });
    expect(onSend).toHaveBeenCalledTimes(2);

    // Rerender in sending state -> shows Cancel button
    rerender(
      <RequestUrlBar
        method="GET"
        url="https://api.example.com/health"
        isSending={true}
        onMethodChange={onMethodChange}
        onUrlChange={vi.fn()}
        onSend={onSend}
        onCancel={onCancel}
      />,
    );

    fireEvent.click(screen.getByTestId('cancel-request-btn'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
