import React, { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { RequestParamsTab } from './RequestParamsTab';
import { syncPathParamsFromUrl, syncQueryParamsFromUrl } from '../../../shared/urlParams';
import type { PathParamEntry, QueryParamEntry } from '../../../shared/collectionSchema';

const StatefulParamsHarness: React.FC<{ initialUrl: string }> = ({ initialUrl }) => {
  const [url, setUrl] = useState(initialUrl);
  const [queryParams, setQueryParams] = useState<QueryParamEntry[]>(() =>
    syncQueryParamsFromUrl(initialUrl, []),
  );
  const [pathParams, setPathParams] = useState<PathParamEntry[]>(() =>
    syncPathParamsFromUrl(initialUrl, []),
  );

  const handleUrlInput = (nextUrl: string) => {
    setUrl(nextUrl);
    setQueryParams(prev => syncQueryParamsFromUrl(nextUrl, prev));
    setPathParams(prev => syncPathParamsFromUrl(nextUrl, prev));
  };

  return (
    <div>
      <input
        data-testid="harness-url-input"
        value={url}
        onChange={e => handleUrlInput(e.target.value)}
      />
      <RequestParamsTab
        url={url}
        queryParams={queryParams}
        pathParams={pathParams}
        onChange={next => {
          setUrl(next.url);
          setQueryParams(next.queryParams);
          setPathParams(next.pathParams);
        }}
      />
    </div>
  );
};

describe('RequestParamsTab', () => {
  it('syncs query params and :path variables bi-directionally with the URL bar', () => {
    render(
      <StatefulParamsHarness initialUrl="https://{{baseUrl}}/v1/users/:userId?page=1&limit={{pageSize}}" />,
    );

    expect(screen.getByTestId('query-params-key-0')).toHaveValue('page');
    expect(screen.getByTestId('query-params-value-0')).toHaveValue('1');
    expect(screen.getByTestId('query-params-key-1')).toHaveValue('limit');
    expect(screen.getByTestId('query-params-value-1')).toHaveValue('{{pageSize}}');

    expect(screen.getByTestId('path-param-row-userId')).toBeInTheDocument();

    // Update query param value in table -> updates URL while keeping {{pageSize}} unescaped
    fireEvent.change(screen.getByTestId('query-params-value-0'), { target: { value: '2' } });
    expect(screen.getByTestId('harness-url-input')).toHaveValue(
      'https://{{baseUrl}}/v1/users/:userId?page=2&limit={{pageSize}}',
    );

    // Disable first query param -> removed from URL query string
    fireEvent.click(screen.getByTestId('query-params-enabled-0'));
    expect(screen.getByTestId('harness-url-input')).toHaveValue(
      'https://{{baseUrl}}/v1/users/:userId?limit={{pageSize}}',
    );

    // Edit path param value
    fireEvent.change(screen.getByTestId('path-param-value-userId'), { target: { value: 'usr_99' } });
    expect(screen.getByTestId('path-param-value-userId')).toHaveValue('usr_99');
  });
});
