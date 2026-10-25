import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { KeyValueEntry } from '../../../shared/collectionSchema';
import { KeyValueTable } from './KeyValueTable';
import { useTheme } from '../context/ThemeContext';

export const STANDARD_HTTP_HEADERS = [
  'Accept',
  'Accept-Encoding',
  'Accept-Language',
  'Authorization',
  'Cache-Control',
  'Connection',
  'Content-Length',
  'Content-Type',
  'Cookie',
  'Host',
  'If-Match',
  'If-Modified-Since',
  'If-None-Match',
  'Origin',
  'Pragma',
  'Referer',
  'User-Agent',
  'X-API-Key',
  'X-Correlation-ID',
  'X-Forwarded-For',
  'X-Request-ID',
  'X-Requested-With',
];

export interface InheritedHeaderEntry extends KeyValueEntry {
  sourceName?: string;
}

export interface RequestHeadersTabProps {
  headers: KeyValueEntry[];
  inheritedHeaders?: InheritedHeaderEntry[];
  onChange: (headers: KeyValueEntry[]) => void;
}

export const RequestHeadersTab: React.FC<RequestHeadersTabProps> = ({
  headers,
  inheritedHeaders = [],
  onChange,
}) => {
  const { colors } = useTheme();
  const [showInherited, setShowInherited] = useState<boolean>(false);

  const enabledInherited = inheritedHeaders.filter(h => h.enabled !== false && h.key.trim());

  return (
    <div
      data-testid="request-headers-tab"
      style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
    >
      {/* Collapsible Inherited Headers from Parent Folder / Collection */}
      {enabledInherited.length > 0 && (
        <div
          data-testid="inherited-headers-panel"
          style={{
            borderRadius: 6,
            border: `1px solid ${colors.border}`,
            backgroundColor: colors.bgSecondary,
            overflow: 'hidden',
          }}
        >
          <button
            type="button"
            data-testid="toggle-inherited-headers-btn"
            onClick={() => setShowInherited(prev => !prev)}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '7px 10px',
              border: 'none',
              background: 'transparent',
              color: colors.textSecondary,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {showInherited ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              Inherited Headers ({enabledInherited.length})
            </span>
            <span style={{ fontSize: 11, color: colors.textMuted }}>
              From Collection / Parent Folders
            </span>
          </button>

          {showInherited && (
            <table
              data-testid="inherited-headers-table"
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: 12,
                borderTop: `1px solid ${colors.border}`,
              }}
            >
              <thead>
                <tr
                  style={{
                    color: colors.textMuted,
                    textAlign: 'left',
                    borderBottom: `1px solid ${colors.border}`,
                  }}
                >
                  <th style={{ padding: '5px 10px', width: '35%' }}>Header</th>
                  <th style={{ padding: '5px 10px', width: '45%' }}>Value</th>
                  <th style={{ padding: '5px 10px' }}>Inherited From</th>
                </tr>
              </thead>
              <tbody>
                {enabledInherited.map((item, idx) => (
                  <tr
                    key={`${item.key}_${idx}`}
                    data-testid={`inherited-header-row-${idx}`}
                    style={{
                      borderBottom:
                        idx < enabledInherited.length - 1 ? `1px solid ${colors.border}` : 'none',
                    }}
                  >
                    <td style={{ padding: '5px 10px', fontFamily: 'monospace' }}>{item.key}</td>
                    <td style={{ padding: '5px 10px', fontFamily: 'monospace' }}>
                      {item.secret ? '••••••••' : item.value}
                    </td>
                    <td style={{ padding: '5px 10px', color: colors.textMuted }}>
                      {item.sourceName ?? 'Collection Defaults'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Request-Specific Headers */}
      <KeyValueTable
        entries={headers}
        onChange={onChange}
        keyPlaceholder="Header Name"
        valuePlaceholder="Header Value"
        keySuggestions={STANDARD_HTTP_HEADERS}
        testIdPrefix="request-headers"
      />
    </div>
  );
};
