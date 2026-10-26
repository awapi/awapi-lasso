import React, { useState } from 'react';
import Editor from '@monaco-editor/react';
import { Plus, Sparkles, Trash2 } from 'lucide-react';
import YAML from 'yaml';
import type {
  FormDataEntry,
  RequestBodyConfig,
  RequestBodyMode,
} from '../../../shared/collectionSchema';
import { KeyValueTable } from './KeyValueTable';
import { useTheme } from '../context/ThemeContext';

export interface RequestBodyTabProps {
  body: RequestBodyConfig;
  onChange: (body: RequestBodyConfig) => void;
}

const BODY_MODES: Array<{ value: RequestBodyMode; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'json', label: 'JSON' },
  { value: 'yaml', label: 'YAML' },
  { value: 'xml', label: 'XML' },
  { value: 'text', label: 'Raw Text' },
  { value: 'form-urlencoded', label: 'Form URL-Encoded' },
  { value: 'multipart-form', label: 'Multipart Form' },
  { value: 'binary', label: 'Binary File' },
];

export function prettifyBodyContent(mode: RequestBodyMode, rawContent: string): string {
  if (!rawContent || !rawContent.trim()) return rawContent;
  try {
    if (mode === 'json') {
      return JSON.stringify(JSON.parse(rawContent), null, 2);
    }
    if (mode === 'yaml') {
      const parsed = YAML.parse(rawContent);
      return YAML.stringify(parsed, { indent: 2 }).trimEnd();
    }
  } catch {
    // keep original on syntax error
  }
  return rawContent;
}

