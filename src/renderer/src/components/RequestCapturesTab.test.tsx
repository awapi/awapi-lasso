import React, { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { RequestCapturesTab } from './RequestCapturesTab';
import type { CaptureRule } from '../../../shared/collectionSchema';

const StatefulCaptures: React.FC = () => {
  const [rules, setRules] = useState<CaptureRule[]>([]);
  return <RequestCapturesTab captures={rules} onChange={setRules} />;
};

describe('RequestCapturesTab', () => {
  it('adds, edits, toggles secret flag, and deletes response capture rules', () => {
    render(<StatefulCaptures />);

    expect(screen.getByTestId('captures-empty-msg')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('captures-add-btn'));
    fireEvent.change(screen.getByTestId('capture-variable-0'), {
      target: { value: 'sessionToken' },
    });
    fireEvent.change(screen.getByTestId('capture-expression-0'), {
      target: { value: '$.auth.token' },
    });
    fireEvent.click(screen.getByTestId('capture-secret-0'));

    expect(screen.getByTestId('capture-variable-0')).toHaveValue('sessionToken');
    expect(screen.getByTestId('capture-expression-0')).toHaveValue('$.auth.token');

    fireEvent.click(screen.getByTestId('capture-delete-0'));
    expect(screen.getByTestId('captures-empty-msg')).toBeInTheDocument();
  });
});
