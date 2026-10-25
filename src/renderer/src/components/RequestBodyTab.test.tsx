import React, { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { RequestBodyTab } from './RequestBodyTab';
import type { RequestBodyConfig } from '../../../shared/collectionSchema';

const StatefulBodyTab: React.FC = () => {
  const [body, setBody] = useState<RequestBodyConfig>({ mode: 'none' });
  return <RequestBodyTab body={body} onChange={setBody} />;
};

describe('RequestBodyTab', () => {
  it('switches body modes, prettifies JSON payloads, and edits multipart-form & binary fields', () => {
    render(<StatefulBodyTab />);

    expect(screen.getByTestId('body-none-msg')).toBeInTheDocument();

    // Switch to JSON mode and prettify
    fireEvent.click(screen.getByTestId('body-mode-json'));
    const textarea = screen.getByTestId('body-content-textarea');
    fireEvent.change(textarea, { target: { value: '{"id":1,"name":"Alice"}' } });
    fireEvent.click(screen.getByTestId('body-prettify-btn'));
    expect(textarea).toHaveValue('{\n  "id": 1,\n  "name": "Alice"\n}');

    // Switch to Multipart Form and add a File field
    fireEvent.click(screen.getByTestId('body-mode-multipart-form'));
    fireEvent.click(screen.getByTestId('multipart-add-row-btn'));
    fireEvent.change(screen.getByTestId('multipart-key-0'), { target: { value: 'avatar' } });
    fireEvent.change(screen.getByTestId('multipart-type-0'), { target: { value: 'file' } });
    fireEvent.change(screen.getByTestId('multipart-file-0'), {
      target: { value: '/tmp/avatar.png' },
    });
    expect(screen.getByTestId('multipart-file-0')).toHaveValue('/tmp/avatar.png');

    // Switch to Binary mode
    fireEvent.click(screen.getByTestId('body-mode-binary'));
    fireEvent.change(screen.getByTestId('body-binary-path-input'), {
      target: { value: '/tmp/archive.tar.gz' },
    });
    expect(screen.getByTestId('body-binary-path-input')).toHaveValue('/tmp/archive.tar.gz');
  });

  it('stretches the body editor container to fill the available request panel height', () => {
    render(<StatefulBodyTab />);
    fireEvent.click(screen.getByTestId('body-mode-json'));

    const tabRoot = screen.getByTestId('request-body-tab');
    const editorContainer = screen.getByTestId('body-editor-container');

    expect(tabRoot).toHaveStyle({ flex: '1', height: '100%' });
    expect(editorContainer).toHaveStyle({ flex: '1' });
  });
});
