import React, { useEffect, useState } from 'react';
import { useTheme } from '../context/ThemeContext';
import type { ThemeMode, ThemeColors } from '../context/ThemeContext';
import type { TerminalChoice, TerminalChoices, TerminalPreference } from '../../../shared/terminal';
import { detectConsoleFonts, notifyTerminalFontChanged } from '../terminalFonts';

const CUSTOM_OPTION = '__custom__';

interface TerminalPreferenceFieldProps {
  label: string;
  description: string;
  choices: TerminalChoice[];
  autoLabel: string | null;
  value: TerminalPreference;
  customPlaceholder: string;
  testId: string;
  colors: ThemeColors;
  onChange: (value: TerminalPreference) => void;
}

/**
 * Dropdown for a terminal preference: Automatic, a detected choice, or a
 * custom executable/app typed by the user (saved on blur or Enter).
 */
export const TerminalPreferenceField: React.FC<TerminalPreferenceFieldProps> = ({
  label,
  description,
  choices,
  autoLabel,
  value,
  customPlaceholder,
  testId,
  colors,
  onChange,
}) => {
  const isCustomValue = !!value && !choices.some(c => c.id === value);
  const [customMode, setCustomMode] = useState(isCustomValue);
  const [customText, setCustomText] = useState(isCustomValue ? value ?? '' : '');
  const selectValue = customMode ? CUSTOM_OPTION : value ?? '';

  const inputStyle: React.CSSProperties = {
    fontSize: '13px',
    padding: '5px 8px',
    borderRadius: '4px',
    border: `1px solid ${colors.border}`,
    backgroundColor: colors.bgPrimary,
    color: colors.textPrimary,
    width: '100%',
    boxSizing: 'border-box',
  };

  const commitCustom = () => {
    const trimmed = customText.trim();
    if (trimmed !== (value ?? '')) onChange(trimmed || null);
  };

  return (
    <div style={{ marginBottom: '12px' }}>
      <label htmlFor={testId} style={{ display: 'block', fontSize: '13px', marginBottom: '4px' }}>
        {label}
      </label>
      <select
        id={testId}
        data-testid={testId}
        value={selectValue}
        onChange={e => {
          const next = e.target.value;
          if (next === CUSTOM_OPTION) {
            setCustomMode(true);
            return;
          }
          setCustomMode(false);
          onChange(next || null);
        }}
        style={inputStyle}
      >
        <option value="">{autoLabel ? `Automatic (${autoLabel})` : 'Automatic'}</option>
        {choices.map(choice => (
          <option key={choice.id} value={choice.id} title={choice.detail}>
            {choice.label}
          </option>
        ))}
        <option value={CUSTOM_OPTION}>Custom…</option>
      </select>
      {customMode && (
        <input
          data-testid={`${testId}-custom`}
          type="text"
          value={customText}
          placeholder={customPlaceholder}
          onChange={e => setCustomText(e.target.value)}
          onBlur={commitCustom}
          onKeyDown={e => {
            if (e.key === 'Enter') commitCustom();
          }}
          style={{ ...inputStyle, marginTop: '6px', fontFamily: 'monospace', fontSize: '12px' }}
        />
      )}
      <p style={{ fontSize: '12px', color: colors.textSecondary, margin: '4px 0 0' }}>
        {description}
      </p>
    </div>
  );
};

function customExternalPlaceholder(platform: string): string {
  if (platform === 'darwin') return 'App name or path, e.g. Hyper or /Applications/Hyper.app';
  if (platform === 'win32') return 'Path to a terminal, e.g. C:\\Program Files\\Alacritty\\alacritty.exe';
  return 'Terminal command or path, e.g. foot';
}

function customShellPlaceholder(platform: string): string {
  if (platform === 'win32') return 'Path to a shell, e.g. C:\\msys64\\usr\\bin\\bash.exe';
  return 'Shell command or path, e.g. /opt/homebrew/bin/nu';
}

export type SettingsTabId = 'general' | 'appearance' | 'terminal';

export interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: SettingsTabId;
  onCliStatusChanged?: (status: { enabled: boolean; commandPath: string | null }) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  initialTab = 'general',
  onCliStatusChanged,
}) => {
  const { colors, theme: currentTheme, setTheme } = useTheme();
  const [activeTab, setActiveTab] = useState<SettingsTabId>(initialTab);
  const [loading, setLoading] = useState(true);
  const [verifySsl, setVerifySsl] = useState(true);
  const [defaultTimeoutMs, setDefaultTimeoutMs] = useState(30000);
  const [followRedirects, setFollowRedirects] = useState(true);
  const [terminalChoices, setTerminalChoices] = useState<TerminalChoices | null>(null);
  const [externalTerminal, setExternalTerminal] = useState<TerminalPreference>(null);
  const [integratedShell, setIntegratedShell] = useState<TerminalPreference>(null);
  const [terminalFont, setTerminalFont] = useState<string | null>(null);
  const [consoleFonts, setConsoleFonts] = useState<string[]>([]);
  const [contextMenuSupported, setContextMenuSupported] = useState(false);
  const [contextMenuEnabled, setContextMenuEnabled] = useState(false);
  const [contextMenuBusy, setContextMenuBusy] = useState(false);
  const [contextMenuError, setContextMenuError] = useState<string | null>(null);
  const [cliCommandSupported, setCliCommandSupported] = useState(false);
  const [cliCommandEnabled, setCliCommandEnabled] = useState(false);
  const [cliCommandPath, setCliCommandPath] = useState<string | null>(null);
  const [cliCommandBusy, setCliCommandBusy] = useState(false);
  const [cliCommandError, setCliCommandError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setActiveTab(initialTab);
    const api = window.electronAPI;
    if (!api) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setContextMenuError(null);
    setCliCommandError(null);
    Promise.all([
      api.loadSettings?.() ?? Promise.resolve(null),
      api.getTerminalChoices?.()?.catch(() => null) ?? Promise.resolve(null),
      detectConsoleFonts().catch(() => [] as string[]),
      api.getContextMenuStatus?.()?.catch(() => null) ?? Promise.resolve(null),
      api.getCliCommandStatus?.()?.catch(() => null) ?? Promise.resolve(null),
    ])
      .then(([settings, choices, fonts, ctxMenu, cliStatus]) => {
        setVerifySsl(settings?.verifySsl ?? true);
        setDefaultTimeoutMs(settings?.defaultTimeoutMs ?? 30000);
        setFollowRedirects(settings?.followRedirects ?? true);
        setExternalTerminal(settings?.externalTerminal ?? null);
        setIntegratedShell(settings?.integratedShell ?? null);
        setTerminalFont(settings?.terminalFont ?? null);
        setTerminalChoices(choices);
        setConsoleFonts(fonts);
        setContextMenuSupported(Boolean(ctxMenu?.supported));
        setContextMenuEnabled(Boolean(ctxMenu?.enabled));
        setCliCommandSupported(Boolean(cliStatus?.supported));
        setCliCommandEnabled(Boolean(cliStatus?.enabled));
        setCliCommandPath(cliStatus?.commandPath ?? null);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [isOpen, initialTab]);

  if (!isOpen) return null;

  const api = window.electronAPI;

  const handleThemeChange = async (nextTheme: ThemeMode) => {
    await setTheme(nextTheme);
  };

  const handleVerifySslChange = async (checked: boolean) => {
    setVerifySsl(checked);
    await api?.saveSettings?.({ verifySsl: checked });
  };

  const handleFollowRedirectsChange = async (checked: boolean) => {
    setFollowRedirects(checked);
    await api?.saveSettings?.({ followRedirects: checked });
  };

  const handleTimeoutChange = async (value: number) => {
    if (!Number.isFinite(value) || value <= 0) return;
    setDefaultTimeoutMs(value);
    await api?.saveSettings?.({ defaultTimeoutMs: value });
  };

  const handleExternalTerminalChange = async (value: TerminalPreference) => {
    setExternalTerminal(value);
    await api?.saveSettings?.({ externalTerminal: value });
  };

  const handleIntegratedShellChange = async (value: TerminalPreference) => {
    setIntegratedShell(value);
    await api?.saveSettings?.({ integratedShell: value });
  };

  const handleTerminalFontChange = async (value: string | null) => {
    setTerminalFont(value);
    notifyTerminalFontChanged(value);
    await api?.saveSettings?.({ terminalFont: value });
  };

  const fontOptions =
    terminalFont && !consoleFonts.includes(terminalFont)
      ? [terminalFont, ...consoleFonts]
      : consoleFonts;

  const handleToggleContextMenu = async (nextEnabled: boolean) => {
    if (!api?.setContextMenuEnabled || contextMenuBusy) return;
    setContextMenuBusy(true);
    setContextMenuError(null);
    try {
      const res = await api.setContextMenuEnabled(nextEnabled);
      setContextMenuEnabled(Boolean(res.enabled));
      if (!res.ok) {
        setContextMenuError(res.error || 'Could not update Windows Explorer context menu.');
      }
    } catch (err) {
      setContextMenuError(
        err instanceof Error ? err.message : 'Could not update Windows Explorer context menu.',
      );
    } finally {
      setContextMenuBusy(false);
    }
  };

  const handleToggleCliCommand = async (nextEnabled: boolean) => {
    if (!api?.setCliCommandEnabled || cliCommandBusy) return;
    setCliCommandBusy(true);
    setCliCommandError(null);
    try {
      const res = await api.setCliCommandEnabled(nextEnabled);
      const enabled = Boolean(res.enabled);
      const commandPath = res.commandPath !== undefined ? res.commandPath : cliCommandPath;
      setCliCommandEnabled(enabled);
      setCliCommandPath(commandPath);
      onCliStatusChanged?.({ enabled, commandPath });
      if (!res.ok) {
        setCliCommandError(res.error || 'Could not update the "awlasso" CLI command.');
      }
    } catch (err) {
      setCliCommandError(
        err instanceof Error ? err.message : 'Could not update the "awlasso" CLI command.',
      );
    } finally {
      setCliCommandBusy(false);
    }
  };

  const overlayStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  };

  const modalStyle: React.CSSProperties = {
    backgroundColor: colors.bgPrimary,
    color: colors.textPrimary,
    border: `1px solid ${colors.border}`,
    borderRadius: '8px',
    padding: '24px',
    minWidth: '480px',
    maxWidth: '640px',
    width: '90%',
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
  };

  const TAB_CONTENT_HEIGHT = '400px';

  const tabContentStyle: React.CSSProperties = {
    height: TAB_CONTENT_HEIGHT,
    maxHeight: 'calc(90vh - 160px)',
    overflowY: 'auto',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: '11px',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    color: colors.textSecondary,
    marginBottom: '6px',
  };

  const btnStyle = (primary = false): React.CSSProperties => ({
    padding: '6px 14px',
    borderRadius: '4px',
    border: `1px solid ${primary ? colors.accent : colors.border}`,
    backgroundColor: primary ? colors.accent : colors.bgSecondary,
    color: primary ? '#fff' : colors.textPrimary,
    cursor: 'pointer',
    fontSize: '13px',
    flexShrink: 0,
    whiteSpace: 'nowrap',
  });

  const groupCardStyle: React.CSSProperties = {
    border: `1px solid ${colors.border}`,
    borderRadius: '6px',
    padding: '14px 16px',
    marginBottom: '16px',
    backgroundColor: colors.bgSecondary,
  };

  const inputInCardStyle: React.CSSProperties = {
    fontSize: '13px',
    padding: '5px 8px',
    borderRadius: '4px',
    border: `1px solid ${colors.border}`,
    backgroundColor: colors.bgPrimary,
    color: colors.textPrimary,
    width: '100%',
    boxSizing: 'border-box',
  };

  const themeOptions: { value: ThemeMode; label: string }[] = [
    { value: 'dark', label: 'Dark' },
    { value: 'light', label: 'Light' },
  ];

  const tabs: { id: SettingsTabId; label: string }[] = [
    { id: 'general', label: 'General' },
    { id: 'appearance', label: 'Appearance' },
    ...(terminalChoices ? [{ id: 'terminal' as const, label: 'Terminal' }] : []),
  ];

  const resolvedActiveTab: SettingsTabId =
    activeTab === 'terminal' && !terminalChoices ? 'general' : activeTab;

  return (
    <div style={overlayStyle} data-testid="settings-overlay">
      <div style={modalStyle} onClick={e => e.stopPropagation()} data-testid="settings-modal">
        <h2 style={{ margin: '0 0 14px', fontSize: '16px', fontWeight: 600 }}>Preferences</h2>

        {loading ? (
          <p style={{ color: colors.textSecondary }}>Loading…</p>
        ) : (
          <>
            {/* Tab Bar */}
            <div
              role="tablist"
              aria-label="Preferences sections"
              data-testid="settings-tabs"
              style={{
                display: 'flex',
                gap: '4px',
                borderBottom: `1px solid ${colors.border}`,
                marginBottom: '18px',
                flexShrink: 0,
              }}
            >
              {tabs.map(tab => {
                const isActive = resolvedActiveTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    role="tab"
                    id={`settings-tab-${tab.id}`}
                    aria-selected={isActive}
                    aria-controls={`settings-panel-${tab.id}`}
                    data-testid={`settings-tab-${tab.id}`}
                    onClick={() => setActiveTab(tab.id)}
                    style={{
                      padding: '8px 16px',
                      fontSize: '13px',
                      fontWeight: isActive ? 600 : 400,
                      color: colors.textPrimary,
                      opacity: isActive ? 1 : 0.7,
                      backgroundColor: 'transparent',
                      border: 'none',
                      borderBottom: isActive
                        ? `2px solid ${colors.accent}`
                        : '2px solid transparent',
                      marginBottom: '-1px',
                      cursor: 'pointer',
                    }}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {/* Tab Content */}
            <div style={tabContentStyle} data-testid="settings-tab-content">
              {/* General Tab */}
              {resolvedActiveTab === 'general' && (
                <div
                  role="tabpanel"
                  id="settings-panel-general"
                  aria-labelledby="settings-tab-general"
                  data-testid="settings-general-section"
                >
                  <div style={groupCardStyle} data-testid="settings-group-http-defaults">
                    <div style={labelStyle}>HTTP &amp; TLS Defaults</div>
                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        fontSize: '13px',
                        cursor: 'pointer',
                        userSelect: 'none',
                        marginBottom: '10px',
                      }}
                    >
                      <input
                        type="checkbox"
                        data-testid="settings-verify-ssl-checkbox"
                        checked={verifySsl}
                        onChange={e => void handleVerifySslChange(e.target.checked)}
                      />
                      <span>Verify SSL / TLS certificates by default</span>
                    </label>
                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        fontSize: '13px',
                        cursor: 'pointer',
                        userSelect: 'none',
                        marginBottom: '12px',
                      }}
                    >
                      <input
                        type="checkbox"
                        data-testid="settings-follow-redirects-checkbox"
                        checked={followRedirects}
                        onChange={e => void handleFollowRedirectsChange(e.target.checked)}
                      />
                      <span>Follow HTTP 3xx redirects automatically</span>
                    </label>
                    <div>
                      <label
                        htmlFor="settings-default-timeout"
                        style={{ display: 'block', fontSize: '13px', marginBottom: '4px' }}
                      >
                        Default request timeout (ms)
                      </label>
                      <input
                        id="settings-default-timeout"
                        data-testid="settings-default-timeout"
                        type="number"
                        min={1000}
                        step={1000}
                        value={defaultTimeoutMs}
                        onChange={e => void handleTimeoutChange(Number(e.target.value))}
                        style={inputInCardStyle}
                      />
                    </div>
                  </div>

                  {contextMenuSupported && (
                    <div style={groupCardStyle} data-testid="settings-group-context-menu">
                      <div style={labelStyle}>Windows Explorer</div>
                      <label
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          fontSize: '13px',
                          cursor: contextMenuBusy ? 'default' : 'pointer',
                          userSelect: 'none',
                        }}
                      >
                        <input
                          type="checkbox"
                          data-testid="settings-context-menu-checkbox"
                          checked={contextMenuEnabled}
                          disabled={contextMenuBusy}
                          onChange={e => void handleToggleContextMenu(e.target.checked)}
                        />
                        <span>Show &ldquo;Open with AwapiLasso&rdquo; in Windows Explorer context menu</span>
                      </label>
                      <p style={{ fontSize: '12px', color: colors.textSecondary, margin: '6px 0 0' }}>
                        Adds an &ldquo;Open with AwapiLasso&rdquo; item when right-clicking collection files in File Explorer.
                      </p>
                      {contextMenuError && (
                        <p
                          data-testid="settings-context-menu-error"
                          style={{ fontSize: '12px', color: colors.danger, margin: '6px 0 0' }}
                        >
                          {contextMenuError}
                        </p>
                      )}
                    </div>
                  )}

                  {cliCommandSupported && (
                    <div style={groupCardStyle} data-testid="settings-group-cli-command">
                      <div style={labelStyle}>Command Line (CLI)</div>
                      <label
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          fontSize: '13px',
                          cursor: cliCommandBusy ? 'default' : 'pointer',
                          userSelect: 'none',
                        }}
                      >
                        <input
                          type="checkbox"
                          data-testid="settings-cli-command-checkbox"
                          checked={cliCommandEnabled}
                          disabled={cliCommandBusy}
                          onChange={e => void handleToggleCliCommand(e.target.checked)}
                        />
                        <span>Enable &ldquo;awlasso&rdquo; command in terminal</span>
                      </label>
                      <p style={{ fontSize: '12px', color: colors.textSecondary, margin: '6px 0 0' }}>
                        Open collections from any terminal with <code style={{ fontFamily: 'monospace' }}>awlasso collection.awjc</code>.
                        {cliCommandPath ? ` Installed at ${cliCommandPath}.` : ''}
                      </p>
                      {cliCommandError && (
                        <p
                          data-testid="settings-cli-command-error"
                          style={{ fontSize: '12px', color: colors.danger, margin: '6px 0 0' }}
                        >
                          {cliCommandError}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Appearance Tab */}
              {resolvedActiveTab === 'appearance' && (
                <div
                  role="tabpanel"
                  id="settings-panel-appearance"
                  aria-labelledby="settings-tab-appearance"
                  data-testid="settings-appearance-section"
                >
                  <div style={groupCardStyle} data-testid="settings-group-theme">
                    <div style={labelStyle}>Theme</div>
                    <p style={{ fontSize: '12px', color: colors.textSecondary, margin: '0 0 10px' }}>
                      Choose the color theme for the AwapiLasso interface and editors.
                    </p>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      {themeOptions.map(opt => (
                        <button
                          key={opt.value}
                          data-testid={`theme-btn-${opt.value}`}
                          aria-pressed={currentTheme === opt.value}
                          onClick={() => void handleThemeChange(opt.value)}
                          style={{
                            ...btnStyle(currentTheme === opt.value),
                            minWidth: '72px',
                          }}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Terminal Tab */}
              {resolvedActiveTab === 'terminal' && terminalChoices && (
                <div
                  role="tabpanel"
                  id="settings-panel-terminal"
                  aria-labelledby="settings-tab-terminal"
                  data-testid="settings-terminal-section"
                >
                  <div style={groupCardStyle} data-testid="settings-group-integrated-terminal">
                    <div style={labelStyle}>Integrated Terminal</div>
                    <TerminalPreferenceField
                      label="Integrated terminal shell"
                      description="Shell used by the terminal panel (Ctrl+`). Applies to new terminals."
                      choices={terminalChoices.shells}
                      autoLabel={terminalChoices.autoShell}
                      value={integratedShell}
                      customPlaceholder={customShellPlaceholder(terminalChoices.platform)}
                      testId="settings-integrated-shell"
                      colors={colors}
                      onChange={v => void handleIntegratedShellChange(v)}
                    />
                    <div>
                      <label
                        htmlFor="settings-terminal-font"
                        style={{ display: 'block', fontSize: '13px', marginBottom: '4px' }}
                      >
                        Integrated terminal font
                      </label>
                      <select
                        id="settings-terminal-font"
                        data-testid="settings-terminal-font"
                        value={terminalFont ?? ''}
                        onChange={e => void handleTerminalFontChange(e.target.value || null)}
                        style={inputInCardStyle}
                      >
                        <option value="">Default</option>
                        {fontOptions.map(font => (
                          <option key={font} value={font}>
                            {font}
                          </option>
                        ))}
                      </select>
                      <p style={{ fontSize: '12px', color: colors.textSecondary, margin: '4px 0 0' }}>
                        Console (fixed-width) font used by the integrated terminal. Pick a Nerd Font or Powerline font for prompt icons.
                      </p>
                    </div>
                  </div>

                  <div style={groupCardStyle} data-testid="settings-group-external-terminal">
                    <div style={labelStyle}>External Terminal</div>
                    <div style={{ marginBottom: '-12px' }}>
                      <TerminalPreferenceField
                        label="External terminal"
                        description={'Application used by \u201cOpen in External Terminal\u201d in collection and folder menus.'}
                        choices={terminalChoices.externalTerminals}
                        autoLabel={terminalChoices.autoExternalTerminal}
                        value={externalTerminal}
                        customPlaceholder={customExternalPlaceholder(terminalChoices.platform)}
                        testId="settings-external-terminal"
                        colors={colors}
                        onChange={v => void handleExternalTerminalChange(v)}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            borderTop: `1px solid ${colors.border}`,
            paddingTop: '16px',
            flexShrink: 0,
          }}
        >
          <button style={btnStyle(true)} onClick={onClose} data-testid="settings-close-btn">
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
