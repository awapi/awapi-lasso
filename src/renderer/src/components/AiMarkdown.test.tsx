import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ThemeProvider } from '../context/ThemeContext';
import { AiMarkdown } from './AiMarkdown';

const renderMd = (text: string) =>
  render(
    <ThemeProvider>
      <AiMarkdown text={text} />
    </ThemeProvider>,
  );

describe('AiMarkdown', () => {
  it('renders headings, lists, tables and inline formatting as elements', () => {
    const { container } = renderMd(
      '### Fix\n1. Add **Accept**\n2. Set `X-Id`\n\n| Header | Value |\n|---|---|\n| Accept | json |',
    );
    expect(screen.getByRole('heading', { name: 'Fix' })).toBeInTheDocument();
    expect(container.querySelectorAll('ol > li')).toHaveLength(2);
    expect(container.querySelector('strong')).toHaveTextContent('Accept');
    expect(container.querySelector('code')).toHaveTextContent('X-Id');
    expect(screen.getByRole('table')).toHaveTextContent('Accept');
  });

  it('never renders raw HTML or clickable links from model output', () => {
    const { container } = renderMd('<img src=x onerror="alert(1)"> see [docs](javascript:void0)');
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
    expect(container).toHaveTextContent('<img src=x onerror="alert(1)">');
    expect(screen.getByTestId('ai-md-link')).toHaveTextContent('docs (javascript:void0)');
  });
});
