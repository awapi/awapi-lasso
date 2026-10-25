import React from 'react';
import type { PathParamEntry, QueryParamEntry } from '../../../shared/collectionSchema';
import { syncUrlFromQueryParams } from '../../../shared/urlParams';
import { KeyValueTable } from './KeyValueTable';
import { useTheme } from '../context/ThemeContext';

export interface RequestParamsTabProps {
  url: string;
  queryParams: QueryParamEntry[];
  pathParams: PathParamEntry[];
  onChange: (next: {
    url: string;
    queryParams: QueryParamEntry[];
    pathParams: PathParamEntry[];
  }) => void;
}

export const RequestParamsTab: React.FC<RequestParamsTabProps> = ({
  url,
  queryParams,
  pathParams,
  onChange,
}) => {
  const { colors } = useTheme();

  const handleQueryParamsChange = (nextQueryParams: QueryParamEntry[]) => {
    const nextUrl = syncUrlFromQueryParams(url, nextQueryParams);
    onChange({
      url: nextUrl,
      queryParams: nextQueryParams,
      pathParams,
    });
  };

  const handlePathParamUpdate = (index: number, patch: Partial<PathParamEntry>) => {
    const nextPathParams = pathParams.map((item, idx) =>
      idx === index ? { ...item, ...patch } : item,
    );
    onChange({
      url,
      queryParams,
      pathParams: nextPathParams,
    });
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '5px 8px',
    borderRadius: 4,
    border: `1px solid ${colors.border}`,
    backgroundColor: colors.bgPrimary,
    color: colors.textPrimary,
    fontSize: 12,
    fontFamily: 'monospace',
  };

  return (
    <div
      data-testid="request-params-tab"
      style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
    >
      {/* Query Parameters Section */}
      <section>
        <div
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: colors.textSecondary,
            marginBottom: 8,
            textTransform: 'uppercase',
          }}
        >
          Query Parameters
        </div>
        <KeyValueTable
          entries={queryParams}
          onChange={handleQueryParamsChange}
          keyPlaceholder="Parameter"
          valuePlaceholder="Value"
          testIdPrefix="query-params"
        />
      </section>

      {/* Path Parameters Section (:param or {param}) */}
      <section data-testid="path-params-section">
        <div
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: colors.textSecondary,
            marginBottom: 8,
            textTransform: 'uppercase',
          }}
        >
          Path Variables (<code>:param</code> / <code>{'{param}'}</code>)
        </div>
        {pathParams.length === 0 ? (
          <div
            data-testid="empty-path-params-msg"
            style={{
              fontSize: 12,
              color: colors.textMuted,
              padding: '10px 12px',
              borderRadius: 6,
              border: `1px dashed ${colors.border}`,
            }}
          >
            Add <code>:paramName</code> or <code>{'{paramName}'}</code> to the request URL path to
            configure path variables.
          </div>
        ) : (
          <div
            style={{
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              overflow: 'hidden',
            }}
          >
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr
                  style={{
                    backgroundColor: colors.bgSecondary,
                    color: colors.textSecondary,
                    textAlign: 'left',
                    borderBottom: `1px solid ${colors.border}`,
                  }}
                >
                  <th style={{ padding: '6px 8px', width: '30%' }}>Path Variable</th>
                  <th style={{ padding: '6px 8px', width: '40%' }}>Value</th>
                  <th style={{ padding: '6px 8px' }}>Description</th>
                </tr>
              </thead>
              <tbody>
                {pathParams.map((pp, idx) => (
                  <tr
                    key={pp.key}
                    data-testid={`path-param-row-${pp.key}`}
                    style={{
                      borderBottom:
                        idx < pathParams.length - 1 ? `1px solid ${colors.border}` : 'none',
                    }}
                  >
                    <td style={{ padding: '5px 8px', fontFamily: 'monospace', fontWeight: 700 }}>
                      :{pp.key}
                    </td>
                    <td style={{ padding: '5px 6px' }}>
                      <input
                        type="text"
                        aria-label={`Path variable ${pp.key} value`}
                        data-testid={`path-param-value-${pp.key}`}
                        value={pp.value ?? ''}
                        placeholder={`Value for :${pp.key}`}
                        onChange={e => handlePathParamUpdate(idx, { value: e.target.value })}
                        style={inputStyle}
                      />
                    </td>
                    <td style={{ padding: '5px 6px' }}>
                      <input
                        type="text"
                        aria-label={`Path variable ${pp.key} description`}
                        data-testid={`path-param-desc-${pp.key}`}
                        value={pp.description ?? ''}
                        placeholder="Description"
                        onChange={e => handlePathParamUpdate(idx, { description: e.target.value })}
                        style={{ ...inputStyle, fontFamily: 'inherit' }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
