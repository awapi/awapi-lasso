import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { KeyValueTable, parseBulkKeyValue, serializeBulkKeyValue } from './KeyValueTable';
import type { KeyValueEntry } from '../../../shared/collectionSchema';

const StatefulTable: React.FC<{ initial: KeyValueEntry[] }> = ({ initial }) => {
  const [rows, setRows] = useState<KeyValueEntry[]>(initial);
  return <KeyValueTable entries={rows} onChange={setRows} testIdPrefix="test-kv" />;
};

describe('KeyValueTable', () => {
  it('serializes and parses bulk key-value text including disabled (#) rows', () => {
    const entries: KeyValueEntry[] = [
      { key: 'Accept', value: 'application/json', enabled: true },
      { key: 'X-Debug', value: '1', enabled: false },
    ];
    const text = serializeBulkKeyValue(entries);
    expect(text).toBe('Accept: application/json\n# X-Debug: 1');

    const parsed = parseBulkKeyValue(text);
    expect(parsed).toEqual(entries);
  });

  it('adds, edits, toggles secret mask, switches to bulk mode, and deletes rows', () => {
    render(
      <StatefulTable
        initial={[{ key: 'Authorization', value: 'Bearer secret123', enabled: true, secret: true }]}
      />,
    );

    const valInput = screen.getByTestId('test-kv-value-0');
    expect(valInput).toHaveAttribute('type', 'password');

    // Reveal secret
    fireEvent.click(screen.getByTestId('test-kv-reveal-0'));
    expect(valInput).toHaveAttribute('type', 'text');

    // Add row
    fireEvent.click(screen.getByTestId('test-kv-add-row-btn'));
    expect(screen.getByTestId('test-kv-key-1')).toBeInTheDocument();

    // Edit new row
    fireEvent.change(screen.getByTestId('test-kv-key-1'), { target: { value: 'X-Tenant' } });
    fireEvent.change(screen.getByTestId('test-kv-value-1'), { target: { value: 'acme' } });

    // Switch to bulk mode & apply
    fireEvent.click(screen.getByTestId('test-kv-bulk-toggle-btn'));
    const bulkArea = screen.getByTestId('test-kv-bulk-textarea');
    expect(bulkArea).toHaveValue('Authorization: Bearer secret123\nX-Tenant: acme');

    fireEvent.change(bulkArea, { target: { value: 'X-Custom: hello' } });
    fireEvent.click(screen.getByTestId('test-kv-bulk-toggle-btn'));

    expect(screen.getByTestId('test-kv-key-0')).toHaveValue('X-Custom');

    // Delete row
    const onDeleteSpy = vi.fn();
    fireEvent.click(screen.getByTestId('test-kv-delete-0'));
    expect(screen.getByTestId('test-kv-empty-msg')).toBeInTheDocument();
    expect(onDeleteSpy).not.toHaveBeenCalled();
  });
});
