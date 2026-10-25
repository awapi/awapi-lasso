import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { CodeSnippetModal } from './CodeSnippetModal';
import { createDefaultHttpRequest } from '../../../shared/collectionSchema';

describe('CodeSnippetModal', () => {
  it('switches language targets, toggles variable resolution, and copies snippet to clipboard', async () => {
    const copyToClipboard = vi.fn().mockResolvedValue(undefined);
    (window as unknown as { electronAPI: Record<string, unknown> }).electronAPI = {
      ...((window as unknown as { electronAPI?: Record<string, unknown> }).electronAPI ?? {}),
      copyToClipboard,
    };

    const request = createDefaultHttpRequest({
      name: 'Get Profile',
      method: 'GET',
      url: '{{baseUrl}}/v1/profile',
      headers: [{ key: 'Accept', value: 'application/json', enabled: true }],
    });

    const onClose = vi.fn();

    render(
      <CodeSnippetModal
        isOpen={true}
        request={request}
        interpolationContext={{
          environmentVariables: [
            { key: 'baseUrl', value: 'https://api.example.com', enabled: true },
          ],
        }}
        onClose={onClose}
      />,
    );

    const output = screen.getByTestId('code-snippet-output');
    // By default resolveVariables is true
    expect(output.textContent).toContain('https://api.example.com/v1/profile');

    // Toggle resolveVariables off -> preserves {{baseUrl}}
    fireEvent.click(screen.getByTestId('resolve-variables-toggle'));
    expect(output.textContent).toContain('{{baseUrl}}/v1/profile');

    // Switch target to Python (requests)
    fireEvent.change(screen.getByTestId('code-target-select'), {
      target: { value: 'python-requests' },
    });
    expect(output.textContent).toContain('import requests');

    // Copy snippet
    fireEvent.click(screen.getByTestId('copy-code-snippet-btn'));
    expect(copyToClipboard).toHaveBeenCalledWith(expect.stringContaining('import requests'));

    // Close modal
    fireEvent.click(screen.getByTestId('close-code-snippet-modal-btn'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
