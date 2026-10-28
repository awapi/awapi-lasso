import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Settings, Sparkles, Square, Trash2, X } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { AI_PROVIDERS, type AiChatContext } from '../../../shared/aiTypes';
import { useAiChat, type ToolActivity, type UiChatMessage } from '../useAiChat';
import { useAiApprovals } from '../useAiApprovals';
import { executeAiTool, type AiToolHost, type AiToolWorkspace } from '../aiToolHost';
import { AiSettingsModal } from './AiSettingsModal';

export const AI_PANEL_WIDTH_STORAGE_KEY = 'awapilasso.aiPanelWidth';
export const AI_PANEL_MIN_WIDTH = 300;
export const AI_PANEL_MAX_WIDTH = 720;
export const AI_PANEL_DEFAULT_WIDTH = 380;

export interface MessageBlock {
  type: 'text' | 'code';
  content: string;
  lang?: string;
}

/** Splits assistant text into prose and fenced code blocks; an unterminated fence (mid-stream) counts as code. */
export function parseMessageBlocks(text: string): MessageBlock[] {
  const blocks: MessageBlock[] = [];
  const fence = /```([^\n`]*)\n?/g;
  let cursor = 0;
  let open: { lang: string; start: number } | null = null;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(text)) !== null) {
    if (!open) {
      if (match.index > cursor) blocks.push({ type: 'text', content: text.slice(cursor, match.index) });
      open = { lang: match[1].trim(), start: fence.lastIndex };
    } else {
      blocks.push({
        type: 'code',
        lang: open.lang || undefined,
        content: text.slice(open.start, match.index).replace(/\n$/, ''),
      });
      cursor = fence.lastIndex;
      open = null;
    }
  }
  if (open) {
    blocks.push({ type: 'code', lang: open.lang || undefined, content: text.slice(open.start) });
  } else if (cursor < text.length) {
    blocks.push({ type: 'text', content: text.slice(cursor) });
  }
  return blocks.filter(b => b.type === 'code' || b.content.trim() !== '');
}

function clampWidth(width: number): number {
  return Math.max(AI_PANEL_MIN_WIDTH, Math.min(AI_PANEL_MAX_WIDTH, Math.round(width)));
}

function readStoredWidth(): number {
  try {
    const raw = window.localStorage?.getItem(AI_PANEL_WIDTH_STORAGE_KEY);
    const parsed = raw ? Number(raw) : NaN;
    if (Number.isFinite(parsed)) return clampWidth(parsed);
  } catch {
    // ignore storage failures
  }
  return AI_PANEL_DEFAULT_WIDTH;
}

const QUICK_ACTIONS: Array<{ id: string; label: string; prompt: string }> = [
  {
    id: 'explain-error',
    label: 'Explain this error',
    prompt: 'Why did the last response fail? Explain the likely cause and how to fix the request.',
  },
  {
    id: 'graphql-from-sample',
    label: 'GraphQL from sample output',
    prompt:
      'Write a GraphQL query that returns data shaped like the sample output I will paste next. Ask me for the sample if I have not given it yet.',
  },
  {
    id: 'improve-request',
    label: 'Review this request',
    prompt: 'Review the active request and suggest improvements (headers, body, auth, naming).',
  },
];

export interface AiChatPanelProps {
  open: boolean;
  onClose: () => void;
  /** Returns raw workspace context for the next message; secrets are scrubbed in the Main process. */
  getContext: () => AiChatContext | undefined;
  /** Lets the assistant read and edit the workspace (with approval). Omit for chat-only. */
  workspace?: AiToolWorkspace;
}

const TOOL_LABELS: Record<string, string> = {
  get_workspace_overview: 'Looked at the workspace',
  get_request: 'Read a request',
  get_response: 'Read the response',
  list_environments: 'Read environments',
  list_collection_items: 'Read collection items',
  get_graphql_schema: 'Read the GraphQL schema',
  validate_graphql_query: 'Validated a GraphQL query',
  open_request: 'Opened a request',
  update_request: 'Edited a request',
  create_request: 'Created a request',
  set_environment_variables: 'Edited variables',
  send_request: 'Sent the request',
};

