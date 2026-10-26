import React, { useEffect, useMemo, useRef, useState } from 'react';
import Editor, { DiffEditor } from '@monaco-editor/react';
import {
  CheckCircle2,
  Clock,
  Copy,
  Filter,
  GitCompare,
  Lock,
  Pin,
  XCircle,
} from 'lucide-react';
import { evaluateJsonPath } from '../../../shared/captures';
import type { HttpResponseResult } from '../../../shared/httpTypes';
import { useTheme } from '../context/ThemeContext';

export type ResponseInspectorTab = 'body' | 'headers' | 'cookies' | 'tests' | 'network';
export type ResponseBodyViewMode = 'pretty' | 'raw' | 'preview' | 'diff';

export interface ResponseInspectorProps {
  response: HttpResponseResult | null;
  previousResponse?: HttpResponseResult | null;
  pinnedResponse?: HttpResponseResult | null;
  onPinResponse?: (response: HttpResponseResult | null) => void;
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatPrettyResponseBody(body: string, contentType = ''): string {
  const ct = contentType.toLowerCase();
  if (ct.includes('json') || body.trim().startsWith('{') || body.trim().startsWith('[')) {
    try {
      return JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      return body;
    }
  }
  return body;
}

export const ResponseInspector: React.FC<ResponseInspectorProps> = ({
  response,
  previousResponse = null,
  pinnedResponse = null,
  onPinResponse,
}) => {
  const { colors, isLight } = useTheme();
  const [activeTab, setActiveTab] = useState<ResponseInspectorTab>('body');
  const [bodyView, setBodyView] = useState<ResponseBodyViewMode>('pretty');
  const [jsonPathFilter, setJsonPathFilter] = useState<string>('');
  const [showTimingPopover, setShowTimingPopover] = useState<boolean>(false);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copying' | 'copied' | 'error'>('idle');
  const [copyError, setCopyError] = useState<string | null>(null);
  const copyAttempt = useRef(0);

  const isTestEnv = typeof process !== 'undefined' && Boolean(process.env.VITEST);

  const baselineForDiff = pinnedResponse ?? previousResponse;
  const isCurrentResponsePinned = Boolean(response && pinnedResponse === response);

  const displayedBody = useMemo(() => {
    if (!response) return '';
    const raw = response.body ?? '';
    if (bodyView === 'raw') {
      return raw;
    }
    const pretty = formatPrettyResponseBody(raw, response.contentType);
    if (!jsonPathFilter.trim()) {
      return pretty;
    }
    try {
      const parsed = JSON.parse(raw);
      const filtered = evaluateJsonPath(parsed, jsonPathFilter.trim());
      if (filtered === undefined) {
        return '// No matches for JSONPath expression';
      }
      return typeof filtered === 'string' ? filtered : JSON.stringify(filtered, null, 2);
    } catch {
      return pretty;
    }
  }, [response, bodyView, jsonPathFilter]);

  useEffect(() => {
    setCopyStatus('idle');
    setCopyError(null);
    return () => {
      copyAttempt.current += 1;
    };
  }, [response, displayedBody]);

  useEffect(() => {
    if (copyStatus !== 'copied') return;
    const timeout = setTimeout(() => setCopyStatus('idle'), 1800);
    return () => clearTimeout(timeout);
  }, [copyStatus]);

  const handleCopy = async () => {
    const attempt = ++copyAttempt.current;
    setCopyStatus('copying');
    setCopyError(null);
    try {
      if (window.electronAPI?.copyToClipboard) {
        await window.electronAPI.copyToClipboard(displayedBody);
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(displayedBody);
      } else {
        throw new Error('Clipboard access is unavailable.');
      }
      if (attempt === copyAttempt.current) setCopyStatus('copied');
    } catch (error) {
      if (attempt !== copyAttempt.current) return;
      setCopyStatus('error');
      setCopyError(error instanceof Error ? error.message : 'Clipboard write failed.');
    }
  };

  if (!response) {
    return (
      <div
        data-testid="response-inspector-empty"
        style={{
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: colors.textMuted,
          fontSize: 13,
          backgroundColor: colors.bgPrimary,
        }}
      >
        Send an HTTP or GraphQL request to inspect the response, timings, cookies, and test results.
      </div>
    );
  }

  const isSuccess = response.status >= 200 && response.status < 300;
  const statusColor =
    response.status === 0
      ? colors.danger
      : isSuccess
        ? colors.success
        : response.status < 400
          ? colors.warning
          : colors.danger;

  const passedAssertions = (response.assertions ?? []).filter(a => a.passed).length;
  const totalAssertions = (response.assertions ?? []).length;

  return (
    <div
      data-testid="response-inspector"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        backgroundColor: colors.bgPrimary,
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* Top Metrics & Tabs Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 12px',
          borderBottom: `1px solid ${colors.border}`,
          backgroundColor: colors.bgSecondary,
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        {/* Inspector Section Tabs */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            type="button"
            data-testid="resp-tab-body"
            onClick={() => setActiveTab('body')}
            style={sectionTabStyle(activeTab === 'body', colors)}
          >
            Body
          </button>
          <button
            type="button"
            data-testid="resp-tab-headers"
            onClick={() => setActiveTab('headers')}
            style={sectionTabStyle(activeTab === 'headers', colors)}
          >
            Headers ({Object.keys(response.headers ?? {}).length})
          </button>
          <button
            type="button"
            data-testid="resp-tab-cookies"
            onClick={() => setActiveTab('cookies')}
            style={sectionTabStyle(activeTab === 'cookies', colors)}
          >
            Cookies ({(response.cookies ?? []).length})
          </button>
          <button
            type="button"
            data-testid="resp-tab-tests"
            onClick={() => setActiveTab('tests')}
            style={sectionTabStyle(activeTab === 'tests', colors)}
          >
            Tests ({passedAssertions}/{totalAssertions})
          </button>
          <button
            type="button"
            data-testid="resp-tab-network"
            onClick={() => setActiveTab('network')}
            style={sectionTabStyle(activeTab === 'network', colors)}
          >
            Network / TLS
          </button>
        </div>

        {/* Status, Timing & Size Metrics */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, position: 'relative' }}>
          <span
            data-testid="response-status-badge"
            style={{
              fontSize: 12,
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: 6,
              backgroundColor: `${statusColor}22`,
              color: statusColor,
            }}
          >
            {response.status > 0
              ? `${response.status} ${response.statusText || ''}`.trim()
              : 'Network Error'}
          </span>

          {/* Elapsed Time + Phase Breakdown Trigger */}
          <button
            type="button"
            data-testid="response-timing-badge"
            onClick={() => setShowTimingPopover(prev => !prev)}
            onMouseEnter={() => setShowTimingPopover(true)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 12,
              fontFamily: 'monospace',
              padding: '2px 8px',
              borderRadius: 6,
              border: `1px solid ${colors.border}`,
              backgroundColor: colors.bgPrimary,
              color: colors.textPrimary,
              cursor: 'pointer',
            }}
          >
            <Clock size={12} />
            {Math.round(response.timings?.totalMs ?? 0)} ms
          </button>

          {/* Payload Size */}
          <span
            data-testid="response-size-badge"
            style={{
              fontSize: 12,
              fontFamily: 'monospace',
              color: colors.textSecondary,
            }}
          >
            {formatBytes(response.sizeBytes)}
          </span>

          {/* Pin Response for Diff */}
          {onPinResponse && (
            <button
              type="button"
              data-testid="pin-response-btn"
              title={pinnedResponse
                ? 'Unpin baseline and compare with the previous response'
                : 'Pin current response as baseline for Side-by-Side Diff'}
              aria-pressed={Boolean(pinnedResponse)}
              onClick={() => onPinResponse(pinnedResponse ? null : response)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '3px 8px',
                borderRadius: 5,
                border: `1px solid ${pinnedResponse ? colors.accent : colors.border}`,
                backgroundColor: pinnedResponse ? `${colors.accent}22` : colors.bgPrimary,
                color: pinnedResponse ? colors.accent : colors.textSecondary,
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              <Pin size={11} />
              {pinnedResponse ? 'Pinned' : 'Pin for Diff'}
            </button>
          )}

          {/* Copy Body */}
          <button
            type="button"
            data-testid="copy-response-btn"
            title="Copy response body"
            onClick={() => void handleCopy()}
            disabled={copyStatus === 'copying'}
            aria-live="polite"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '3px 8px',
              borderRadius: 5,
              border: `1px solid ${colors.border}`,
              backgroundColor: colors.bgPrimary,
              color: colors.textSecondary,
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            <Copy size={11} />
            {copyStatus === 'copied' ? 'Copied!' : copyStatus === 'copying' ? 'Copying...' : 'Copy'}
          </button>

          {/* Phase Timing Breakdown Popover */}
          {showTimingPopover && response.timings && (
            <div
              data-testid="timing-breakdown-popover"
              onMouseLeave={() => setShowTimingPopover(false)}
              style={{
                position: 'absolute',
                top: 30,
                right: 0,
                zIndex: 45,
                backgroundColor: colors.bgSecondary,
                border: `1px solid ${colors.border}`,
                borderRadius: 8,
                padding: 10,
                minWidth: 210,
                boxShadow: '0 10px 25px rgba(0,0,0,0.4)',
                fontSize: 12,
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Phase Timing Breakdown</div>
              <div style={timingRowStyle}>
                <span>DNS Lookup</span>
                <span data-testid="timing-dns">{response.timings.dnsMs} ms</span>
              </div>
              <div style={timingRowStyle}>
                <span>TCP Handshake</span>
                <span data-testid="timing-tcp">{response.timings.tcpMs} ms</span>
              </div>
              <div style={timingRowStyle}>
                <span>TLS Handshake</span>
                <span data-testid="timing-tls">{response.timings.tlsMs} ms</span>
              </div>
              <div style={timingRowStyle}>
                <span>Waiting (TTFB)</span>
                <span data-testid="timing-ttfb">{response.timings.ttfbMs} ms</span>
              </div>
              <div style={timingRowStyle}>
                <span>Content Download</span>
                <span data-testid="timing-download">{response.timings.downloadMs} ms</span>
              </div>
              <div
                style={{
                  ...timingRowStyle,
                  borderTop: `1px solid ${colors.border}`,
                  paddingTop: 4,
                  fontWeight: 700,
                }}
              >
                <span>Total</span>
                <span data-testid="timing-total">{response.timings.totalMs} ms</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {copyError && (
        <div role="alert" style={{ padding: '6px 12px', fontSize: 12, color: colors.danger }}>
          Could not copy response: {copyError}
        </div>
      )}
      {pinnedResponse && (
        <div role="status" style={{ padding: '6px 12px', fontSize: 12, color: colors.textSecondary }}>
          {isCurrentResponsePinned
            ? 'Response pinned. Send another request, then open Diff to compare. Click Pinned to unpin.'
            : 'Diff uses your pinned response as the baseline. Click Pinned to unpin.'}
        </div>
      )}

      {/* Tab Content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {activeTab === 'body' && (
          <>
            {/* Sub-Toolbar: Pretty | Raw | Preview | Diff + JSONPath Filter Bar */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '6px 12px',
                borderBottom: `1px solid ${colors.border}`,
                gap: 10,
                flexWrap: 'wrap',
              }}
            >
              <div style={{ display: 'inline-flex', gap: 4 }}>
                {(['pretty', 'raw', 'preview', 'diff'] as ResponseBodyViewMode[]).map(mode => {
                  const active = bodyView === mode;
                  return (
                    <button
                      key={mode}
                      type="button"
                      data-testid={`resp-body-mode-${mode}`}
                      onClick={() => setBodyView(mode)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '3px 10px',
                        borderRadius: 5,
                        border: `1px solid ${active ? colors.accent : colors.border}`,
                        backgroundColor: active ? `${colors.accent}22` : colors.bgSecondary,
                        color: active ? colors.accent : colors.textSecondary,
                        fontSize: 11,
                        fontWeight: active ? 700 : 500,
                        cursor: 'pointer',
                        textTransform: 'capitalize',
                      }}
                    >
                      {mode === 'diff' && <GitCompare size={11} />}
                      {mode}
                    </button>
                  );
                })}
              </div>

              {/* Live JSONPath Filter Bar */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  flex: 1,
                  maxWidth: 360,
                  padding: '3px 8px',
                  borderRadius: 6,
                  border: `1px solid ${colors.border}`,
                  backgroundColor: colors.bgSecondary,
                }}
              >
                <Filter size={12} color={colors.textSecondary} />
                <input
                  type="text"
                  aria-label="JSONPath Filter"
                  data-testid="response-jsonpath-input"
                  value={jsonPathFilter}
                  placeholder="Filter with JSONPath (e.g. $.data.items[*])"
                  onChange={e => setJsonPathFilter(e.target.value)}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: colors.textPrimary,
                    fontFamily: 'monospace',
                    fontSize: 12,
                    outline: 'none',
                    width: '100%',
                  }}
                />
              </div>
            </div>

            {/* Body Viewer */}
            <div style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
              {bodyView === 'preview' ? (
                response.contentType?.toLowerCase().startsWith('image/') && response.bodyBase64 ? (
                  <div style={{ padding: 16 }}>
                    <img
                      data-testid="response-image-preview"
                      src={`data:${response.contentType};base64,${response.bodyBase64}`}
                      alt="Response preview"
                      style={{ maxWidth: '100%' }}
                    />
                  </div>
                ) : (
                  <iframe
                    title="Response HTML Preview"
                    data-testid="response-html-preview"
                    sandbox=""
                    srcDoc={response.body}
                    style={{
                      width: '100%',
                      height: '100%',
                      border: 'none',
                      backgroundColor: '#ffffff',
                    }}
                  />
                )
              ) : bodyView === 'diff' ? (
                <div
                  data-testid="response-diff-view"
                  style={{ height: '100%', width: '100%' }}
                >
                  {isTestEnv ? (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, padding: 10 }}>
                      <pre data-testid="diff-original-content" style={{ margin: 0, fontSize: 11 }}>
                        {baselineForDiff
                          ? formatPrettyResponseBody(
                              baselineForDiff.body,
                              baselineForDiff.contentType,
                            )
                          : '// No pinned or previous response'}
                      </pre>
                      <pre data-testid="diff-modified-content" style={{ margin: 0, fontSize: 11 }}>
                        {displayedBody}
                      </pre>
                    </div>
                  ) : (
                    <DiffEditor
                      height="100%"
                      language="json"
                      theme={isLight ? 'light' : 'vs-dark'}
                      original={
                        baselineForDiff
                          ? formatPrettyResponseBody(
                              baselineForDiff.body,
                              baselineForDiff.contentType,
                            )
                          : ''
                      }
                      modified={displayedBody}
                      options={{
                        readOnly: true,
                        renderSideBySide: true,
                        minimap: { enabled: false },
                        fontSize: 12,
                      }}
                    />
                  )}
                </div>
              ) : isTestEnv ? (
                <pre
                  data-testid="response-body-content"
                  style={{
                    margin: 0,
                    padding: 12,
                    fontFamily: 'monospace',
                    fontSize: 12,
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {displayedBody}
                </pre>
              ) : (
                <Editor
                  height="100%"
                  language={
                    response.contentType?.includes('json')
                      ? 'json'
                      : response.contentType?.includes('html')
                        ? 'html'
                        : response.contentType?.includes('xml')
                          ? 'xml'
                          : 'plaintext'
                  }
                  theme={isLight ? 'light' : 'vs-dark'}
                  value={displayedBody}
                  options={{
                    readOnly: true,
                    minimap: { enabled: false },
                    fontSize: 12,
                    wordWrap: bodyView === 'raw' ? 'on' : 'off',
                  }}
                />
              )}
            </div>
          </>
        )}

        {activeTab === 'headers' && (
          <div data-testid="response-headers-view" style={{ padding: 12, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr
                  style={{
                    borderBottom: `1px solid ${colors.border}`,
                    color: colors.textSecondary,
                    textAlign: 'left',
                  }}
                >
                  <th style={{ padding: '6px 8px', width: '35%' }}>Header</th>
                  <th style={{ padding: '6px 8px' }}>Value</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(response.headers ?? {}).map(([k, v]) => (
                  <tr
                    key={k}
                    data-testid={`response-header-row-${k}`}
                    style={{ borderBottom: `1px solid ${colors.border}` }}
                  >
                    <td style={{ padding: '6px 8px', fontFamily: 'monospace', fontWeight: 600 }}>
                      {k}
                    </td>
                    <td style={{ padding: '6px 8px', fontFamily: 'monospace' }}>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'cookies' && (
          <div data-testid="response-cookies-view" style={{ padding: 12, overflowY: 'auto' }}>
            {(response.cookies ?? []).length === 0 ? (
              <div style={{ color: colors.textMuted, fontSize: 12 }}>
                No Set-Cookie headers returned in this response.
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr
                    style={{
                      borderBottom: `1px solid ${colors.border}`,
                      color: colors.textSecondary,
                      textAlign: 'left',
                    }}
                  >
                    <th style={{ padding: '6px 8px' }}>Name</th>
                    <th style={{ padding: '6px 8px' }}>Value</th>
                    <th style={{ padding: '6px 8px' }}>Domain</th>
                    <th style={{ padding: '6px 8px' }}>Path</th>
                    <th style={{ padding: '6px 8px' }}>Flags</th>
                  </tr>
                </thead>
                <tbody>
                  {response.cookies.map((cookie, idx) => (
                    <tr
                      key={`${cookie.name}_${idx}`}
                      data-testid={`response-cookie-row-${cookie.name}`}
                      style={{ borderBottom: `1px solid ${colors.border}` }}
                    >
                      <td style={{ padding: '6px 8px', fontFamily: 'monospace', fontWeight: 600 }}>
                        {cookie.name}
                      </td>
                      <td style={{ padding: '6px 8px', fontFamily: 'monospace' }}>
                        {cookie.value}
                      </td>
                      <td style={{ padding: '6px 8px' }}>{cookie.domain ?? '—'}</td>
                      <td style={{ padding: '6px 8px' }}>{cookie.path ?? '/'}</td>
                      <td style={{ padding: '6px 8px' }}>
                        {[
                          cookie.httpOnly ? 'HttpOnly' : null,
                          cookie.secure ? 'Secure' : null,
                          cookie.sameSite ? `SameSite=${cookie.sameSite}` : null,
                        ]
                          .filter(Boolean)
                          .join(', ') || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {activeTab === 'tests' && (
          <div
            data-testid="response-tests-view"
            style={{ padding: 12, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}
          >
            {totalAssertions === 0 ? (
              <div style={{ color: colors.textMuted, fontSize: 12 }}>
                No assertions configured for this request.
              </div>
            ) : (
              <>
                <div
                  data-testid="response-tests-summary"
                  style={{ fontSize: 12, fontWeight: 700 }}
                >
                  {passedAssertions} passed, {totalAssertions - passedAssertions} failed
                </div>
                {response.assertions.map((res, idx) => (
                  <div
                    key={idx}
                    data-testid={`response-assertion-result-${idx}`}
                    data-passed={String(res.passed)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '8px 10px',
                      borderRadius: 6,
                      border: `1px solid ${res.passed ? colors.success : colors.danger}`,
                      backgroundColor: res.passed ? '#14532d22' : '#7f1d1d22',
                      fontSize: 12,
                    }}
                  >
                    {res.passed ? (
                      <CheckCircle2 size={15} color={colors.success} />
                    ) : (
                      <XCircle size={15} color={colors.danger} />
                    )}
                    <span
                      style={{
                        fontWeight: 700,
                        color: res.passed ? colors.success : colors.danger,
                      }}
                    >
                      {res.passed ? 'PASS' : 'FAIL'}
                    </span>
                    <span style={{ fontFamily: 'monospace' }}>{res.message}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {activeTab === 'network' && (
          <div
            data-testid="response-network-view"
            style={{ padding: 12, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12, fontSize: 12 }}
          >
            <div>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Connection Details</div>
              <div style={{ fontFamily: 'monospace', color: colors.textSecondary }}>
                <div>Final URL: {response.finalUrl}</div>
                <div>HTTP Version: HTTP/{response.httpVersion || '1.1'}</div>
                {response.remoteAddress && <div>Remote Address: {response.remoteAddress}</div>}
              </div>
            </div>

            {response.tls && (
              <div data-testid="response-tls-details">
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    fontWeight: 700,
                    marginBottom: 4,
                  }}
                >
                  <Lock size={13} color={colors.success} />
                  TLS Certificate &amp; Cipher
                </div>
                <div style={{ fontFamily: 'monospace', color: colors.textSecondary }}>
                  <div>Protocol: {response.tls.protocol}</div>
                  <div>Cipher: {response.tls.cipher}</div>
                  <div>Subject: {response.tls.subject}</div>
                  <div>Issuer: {response.tls.issuer}</div>
                  <div>
                    Valid: {response.tls.validFrom} &rarr; {response.tls.validTo}
                  </div>
                </div>
              </div>
            )}

            {(response.redirects ?? []).length > 0 && (
              <div data-testid="response-redirects-chain">
                <div style={{ fontWeight: 700, marginBottom: 4 }}>
                  Redirect Chain ({response.redirects.length})
                </div>
                {response.redirects.map((hop, idx) => (
                  <div key={idx} style={{ fontFamily: 'monospace', fontSize: 11 }}>
                    {hop.statusCode} {hop.fromUrl} &rarr; {hop.toUrl} ({hop.durationMs} ms)
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

function sectionTabStyle(
  active: boolean,
  colors: { accent: string; textPrimary: string; textSecondary: string },
): React.CSSProperties {
  return {
    padding: '4px 10px',
    borderRadius: 5,
    border: 'none',
    backgroundColor: active ? `${colors.accent}22` : 'transparent',
    color: active ? colors.accent : colors.textSecondary,
    fontSize: 12,
    fontWeight: active ? 700 : 500,
    cursor: 'pointer',
  };
}

const timingRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  fontFamily: 'monospace',
};
