import React, { useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Download,
  Play,
  Square,
  X,
  XCircle,
} from 'lucide-react';
import type {
  AuthConfig,
  AwjcCollection,
  CollectionTreeItem,
  FolderItem,
  KeyValueEntry,
  RequestItem,
  VariableEntry,
} from '../../../shared/collectionSchema';
import type {
  AssertionEvaluationResult,
  CapturedVariableResult,
  HttpResponseResult,
} from '../../../shared/httpTypes';
import { useTheme } from '../context/ThemeContext';

export interface RunnableRequestStep {
  request: RequestItem;
  folderPath: string[];
  inheritedHeaders: KeyValueEntry[];
  ancestorAuthChain: Array<AuthConfig | undefined>;
  folderVariablesChain: VariableEntry[][];
}

export interface RunnerStepResult {
  requestId: string;
  requestName: string;
  method: string;
  protocol: 'http' | 'graphql';
  url: string;
  folderPath: string[];
  status: number;
  ok: boolean;
  passed: boolean;
  durationMs: number;
  error?: string;
  captures: CapturedVariableResult[];
  assertions: AssertionEvaluationResult[];
}

export interface CollectionRunReport {
  collectionName: string;
  scopeLabel: string;
  environmentName: string;
  startedAt: string;
  completedAt: string;
  totalRequests: number;
  passedRequests: number;
  failedRequests: number;
  totalAssertions: number;
  passedAssertions: number;
  failedAssertions: number;
  totalDurationMs: number;
  steps: RunnerStepResult[];
}

export interface CollectionRunnerModalProps {
  isOpen: boolean;
  collection: AwjcCollection;
  initialFolderId?: string | null;
  initialCapturedVariables?: VariableEntry[];
  onUpdateCapturedVariables?: (captured: VariableEntry[]) => void;
  onExportReportJson?: (json: string, report: CollectionRunReport) => void;
  onClose: () => void;
}

interface FolderOption {
  id: string;
  label: string;
  folder: FolderItem;
  inheritedHeaders: KeyValueEntry[];
  ancestorAuthChain: Array<AuthConfig | undefined>;
  folderVariablesChain: VariableEntry[][];
}

function collectFolderOptions(
  items: CollectionTreeItem[],
  parentPath: string[] = [],
  inheritedHeaders: KeyValueEntry[] = [],
  ancestorAuthChain: Array<AuthConfig | undefined> = [],
  folderVariablesChain: VariableEntry[][] = [],
): FolderOption[] {
  const result: FolderOption[] = [];
  for (const item of items) {
    if (item.kind === 'folder') {
      const currentPath = [...parentPath, item.name];
      const nextHeaders = [...inheritedHeaders, ...(item.headers ?? [])];
      const nextAuth = [item.auth, ...ancestorAuthChain];
      const nextVars = item.variables
        ? [...folderVariablesChain, item.variables]
        : folderVariablesChain;

      result.push({
        id: item.id,
        label: currentPath.join(' / '),
        folder: item,
        inheritedHeaders: nextHeaders,
        ancestorAuthChain: nextAuth,
        folderVariablesChain: nextVars,
      });

      result.push(
        ...collectFolderOptions(
          item.items,
          currentPath,
          nextHeaders,
          nextAuth,
          nextVars,
        ),
      );
    }
  }
  return result;
}

export function flattenRunnableRequests(
  items: CollectionTreeItem[],
  folderPath: string[] = [],
  inheritedHeaders: KeyValueEntry[] = [],
  ancestorAuthChain: Array<AuthConfig | undefined> = [],
  folderVariablesChain: VariableEntry[][] = [],
): RunnableRequestStep[] {
  const steps: RunnableRequestStep[] = [];
  for (const item of items) {
    if (item.kind === 'request') {
      steps.push({
        request: item,
        folderPath,
        inheritedHeaders,
        ancestorAuthChain,
        folderVariablesChain,
      });
    } else if (item.kind === 'folder') {
      const nextPath = [...folderPath, item.name];
      const nextHeaders = [...inheritedHeaders, ...(item.headers ?? [])];
      const nextAuth = [item.auth, ...ancestorAuthChain];
      const nextVars = item.variables
        ? [...folderVariablesChain, item.variables]
        : folderVariablesChain;
      steps.push(
        ...flattenRunnableRequests(
          item.items,
          nextPath,
          nextHeaders,
          nextAuth,
          nextVars,
        ),
      );
    }
  }
  return steps;
}