const ToolChips: React.FC<{ tools: ToolActivity[]; colors: ReturnType<typeof useTheme>['colors'] }> = ({
  tools,
  colors,
}) => (
  <div data-testid="ai-tool-activity" style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
    {tools.map(t => (
      <span
        key={t.id}
        data-testid={`ai-tool-${t.status}`}
        style={{
          fontSize: 11,
          padding: '1px 6px',
          borderRadius: 10,
          border: `1px solid ${t.status === 'error' || t.status === 'declined' ? colors.danger : colors.border}`,
          color: t.status === 'error' || t.status === 'declined' ? colors.danger : colors.textSecondary,
        }}
      >
        {t.status === 'running' ? '… ' : t.status === 'done' ? '✓ ' : t.status === 'declined' ? '✗ declined: ' : '! '}
        {TOOL_LABELS[t.name] ?? t.name}
      </span>
    ))}
  </div>
);

const CodeBlock: React.FC<{ block: MessageBlock; colors: ReturnType<typeof useTheme>['colors'] }> = ({
  block,
  colors,
}) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    void window.electronAPI?.copyToClipboard?.(block.content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };
  return (
    <div
      data-testid="ai-code-block"
      style={{
        border: `1px solid ${colors.border}`,
        borderRadius: 6,
        margin: '8px 0',
        backgroundColor: colors.bgPrimary,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '2px 8px',
          fontSize: 11,
          color: colors.textMuted,
          borderBottom: `1px solid ${colors.border}`,
        }}
      >
        <span>{block.lang ?? 'code'}</span>
        <button
          type="button"
          data-testid="ai-copy-code-btn"
          onClick={handleCopy}
          style={{
            background: 'none',
            border: 'none',
            color: colors.accent,
            cursor: 'pointer',
            fontSize: 11,
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre
        style={{
          margin: 0,
          padding: 8,
          fontSize: 12,
          overflowX: 'auto',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        }}
      >
        {block.content}
      </pre>
    </div>
  );
};

const MessageView: React.FC<{ message: UiChatMessage; streaming: boolean; colors: ReturnType<typeof useTheme>['colors'] }> = ({
  message,
  streaming,
  colors,
}) => {
  const isUser = message.role === 'user';
  return (
    <div
      data-testid={`ai-message-${message.role}`}
      style={{
        alignSelf: isUser ? 'flex-end' : 'stretch',
        maxWidth: isUser ? '90%' : '100%',
        padding: '8px 10px',
        borderRadius: 8,
        fontSize: 13,
        lineHeight: 1.5,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        backgroundColor: isUser ? colors.accent : colors.bgSecondary,
        color: message.error ? colors.danger : isUser ? '#fff' : colors.textPrimary,
        border: `1px solid ${message.error ? colors.danger : isUser ? colors.accent : colors.border}`,
      }}
    >
      {message.role === 'assistant' && !message.error ? (
        <>
          {parseMessageBlocks(message.content).map((block, i) =>
            block.type === 'code' ? (
              <CodeBlock key={i} block={block} colors={colors} />
            ) : (
              <span key={i}>{block.content}</span>
            ),
          )}
          {streaming && message.content === '' && <span style={{ color: colors.textMuted }}>Thinking…</span>}
          {message.tools && message.tools.length > 0 && <ToolChips tools={message.tools} colors={colors} />}
          {message.cancelled && <div style={{ color: colors.textMuted, fontSize: 11 }}>Stopped</div>}
        </>
      ) : (
        message.content
      )}
    </div>
  );
};

export const AiChatPanel: React.FC<AiChatPanelProps> = ({ open, onClose, getContext, workspace }) => {
  const { colors } = useTheme();
  const approvals = useAiApprovals();
  const { request: requestApproval, declineAll } = approvals;
  const host = useMemo<AiToolHost | null>(
    () =>
      workspace
        ? {
            workspace,
            requestApproval,
            getApprovalPolicy: async () => {
              const settings = await window.electronAPI?.aiGetSettings?.();
              return {
                autoApplyEdits: settings?.autoApplyEdits ?? false,
                confirmBeforeRun: settings?.confirmBeforeRun ?? true,
                shareEnvironmentValues: settings?.shareEnvironmentValues ?? true,
              };
            },
          }
        : null,
    [workspace, requestApproval],
  );
  const executeTool = useMemo(
    () => (host ? (call: Parameters<typeof executeAiTool>[0]) => executeAiTool(call, host) : undefined),
    [host],
  );
  const { messages, isStreaming, send, stop, clear } = useAiChat({
    getContext,
    executeTool,
    onTurnEnd: declineAll,
  });
  const [draft, setDraft] = useState('');
  const [width, setWidth] = useState<number>(readStoredWidth);
  const [dragging, setDragging] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [providerLabel, setProviderLabel] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef({ x: 0, width: 0 });

  const refreshStatus = useCallback(async () => {
    const api = window.electronAPI;
    if (!api?.aiGetSettings) {
      setConfigured(false);
      return;
    }
    try {
      const [settings, statuses] = await Promise.all([api.aiGetSettings(), api.aiGetKeyStatuses()]);
      const info = AI_PROVIDERS[settings.provider];
      const hasKey = statuses.find(s => s.provider === settings.provider)?.hasKey ?? false;
      setConfigured(hasKey || info.keyOptional);
      setProviderLabel(`${info.label} · ${settings.models[settings.provider]}`);
    } catch {
      setConfigured(false);
    }
  }, []);

  useEffect(() => {
    if (open) void refreshStatus();
  }, [open, refreshStatus]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      // Panel is docked on the right, so dragging left grows it.
      setWidth(clampWidth(dragStartRef.current.width - (e.clientX - dragStartRef.current.x)));
    };
    const onUp = () => setDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging]);

  useEffect(() => {
    try {
      window.localStorage?.setItem(AI_PANEL_WIDTH_STORAGE_KEY, String(width));
    } catch {
      // ignore storage failures
    }
  }, [width]);

  const submit = (text: string) => {
    if (!text.trim() || isStreaming) return;
    setDraft('');
    void send(text);
  };

  const iconButton: React.CSSProperties = {
    background: 'none',
    border: 'none',
    color: colors.textSecondary,
    cursor: 'pointer',
    padding: 4,
    display: 'inline-flex',
  };

  return (
    <aside
      data-testid="ai-chat-panel"
      aria-label="AI assistant"
      aria-hidden={!open}
      style={{
        display: open ? 'flex' : 'none',
        flexDirection: 'row',
        width,
        flexShrink: 0,
        backgroundColor: colors.bgSecondary,
        color: colors.textPrimary,
        borderLeft: `1px solid ${colors.border}`,
        position: 'relative',
        minHeight: 0,
      }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        data-testid="ai-chat-resizer"
        title="Drag to resize • Double-click to reset"
        onMouseDown={e => {
          e.preventDefault();
          dragStartRef.current = { x: e.clientX, width };
          setDragging(true);
        }}
        onDoubleClick={() => setWidth(AI_PANEL_DEFAULT_WIDTH)}
        style={{
          position: 'absolute',
          left: -3,
          top: 0,
          bottom: 0,
          width: 6,
          cursor: 'col-resize',
          zIndex: 2,
          backgroundColor: dragging ? colors.accent : 'transparent',
        }}
      />

      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 10px',
            borderBottom: `1px solid ${colors.border}`,
          }}
        >
          <Sparkles size={14} color={colors.accent} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>AI Assistant</div>
            {providerLabel && configured && (
              <div
                data-testid="ai-provider-label"
                style={{
                  fontSize: 11,
                  color: colors.textMuted,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {providerLabel}
              </div>
            )}
          </div>
          <button type="button" aria-label="Clear conversation" title="Clear conversation" data-testid="ai-clear-btn" onClick={clear} style={iconButton}>
            <Trash2 size={14} />
          </button>
          <button type="button" aria-label="AI settings" title="AI settings" data-testid="ai-open-settings-btn" onClick={() => setSettingsOpen(true)} style={iconButton}>
            <Settings size={14} />
          </button>
          <button type="button" aria-label="Close AI assistant" title="Close" data-testid="ai-close-btn" onClick={onClose} style={iconButton}>
            <X size={14} />
          </button>
        </header>

        <div
          ref={scrollRef}
          data-testid="ai-messages"
          style={{ flex: 1, overflowY: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}
        >
          {configured === false && (
            <div data-testid="ai-onboarding" style={{ fontSize: 13, lineHeight: 1.5, color: colors.textSecondary }}>
              <p style={{ marginTop: 0 }}>
                Chat with an AI about your requests, responses and GraphQL queries. Add your own API key
                (OpenAI, Claude, or any OpenAI-compatible server such as Ollama).
              </p>
              <p>
                Your key is stored in the OS Keychain. Messages include the active request and last response,
                with secrets and auth headers removed, and go straight to the provider you pick.
              </p>
              <button
                type="button"
                data-testid="ai-setup-btn"
                onClick={() => setSettingsOpen(true)}
                style={{
                  padding: '6px 14px',
                  borderRadius: 4,
                  border: `1px solid ${colors.accent}`,
                  backgroundColor: colors.accent,
                  color: '#fff',
                  cursor: 'pointer',
                  fontSize: 13,
                }}
              >
                Set up AI
              </button>
            </div>
          )}

          {configured && messages.length === 0 && (
            <div data-testid="ai-quick-actions" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 12, color: colors.textMuted }}>Try one of these or ask anything:</div>
              {QUICK_ACTIONS.map(action => (
                <button
                  key={action.id}
                  type="button"
                  data-testid={`ai-quick-${action.id}`}
                  onClick={() => submit(action.prompt)}
                  style={{
                    textAlign: 'left',
                    padding: '6px 10px',
                    borderRadius: 6,
                    border: `1px solid ${colors.border}`,
                    backgroundColor: colors.bgPrimary,
                    color: colors.textPrimary,
                    cursor: 'pointer',
                    fontSize: 12,
                  }}
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}

          {messages.map((m, i) => (
            <MessageView key={m.id} message={m} streaming={isStreaming && i === messages.length - 1} colors={colors} />
          ))}
        </div>

        {approvals.pending.length > 0 && (
          <div
            data-testid="ai-approvals"
            style={{ borderTop: `1px solid ${colors.border}`, padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}
          >
            {approvals.pending.map(p => (
              <div
                key={p.id}
                data-testid="ai-approval"
                style={{
                  border: `1px solid ${p.risk === 'run' || p.warning ? colors.warning : colors.accent}`,
                  borderRadius: 6,
                  padding: 8,
                  backgroundColor: colors.bgPrimary,
                  fontSize: 12,
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 4, wordBreak: 'break-word' }}>{p.title}</div>
                {p.warning && (
                  <div
                    data-testid="ai-approval-warning"
                    role="alert"
                    style={{ color: colors.warning, marginBottom: 4, wordBreak: 'break-word' }}
                  >
                    ⚠ {p.warning}
                  </div>
                )}
                <ul style={{ margin: '0 0 8px', paddingLeft: 16, color: colors.textSecondary, wordBreak: 'break-word' }}>
                  {p.lines.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    data-testid="ai-approve-btn"
                    onClick={() => approvals.resolve(p.id, true)}
                    style={{
                      padding: '4px 12px',
                      borderRadius: 4,
                      border: `1px solid ${colors.accent}`,
                      backgroundColor: colors.accent,
                      color: '#fff',
                      cursor: 'pointer',
                      fontSize: 12,
                    }}
                  >
                    {p.risk === 'run' ? 'Send' : 'Apply'}
                  </button>
                  <button
                    type="button"
                    data-testid="ai-decline-btn"
                    onClick={() => approvals.resolve(p.id, false)}
                    style={{
                      padding: '4px 12px',
                      borderRadius: 4,
                      border: `1px solid ${colors.border}`,
                      backgroundColor: colors.bgSecondary,
                      color: colors.textPrimary,
                      cursor: 'pointer',
                      fontSize: 12,
                    }}
                  >
                    Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <form
          onSubmit={e => {
            e.preventDefault();
            submit(draft);
          }}
          style={{ display: 'flex', gap: 6, padding: 10, borderTop: `1px solid ${colors.border}` }}
        >
          <textarea
            data-testid="ai-input"
            aria-label="Message the AI assistant"
            value={draft}
            disabled={configured !== true}
            placeholder={configured ? 'Ask about this request… (Enter to send)' : 'Set up AI to start chatting'}
            rows={2}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit(draft);
              }
            }}
            style={{
              flex: 1,
              resize: 'none',
              fontSize: 13,
              padding: '6px 8px',
              borderRadius: 4,
              border: `1px solid ${colors.border}`,
              backgroundColor: colors.bgPrimary,
              color: colors.textPrimary,
              fontFamily: 'inherit',
            }}
          />
          {isStreaming ? (
            <button type="button" aria-label="Stop generating" data-testid="ai-stop-btn" onClick={stop} style={{ ...iconButton, color: colors.danger }}>
              <Square size={16} />
            </button>
          ) : (
            <button
              type="submit"
              data-testid="ai-send-btn"
              disabled={configured !== true || draft.trim() === ''}
              style={{
                padding: '0 12px',
                borderRadius: 4,
                border: `1px solid ${colors.accent}`,
                backgroundColor: colors.accent,
                color: '#fff',
                cursor: 'pointer',
                fontSize: 13,
                opacity: configured !== true || draft.trim() === '' ? 0.5 : 1,
              }}
            >
              Send
            </button>
          )}
        </form>
      </div>

      <AiSettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onChanged={() => void refreshStatus()}
      />
    </aside>
  );
};
