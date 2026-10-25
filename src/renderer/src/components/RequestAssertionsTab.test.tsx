import React, { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { RequestAssertionsTab } from './RequestAssertionsTab';
import type { AssertionRule } from '../../../shared/collectionSchema';

const StatefulAssertions: React.FC = () => {
  const [rules, setRules] = useState<AssertionRule[]>([]);
  return <RequestAssertionsTab assertions={rules} onChange={setRules} />;
};

describe('RequestAssertionsTab', () => {
  it('adds, configures target/operator/expected, and deletes assertion rules', () => {
    render(<StatefulAssertions />);

    expect(screen.getByTestId('assertions-empty-msg')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('assertions-add-btn'));
    expect(screen.getByTestId('assertion-target-0')).toHaveValue('status');
    expect(screen.getByTestId('assertion-expected-0')).toHaveValue('200');

    // Change to jsonpath target
    fireEvent.change(screen.getByTestId('assertion-target-0'), { target: { value: 'jsonpath' } });
    fireEvent.change(screen.getByTestId('assertion-path-0'), {
      target: { value: '$.data.items' },
    });
    fireEvent.change(screen.getByTestId('assertion-operator-0'), {
      target: { value: 'isArray' },
    });

    expect(screen.getByTestId('assertion-path-0')).toHaveValue('$.data.items');
    expect(screen.getByTestId('assertion-expected-0')).toBeDisabled();

    fireEvent.click(screen.getByTestId('assertion-delete-0'));
    expect(screen.getByTestId('assertions-empty-msg')).toBeInTheDocument();
  });
});