export const CollectionRunnerModal: React.FC<CollectionRunnerModalProps> = ({
  isOpen,
  collection,
  initialFolderId = null,
  initialCapturedVariables = [],
  onUpdateCapturedVariables,
  onExportReportJson,
  onClose,
}) => {
  const { colors, isLight } = useTheme();
  const [selectedScope, setSelectedScope] = useState<string>(
    initialFolderId ? `folder:${initialFolderId}` : '__ALL__',
  );
  const [selectedEnvName, setSelectedEnvName] = useState<string>(
    collection.activeEnvironment ?? collection.environments?.[0]?.name ?? '',
  );
  const [delayMs, setDelayMs] = useState<number>(0);
  const [stopOnFailure, setStopOnFailure] = useState<boolean>(false);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [report, setReport] = useState<CollectionRunReport | null>(null);
  const [exportedJsonText, setExportedJsonText] = useState<string | null>(null);
  const abortRunRef = useRef<boolean>(false);

  const folderOptions = useMemo(
    () =>
      collectFolderOptions(
        collection.items,
        [],
        collection.defaults?.headers ?? [],
        [],
        [],
      ),
    [collection],
  );

  const runnableSteps = useMemo<RunnableRequestStep[]>(() => {
    if (selectedScope.startsWith('folder:')) {
      const folderId = selectedScope.slice('folder:'.length);
      const found = folderOptions.find(f => f.id === folderId);
      if (found) {
        return flattenRunnableRequests(
          found.folder.items,
          [found.label],
          found.inheritedHeaders,
          found.ancestorAuthChain,
          found.folderVariablesChain,
        );
      }
    }
    return flattenRunnableRequests(
      collection.items,
      [],
      collection.defaults?.headers ?? [],
      [],
      [],
    );
  }, [collection, selectedScope, folderOptions]);

  if (!isOpen) return null;

  const handleStartRun = async () => {
    if (!window.electronAPI?.sendHttpRequest || isRunning) return;
    abortRunRef.current = false;
    setIsRunning(true);
    setExportedJsonText(null);

    const startedAt = new Date().toISOString();
    const workingCaptured: VariableEntry[] = [...initialCapturedVariables];
    const stepResults: RunnerStepResult[] = [];

    const activeEnv = (collection.environments ?? []).find(
      e => e.name === selectedEnvName,
    );

    const scopeLabel =
      selectedScope === '__ALL__'
        ? `Collection: ${collection.metadata.name}`
        : `Folder: ${
            folderOptions.find(f => `folder:${f.id}` === selectedScope)?.label ?? ''
          }`;

    for (let i = 0; i < runnableSteps.length; i++) {
      if (abortRunRef.current) break;

      const step = runnableSteps[i];
      const req = step.request;

      let response: HttpResponseResult;
      try {
        response = await window.electronAPI.sendHttpRequest({
          requestId: `runner_${req.id}_${i}`,
          protocol: req.protocol,
          method: req.method,
          url: req.url,
          queryParams: req.queryParams,
          pathParams: req.pathParams,
          headers: req.headers,
          inheritedHeaders: step.inheritedHeaders,
          auth: req.auth,
          ancestorAuthChain: step.ancestorAuthChain,
          collectionDefaultAuth: collection.defaults?.auth,
          authProfiles: collection.authProfiles,
          body: req.body,
          graphql: req.graphql,
          captures: req.captures,
          assertions: req.assertions,
          interpolationContext: {
            collectionVariables: collection.variables ?? [],
            environmentVariables: activeEnv?.variables ?? [],
            folderVariablesChain: step.folderVariablesChain,
            capturedVariables: [...workingCaptured],
          },
          collectionId: collection.metadata.id,
          environmentId: selectedEnvName || undefined,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        stepResults.push({
          requestId: req.id,
          requestName: req.name,
          method: req.method,
          protocol: req.protocol,
          url: req.url,
          folderPath: step.folderPath,
          status: 0,
          ok: false,
          passed: false,
          durationMs: 0,
          error: msg,
          captures: [],
          assertions: [],
        });
        if (stopOnFailure) break;
        continue;
      }

      // Apply post-response captures for subsequent requests in the sequence
      if (Array.isArray(response.captures)) {
        for (const cap of response.captures) {
          if (cap.matched && cap.value !== null) {
            const idx = workingCaptured.findIndex(v => v.key === cap.variable);
            const entry: VariableEntry = {
              key: cap.variable,
              value: cap.value,
              enabled: true,
              secret: cap.secret,
            };
            if (idx !== -1) {
              workingCaptured[idx] = entry;
            } else {
              workingCaptured.push(entry);
            }
          }
        }
      }

      const assertions = response.assertions ?? [];
      const anyFailedAssertion = assertions.some(a => !a.passed);
      const stepPassed = Boolean(response.ok) && !anyFailedAssertion;

      stepResults.push({
        requestId: req.id,
        requestName: req.name,
        method: req.method,
        protocol: req.protocol,
        url: req.url,
        folderPath: step.folderPath,
        status: response.status,
        ok: response.ok,
        passed: stepPassed,
        durationMs: response.timings?.totalMs ?? 0,
        error: response.error,
        captures: response.captures ?? [],
        assertions,
      });

      if (stopOnFailure && !stepPassed) {
        break;
      }

      if (delayMs > 0 && i < runnableSteps.length - 1 && !abortRunRef.current) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    onUpdateCapturedVariables?.(workingCaptured);

    const completedAt = new Date().toISOString();
    const passedRequests = stepResults.filter(s => s.passed).length;
    const failedRequests = stepResults.length - passedRequests;
    const allAssertions = stepResults.flatMap(s => s.assertions);
    const passedAssertions = allAssertions.filter(a => a.passed).length;
    const failedAssertions = allAssertions.length - passedAssertions;
    const totalDurationMs = stepResults.reduce((acc, s) => acc + s.durationMs, 0);

    setReport({
      collectionName: collection.metadata.name,
      scopeLabel,
      environmentName: selectedEnvName || 'None',
      startedAt,
      completedAt,
      totalRequests: stepResults.length,
      passedRequests,
      failedRequests,
      totalAssertions: allAssertions.length,
      passedAssertions,
      failedAssertions,
      totalDurationMs,
      steps: stepResults,
    });
    setIsRunning(false);
  };

  const handleExportJson = async () => {
    if (!report) return;
    const serialized = JSON.stringify(report, null, 2);
    setExportedJsonText(serialized);
    if (window.electronAPI?.copyToClipboard) {
      await window.electronAPI.copyToClipboard(serialized);
    }
    onExportReportJson?.(serialized, report);
  };

  return (
    <div
      data-testid="collection-runner-modal-backdrop"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 185,
        backgroundColor: 'rgba(0, 0, 0, 0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Collection Runner"
        data-testid="collection-runner-modal"
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 860,
          maxHeight: '88vh',
          backgroundColor: colors.bgPrimary,
          border: `1px solid ${colors.border}`,
          borderRadius: 10,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.45)',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderBottom: `1px solid ${colors.border}`,
            backgroundColor: colors.bgSecondary,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Play size={16} color={colors.accent} />
            <span style={{ fontWeight: 700, fontSize: 14, color: colors.textPrimary }}>
              Collection / Folder Runner — {collection.metadata.name}
            </span>
          </div>
          <button
            type="button"
            data-testid="close-runner-modal-btn"
            aria-label="Close Runner Modal"
            onClick={onClose}
            style={{
              border: 'none',
              background: 'transparent',
              color: colors.textSecondary,
              cursor: 'pointer',
              padding: 4,
              display: 'inline-flex',
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Runner Configuration Controls */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '12px 16px',
            borderBottom: `1px solid ${colors.border}`,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            {/* Target Scope */}
            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 12,
                color: colors.textSecondary,
              }}
            >
              Target:
              <select
                aria-label="Runner Target Scope"
                data-testid="runner-scope-select"
                value={selectedScope}
                onChange={e => setSelectedScope(e.target.value)}
                disabled={isRunning}
                style={{
                  padding: '5px 8px',
                  borderRadius: 6,
                  border: `1px solid ${colors.border}`,
                  backgroundColor: colors.bgSecondary,
                  color: colors.textPrimary,
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                <option value="__ALL__">
                  Entire Collection ({collection.metadata.name})
                </option>
                {folderOptions.map(f => (
                  <option key={f.id} value={`folder:${f.id}`}>
                    Folder: {f.label}
                  </option>
                ))}
              </select>
            </label>

            {/* Target Environment */}
            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 12,
                color: colors.textSecondary,
              }}
            >
              Environment:
              <select
                aria-label="Runner Environment"
                data-testid="runner-env-select"
                value={selectedEnvName}
                onChange={e => setSelectedEnvName(e.target.value)}
                disabled={isRunning}
                style={{
                  padding: '5px 8px',
                  borderRadius: 6,
                  border: `1px solid ${colors.border}`,
                  backgroundColor: colors.bgSecondary,
                  color: colors.textPrimary,
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                <option value="">No Environment</option>
                {(collection.environments ?? []).map(env => (
                  <option key={env.id || env.name} value={env.name}>
                    {env.name}
                  </option>
                ))}
              </select>
            </label>

            {/* Delay (ms) */}
            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 12,
                color: colors.textSecondary,
              }}
            >
              Delay (ms):
              <input
                type="number"
                min={0}
                step={50}
                aria-label="Delay between requests in ms"
                data-testid="runner-delay-input"
                value={delayMs}
                onChange={e => setDelayMs(Math.max(0, Number(e.target.value) || 0))}
                disabled={isRunning}
                style={{
                  width: 72,
                  padding: '5px 8px',
                  borderRadius: 6,
                  border: `1px solid ${colors.border}`,
                  backgroundColor: colors.bgSecondary,
                  color: colors.textPrimary,
                  fontSize: 12,
                }}
              />
            </label>

            {/* Stop on Failure */}
            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 12,
                color: colors.textPrimary,
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                data-testid="runner-stop-on-failure-checkbox"
                checked={stopOnFailure}
                onChange={e => setStopOnFailure(e.target.checked)}
                disabled={isRunning}
              />
              Stop on failure
            </label>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {report && (
              <button
                type="button"
                data-testid="export-runner-report-json-btn"
                onClick={() => void handleExportJson()}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 12px',
                  borderRadius: 6,
                  border: `1px solid ${colors.border}`,
                  backgroundColor: colors.bgSecondary,
                  color: colors.textPrimary,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                <Download size={13} />
                Export JSON
              </button>
            )}

            {isRunning ? (
              <button
                type="button"
                data-testid="stop-collection-run-btn"
                onClick={() => {
                  abortRunRef.current = true;
                }}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 14px',
                  borderRadius: 6,
                  border: 'none',
                  backgroundColor: colors.danger,
                  color: '#ffffff',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                <Square size={13} />
                Stop
              </button>
            ) : (
              <button
                type="button"
                data-testid="start-collection-run-btn"
                disabled={runnableSteps.length === 0}
                onClick={() => void handleStartRun()}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 14px',
                  borderRadius: 6,
                  border: 'none',
                  backgroundColor: colors.accent,
                  color: '#ffffff',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: runnableSteps.length === 0 ? 'not-allowed' : 'pointer',
                  opacity: runnableSteps.length === 0 ? 0.5 : 1,
                }}
              >
                <Play size={13} />
                Run ({runnableSteps.length})
              </button>
            )}
          </div>
        </div>

        {/* Results Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {!report ? (
            <div
              data-testid="runner-idle-preview"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                fontSize: 12,
                color: colors.textSecondary,
              }}
            >
              <div>
                Ready to execute <strong>{runnableSteps.length}</strong> request(s) sequentially.
              </div>
              <ol style={{ margin: 0, paddingLeft: 20 }}>
                {runnableSteps.map(s => (
                  <li key={s.request.id} style={{ padding: '2px 0' }}>
                    <strong>{s.request.method}</strong> {s.request.name}{' '}
                    <span style={{ opacity: 0.75 }}>({s.request.url})</span>
                  </li>
                ))}
              </ol>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Aggregate Summary Banner */}
              <div
                data-testid="runner-summary"
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                  gap: 10,
                  padding: 12,
                  borderRadius: 8,
                  backgroundColor: colors.bgSecondary,
                  border: `1px solid ${colors.border}`,
                  fontSize: 12,
                }}
              >
                <div>
                  <div style={{ color: colors.textSecondary }}>Requests Executed</div>
                  <div
                    data-testid="runner-total-requests"
                    style={{ fontSize: 16, fontWeight: 700 }}
                  >
                    {report.totalRequests}
                  </div>
                </div>
                <div>
                  <div style={{ color: colors.textSecondary }}>Requests Passed</div>
                  <div
                    data-testid="runner-passed-requests"
                    style={{ fontSize: 16, fontWeight: 700, color: colors.success }}
                  >
                    {report.passedRequests}
                  </div>
                </div>
                <div>
                  <div style={{ color: colors.textSecondary }}>Requests Failed</div>
                  <div
                    data-testid="runner-failed-requests"
                    style={{ fontSize: 16, fontWeight: 700, color: colors.danger }}
                  >
                    {report.failedRequests}
                  </div>
                </div>
                <div>
                  <div style={{ color: colors.textSecondary }}>Assertions (Pass / Fail)</div>
                  <div
                    data-testid="runner-assertions-summary"
                    style={{ fontSize: 16, fontWeight: 700 }}
                  >
                    {report.passedAssertions} / {report.failedAssertions}
                  </div>
                </div>
                <div>
                  <div style={{ color: colors.textSecondary }}>Total Duration</div>
                  <div
                    data-testid="runner-total-duration"
                    style={{ fontSize: 16, fontWeight: 700 }}
                  >
                    {Math.round(report.totalDurationMs)} ms
                  </div>
                </div>
              </div>

              {/* Per-Step Results */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {report.steps.map((step, idx) => (
                  <div
                    key={`${step.requestId}_${idx}`}
                    data-testid={`runner-step-result-${step.requestId}`}
                    style={{
                      padding: '10px 12px',
                      borderRadius: 8,
                      border: `1px solid ${
                        step.passed ? colors.border : colors.danger
                      }`,
                      backgroundColor: isLight ? '#ffffff' : '#111827',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                      fontSize: 12,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {step.passed ? (
                          <CheckCircle2 size={15} color={colors.success} />
                        ) : (
                          <XCircle size={15} color={colors.danger} />
                        )}
                        <span
                          data-testid={`runner-step-badge-${step.requestId}`}
                          style={{
                            fontWeight: 700,
                            fontSize: 11,
                            color: step.passed ? colors.success : colors.danger,
                          }}
                        >
                          {step.passed ? 'PASS' : 'FAIL'}
                        </span>
                        <span style={{ fontWeight: 700 }}>{step.method}</span>
                        <span>{step.requestName}</span>
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          color: colors.textSecondary,
                          fontSize: 11,
                        }}
                      >
                        <span>Status: {step.status}</span>
                        <span>{Math.round(step.durationMs)} ms</span>
                      </div>
                    </div>

                    {step.captures.filter(c => c.matched).length > 0 && (
                      <div
                        data-testid={`runner-step-captures-${step.requestId}`}
                        style={{ fontSize: 11, color: colors.accent }}
                      >
                        Captured:{' '}
                        {step.captures
                          .filter(c => c.matched)
                          .map(c => `${c.variable}=${c.secret ? '••••' : c.value}`)
                          .join(', ')}
                      </div>
                    )}

                    {step.assertions.length > 0 && (
                      <ul
                        style={{
                          margin: 0,
                          paddingLeft: 18,
                          fontSize: 11,
                          color: colors.textSecondary,
                        }}
                      >
                        {step.assertions.map((assertion, aIdx) => (
                          <li
                            key={aIdx}
                            style={{
                              color: assertion.passed ? colors.success : colors.danger,
                            }}
                          >
                            {assertion.message}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>

              {exportedJsonText && (
                <pre
                  data-testid="runner-exported-json-preview"
                  style={{
                    margin: 0,
                    padding: 12,
                    borderRadius: 8,
                    backgroundColor: colors.bgSecondary,
                    border: `1px solid ${colors.border}`,
                    fontSize: 11,
                    fontFamily: 'monospace',
                    maxHeight: 200,
                    overflow: 'auto',
                  }}
                >
                  {exportedJsonText}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
