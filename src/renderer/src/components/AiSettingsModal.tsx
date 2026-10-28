import React, { useCallback, useEffect, useState } from 'react';
import { useTheme } from '../context/ThemeContext';
import {
  AI_PROVIDER_IDS,
  AI_PROVIDERS,
  type AiKeyStatus,
  type AiProviderId,
  type AiSettings,
} from '../../../shared/aiTypes';

export interface AiSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called after settings or key presence changed so the chat panel can refresh. */
  onChanged?: () => void;
}

type Feedback = { kind: 'ok' | 'error'; text: string } | null;

export const AiSettingsModal: React.FC<AiSettingsModalProps> = ({ isOpen, onClose, onChanged }) => {
  const { colors } = useTheme();
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [keyStatuses, setKeyStatuses] = useState<AiKeyStatus[]>([]);
  const [keyDraft, setKeyDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const refresh = useCallback(async () => {
    const api = window.electronAPI;
    if (!api?.aiGetSettings) return;
    const [loaded, statuses] = await Promise.all([api.aiGetSettings(), api.aiGetKeyStatuses()]);
    setSettings(loaded);
    setKeyStatuses(statuses);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setKeyDraft('');
    setFeedback(null);
    void refresh();
  }, [isOpen, refresh]);

  if (!isOpen) return null;

  const provider: AiProviderId = settings?.provider ?? 'openai';
  const info = AI_PROVIDERS[provider];
  const hasKey = keyStatuses.find(s => s.provider === provider)?.hasKey ?? false;

  const update = (partial: Partial<AiSettings>) =>
    setSettings(prev => (prev ? { ...prev, ...partial } : prev));

  const persistSettings = async (): Promise<boolean> => {
    if (!settings) return false;
    await window.electronAPI.aiSaveSettings(settings);
    return true;
  };

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setFeedback(null);
    try {
      await action();
    } catch (error) {
      setFeedback({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };

  const handleSaveKey = () =>
    run(async () => {
      const result = await window.electronAPI.aiSetKey(provider, keyDraft);
      if (!result.ok) {
        setFeedback({ kind: 'error', text: result.error });
        return;
      }
      setKeyDraft('');
      await refresh();
      onChanged?.();
      setFeedback({ kind: 'ok', text: 'API key saved to the OS Keychain.' });
    });

  const handleRemoveKey = () =>
    run(async () => {
      await window.electronAPI.aiClearKey(provider);
      await refresh();
      onChanged?.();
      setFeedback({ kind: 'ok', text: 'API key removed.' });
    });

  const handleTest = () =>
    run(async () => {
      await persistSettings();
      const result = await window.electronAPI.aiTestConnection();
      setFeedback({ kind: result.ok ? 'ok' : 'error', text: result.message });
    });

  const handleSave = () =>
    run(async () => {
      await persistSettings();
      onChanged?.();
      onClose();
    });

  const inputStyle: React.CSSProperties = {
    fontSize: 13,
    padding: '5px 8px',
    borderRadius: 4,
    border: `1px solid ${colors.border}`,
    backgroundColor: colors.bgPrimary,
    color: colors.textPrimary,
    width: '100%',
    boxSizing: 'border-box',
  };
  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    color: colors.textSecondary,
    margin: '12px 0 4px',
  };
  const btnStyle = (primary = false): React.CSSProperties => ({
    padding: '6px 14px',
    borderRadius: 4,
    border: `1px solid ${primary ? colors.accent : colors.border}`,
    backgroundColor: primary ? colors.accent : colors.bgSecondary,
    color: primary ? '#fff' : colors.textPrimary,
    cursor: busy ? 'default' : 'pointer',
    opacity: busy ? 0.7 : 1,
    fontSize: 13,
    whiteSpace: 'nowrap',
  });

  return (
    <div
      data-testid="ai-settings-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        role="dialog"
        aria-label="AI assistant settings"
        data-testid="ai-settings-modal"
        style={{
          backgroundColor: colors.bgPrimary,
          color: colors.textPrimary,
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          padding: 24,
          width: '90%',
          maxWidth: 520,
          maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        }}
      >
        <h2 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 600 }}>AI Assistant</h2>
        <p style={{ margin: 0, fontSize: 12, color: colors.textSecondary, lineHeight: 1.5 }}>
          Bring your own API key. Keys are stored in your OS Keychain and never leave the main process.
          When you chat, the active request and last response (with secrets and auth headers removed) are
          sent to the provider you choose.
        </p>

        {!settings ? (
          <p style={{ color: colors.textSecondary }}>Loading…</p>
        ) : (
          <>
            <label htmlFor="ai-provider" style={labelStyle}>
              Provider
            </label>
            <select
              id="ai-provider"
              data-testid="ai-provider-select"
              value={provider}
              onChange={e => {
                setKeyDraft('');
                setFeedback(null);
                update({ provider: e.target.value as AiProviderId });
              }}
              style={inputStyle}
            >
              {AI_PROVIDER_IDS.map(id => (
                <option key={id} value={id}>
                  {AI_PROVIDERS[id].label}
                </option>
              ))}
            </select>

            <label htmlFor="ai-model" style={labelStyle}>
              Model
            </label>
            <input
              id="ai-model"
              data-testid="ai-model-input"
              value={settings.models[provider]}
              onChange={e => update({ models: { ...settings.models, [provider]: e.target.value } })}
              style={inputStyle}
              spellCheck={false}
            />

            <label htmlFor="ai-base-url" style={labelStyle}>
              Base URL
            </label>
            <input
              id="ai-base-url"
              data-testid="ai-base-url-input"
              value={settings.baseUrls[provider]}
              onChange={e => update({ baseUrls: { ...settings.baseUrls, [provider]: e.target.value } })}
              style={inputStyle}
              spellCheck={false}
            />

            <label htmlFor="ai-api-key" style={labelStyle}>
              API key {info.keyOptional ? '(optional for local servers)' : ''}
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                id="ai-api-key"
                data-testid="ai-key-input"
                type="password"
                autoComplete="off"
                placeholder={hasKey ? '•••••••• (stored in Keychain)' : 'Paste your API key'}
                value={keyDraft}
                onChange={e => setKeyDraft(e.target.value)}
                style={inputStyle}
              />
              <button
                type="button"
                data-testid="ai-save-key-btn"
                disabled={busy || keyDraft.trim() === ''}
                onClick={handleSaveKey}
                style={btnStyle()}
              >
                {hasKey ? 'Replace' : 'Save key'}
              </button>
              {hasKey && (
                <button
                  type="button"
                  data-testid="ai-remove-key-btn"
                  disabled={busy}
                  onClick={handleRemoveKey}
                  style={btnStyle()}
                >
                  Remove
                </button>
              )}
            </div>
            <div data-testid="ai-key-status" style={{ fontSize: 12, marginTop: 4, color: colors.textSecondary }}>
              {hasKey ? 'A key is stored in the OS Keychain.' : 'No key stored.'}
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label htmlFor="ai-temperature" style={labelStyle}>
                  Temperature
                </label>
                <input
                  id="ai-temperature"
                  data-testid="ai-temperature-input"
                  type="number"
                  min={0}
                  max={2}
                  step={0.1}
                  value={settings.temperature}
                  onChange={e => update({ temperature: Number(e.target.value) })}
                  style={inputStyle}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label htmlFor="ai-max-tokens" style={labelStyle}>
                  Max output tokens
                </label>
                <input
                  id="ai-max-tokens"
                  data-testid="ai-max-tokens-input"
                  type="number"
                  min={1}
                  step={256}
                  value={settings.maxTokens}
                  onChange={e => update({ maxTokens: Math.trunc(Number(e.target.value)) })}
                  style={inputStyle}
                />
              </div>
            </div>

            <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <input
                  type="checkbox"
                  data-testid="ai-confirm-run-checkbox"
                  checked={settings.confirmBeforeRun}
                  onChange={e => update({ confirmBeforeRun: e.target.checked })}
                />
                Ask before the assistant sends requests
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <input
                  type="checkbox"
                  data-testid="ai-auto-apply-checkbox"
                  checked={settings.autoApplyEdits}
                  onChange={e => update({ autoApplyEdits: e.target.checked })}
                />
                Apply assistant edits without asking (they stay unsaved until you save)
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <input
                  type="checkbox"
                  data-testid="ai-share-env-checkbox"
                  checked={settings.shareEnvironmentValues}
                  onChange={e => update({ shareEnvironmentValues: e.target.checked })}
                />
                Share non-secret environment values (names are always shared; secrets never are)
              </label>
              {settings.autoApplyEdits && !settings.confirmBeforeRun && (
                <div data-testid="ai-autonomy-warning" role="alert" style={{ fontSize: 12, color: colors.warning }}>
                  ⚠ The assistant can now edit and send requests without asking. Instructions hidden in an API
                  response could make it act on your behalf. Host changes still ask for confirmation.
                </div>
              )}
            </div>

            {feedback && (
              <div
                role="status"
                data-testid="ai-settings-feedback"
                style={{
                  marginTop: 14,
                  fontSize: 12,
                  color: feedback.kind === 'ok' ? colors.success : colors.danger,
                }}
              >
                {feedback.text}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 20 }}>
              <button type="button" data-testid="ai-test-btn" disabled={busy} onClick={handleTest} style={btnStyle()}>
                Test connection
              </button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" data-testid="ai-cancel-btn" onClick={onClose} style={btnStyle()}>
                  Cancel
                </button>
                <button type="button" data-testid="ai-save-btn" disabled={busy} onClick={handleSave} style={btnStyle(true)}>
                  Save
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