export const RequestBodyTab: React.FC<RequestBodyTabProps> = ({ body, onChange }) => {
  const { colors, isLight } = useTheme();
  const [prettifyError, setPrettifyError] = useState<string | null>(null);

  const isStructuredText =
    body.mode === 'json' ||
    body.mode === 'yaml' ||
    body.mode === 'xml' ||
    body.mode === 'html' ||
    body.mode === 'text';

  const handleModeChange = (mode: RequestBodyMode) => {
    setPrettifyError(null);
    onChange({
      ...body,
      mode,
      urlEncoded: body.urlEncoded ?? [],
      formData: body.formData ?? [],
    });
  };

  const handlePrettify = () => {
    setPrettifyError(null);
    const current = body.content ?? '';
    if (!current.trim()) return;
    try {
      if (body.mode === 'json') {
        const formatted = JSON.stringify(JSON.parse(current), null, 2);
        onChange({ ...body, content: formatted });
      } else if (body.mode === 'yaml') {
        const formatted = YAML.stringify(YAML.parse(current), { indent: 2 }).trimEnd();
        onChange({ ...body, content: formatted });
      }
    } catch (err) {
      setPrettifyError(err instanceof Error ? err.message : 'Unable to format payload');
    }
  };

  const handleMultipartChange = (index: number, patch: Partial<FormDataEntry>) => {
    const current = body.formData ?? [];
    const next = current.map((entry, idx) => (idx === index ? { ...entry, ...patch } : entry));
    onChange({ ...body, formData: next });
  };

  const handleAddMultipartRow = () => {
    const current = body.formData ?? [];
    onChange({
      ...body,
      formData: [...current, { key: '', type: 'text', value: '', enabled: true }],
    });
  };

  const handleDeleteMultipartRow = (index: number) => {
    const current = body.formData ?? [];
    onChange({
      ...body,
      formData: current.filter((_, idx) => idx !== index),
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

  const isTestEnv = typeof process !== 'undefined' && Boolean(process.env.VITEST);

  return (
    <div
      data-testid="request-body-tab"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        flex: 1,
        minHeight: 0,
        height: '100%',
      }}
    >
      {/* Mode Selector Bar & Prettify Button */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {BODY_MODES.map(m => {
            const active = body.mode === m.value;
            return (
              <button
                key={m.value}
                type="button"
                data-testid={`body-mode-${m.value}`}
                onClick={() => handleModeChange(m.value)}
                style={{
                  padding: '4px 10px',
                  borderRadius: 6,
                  border: `1px solid ${active ? colors.accent : colors.border}`,
                  backgroundColor: active ? `${colors.accent}22` : colors.bgSecondary,
                  color: active ? colors.accent : colors.textSecondary,
                  fontSize: 12,
                  fontWeight: active ? 700 : 500,
                  cursor: 'pointer',
                }}
              >
                {m.label}
              </button>
            );
          })}
        </div>

        {(body.mode === 'json' || body.mode === 'yaml') && (
          <button
            type="button"
            data-testid="body-prettify-btn"
            onClick={handlePrettify}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '4px 10px',
              borderRadius: 6,
              border: `1px solid ${colors.border}`,
              backgroundColor: colors.bgSecondary,
              color: colors.textPrimary,
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            <Sparkles size={12} />
            Prettify
          </button>
        )}
      </div>

      {prettifyError && (
        <div
          data-testid="body-prettify-error"
          style={{ fontSize: 11, color: colors.danger }}
        >
          {prettifyError}
        </div>
      )}

      {body.mode === 'none' && (
        <div
          data-testid="body-none-msg"
          style={{
            fontSize: 12,
            color: colors.textMuted,
            padding: 16,
            borderRadius: 6,
            border: `1px dashed ${colors.border}`,
            textAlign: 'center',
          }}
        >
          This request does not have a body payload.
        </div>
      )}

      {isStructuredText && (
        <div
          data-testid="body-editor-container"
          style={{
            flex: 1,
            minHeight: 160,
            display: 'flex',
            flexDirection: 'column',
            border: `1px solid ${colors.border}`,
            borderRadius: 6,
            overflow: 'hidden',
          }}
        >
          {isTestEnv ? (
            <textarea
              aria-label="Request Body Content"
              data-testid="body-content-textarea"
              value={body.content ?? ''}
              onChange={e => onChange({ ...body, content: e.target.value })}
              rows={10}
              style={{
                flex: 1,
                width: '100%',
                height: '100%',
                padding: 10,
                border: 'none',
                backgroundColor: colors.bgPrimary,
                color: colors.textPrimary,
                fontFamily: 'monospace',
                fontSize: 12,
                resize: 'none',
              }}
            />
          ) : (
            <div style={{ flex: 1, minHeight: 0 }}>
              <Editor
                height="100%"
                language={body.mode === 'text' ? 'plaintext' : body.mode}
                theme={isLight ? 'light' : 'vs-dark'}
                value={body.content ?? ''}
                onChange={val => onChange({ ...body, content: val ?? '' })}
                options={{
                  minimap: { enabled: false },
                  stickyScroll: { enabled: false },
                  fontSize: 12,
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                }}
              />
            </div>
          )}
        </div>
      )}

      {body.mode === 'form-urlencoded' && (
        <KeyValueTable
          entries={body.urlEncoded ?? []}
          onChange={urlEncoded => onChange({ ...body, urlEncoded })}
          keyPlaceholder="Field Name"
          valuePlaceholder="Field Value"
          testIdPrefix="body-urlencoded"
        />
      )}

      {body.mode === 'multipart-form' && (
        <div
          data-testid="body-multipart-section"
          style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
        >
          <div>
            <button
              type="button"
              data-testid="multipart-add-row-btn"
              onClick={handleAddMultipartRow}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '4px 10px',
                borderRadius: 5,
                border: `1px solid ${colors.border}`,
                backgroundColor: colors.bgSecondary,
                color: colors.textPrimary,
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <Plus size={12} />
              Add Multipart Field
            </button>
          </div>

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
                  <th style={{ width: 32, padding: '6px 8px' }} />
                  <th style={{ padding: '6px 8px', width: '25%' }}>Field Key</th>
                  <th style={{ padding: '6px 8px', width: 95 }}>Type</th>
                  <th style={{ padding: '6px 8px' }}>Value / Local File Path</th>
                  <th style={{ width: 48, padding: '6px 8px' }} />
                </tr>
              </thead>
              <tbody>
                {(body.formData ?? []).map((row, idx) => (
                  <tr
                    key={idx}
                    data-testid={`multipart-row-${idx}`}
                    style={{
                      borderBottom:
                        idx < (body.formData?.length ?? 0) - 1
                          ? `1px solid ${colors.border}`
                          : 'none',
                    }}
                  >
                    <td style={{ padding: '5px 8px', textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={row.enabled !== false}
                        onChange={e => handleMultipartChange(idx, { enabled: e.target.checked })}
                      />
                    </td>
                    <td style={{ padding: '5px 6px' }}>
                      <input
                        type="text"
                        data-testid={`multipart-key-${idx}`}
                        value={row.key}
                        placeholder="Field key"
                        onChange={e => handleMultipartChange(idx, { key: e.target.value })}
                        style={inputStyle}
                      />
                    </td>
                    <td style={{ padding: '5px 6px' }}>
                      <select
                        data-testid={`multipart-type-${idx}`}
                        value={row.type}
                        onChange={e =>
                          handleMultipartChange(idx, {
                            type: e.target.value as 'text' | 'file',
                          })
                        }
                        style={inputStyle}
                      >
                        <option value="text">Text</option>
                        <option value="file">File</option>
                      </select>
                    </td>
                    <td style={{ padding: '5px 6px' }}>
                      {row.type === 'file' ? (
                        <input
                          type="text"
                          data-testid={`multipart-file-${idx}`}
                          value={row.filePath ?? ''}
                          placeholder="/path/to/upload.png"
                          onChange={e => handleMultipartChange(idx, { filePath: e.target.value })}
                          style={inputStyle}
                        />
                      ) : (
                        <input
                          type="text"
                          data-testid={`multipart-value-${idx}`}
                          value={row.value ?? ''}
                          placeholder="Text value"
                          onChange={e => handleMultipartChange(idx, { value: e.target.value })}
                          style={inputStyle}
                        />
                      )}
                    </td>
                    <td style={{ padding: '5px 8px', textAlign: 'right' }}>
                      <button
                        type="button"
                        data-testid={`multipart-delete-${idx}`}
                        onClick={() => handleDeleteMultipartRow(idx)}
                        style={{
                          border: 'none',
                          background: 'transparent',
                          color: colors.danger,
                          cursor: 'pointer',
                        }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {body.mode === 'binary' && (
        <div
          data-testid="body-binary-section"
          style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 480 }}
        >
          <label style={{ fontSize: 11, fontWeight: 600, color: colors.textSecondary }}>
            Local Binary File Path
          </label>
          <input
            type="text"
            data-testid="body-binary-path-input"
            value={body.binaryFilePath ?? ''}
            placeholder="/path/to/payload.bin"
            onChange={e => onChange({ ...body, binaryFilePath: e.target.value })}
            style={inputStyle}
          />
        </div>
      )}
    </div>
  );
};
