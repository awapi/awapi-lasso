import React, { useEffect, useRef } from 'react';
import {
  FolderOpen,
  KeyRound,
  Layers,
  Moon,
  Settings,
  Sun,
  Terminal,
  Columns,
  Rows,
} from 'lucide-react';
import type { EnvironmentConfig } from '../../../shared/collectionSchema';
import { useTheme } from '../context/ThemeContext';

export interface TopToolbarProps {
  activeCollectionName?: string;
  activeCollectionPath?: string | null;
  environments: EnvironmentConfig[];
  activeEnvironmentName?: string | null;
  onSelectEnvironment: (environmentName: string) => void;
  onOpenEnvironmentManager: () => void;
  onOpenOAuth2Manager: () => void;
  onOpenPreferences: () => void;
  onOpenCollectionDialog: () => void;
  cliEnabled?: boolean;
  splitLayout?: 'vertical' | 'horizontal';
  onToggleSplitLayout?: () => void;
}

export const TopToolbar: React.FC<TopToolbarProps> = ({
  activeCollectionName,
  activeCollectionPath,
  environments,
  activeEnvironmentName,
  onSelectEnvironment,
  onOpenEnvironmentManager,
  onOpenOAuth2Manager,
  onOpenPreferences,
  onOpenCollectionDialog,
  cliEnabled = false,
  splitLayout = 'vertical',
  onToggleSplitLayout,
}) => {
  const { isLight, colors, toggleTheme } = useTheme();
  const envSelectRef = useRef<HTMLSelectElement>(null);

  const activeEnv = environments.find(env => env.name === activeEnvironmentName) ?? environments[0];

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod) return;

      if (e.key.toLowerCase() === 'e' && !e.shiftKey) {
        e.preventDefault();
        envSelectRef.current?.focus();
      } else if (e.key === ',') {
        e.preventDefault();
        onOpenPreferences();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onOpenPreferences]);

  const buttonStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '5px 10px',
    borderRadius: 6,
    border: `1px solid ${colors.border}`,
    backgroundColor: isLight ? '#f8fafc' : '#0f172a',
    color: colors.textPrimary,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 500,
  };

  return (
    <header
      data-testid="top-toolbar"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 14px',
        borderBottom: `1px solid ${colors.border}`,
        backgroundColor: colors.bgSecondary,
        flexShrink: 0,
        gap: 12,
      }}
    >
      {/* Left Active Collection Badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        {activeCollectionName && (
          <span
            data-testid="active-collection-badge"
            title={activeCollectionPath ?? activeCollectionName}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              fontWeight: 600,
              padding: '3px 10px',
              borderRadius: 6,
              border: `1px solid ${colors.border}`,
              backgroundColor: colors.bgPrimary,
              color: colors.textPrimary,
              maxWidth: 220,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {activeCollectionName}
          </span>
        )}
      </div>

      {/* Right Controls: Environment Switcher, Managers, CLI status, Open, Preferences, Theme */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span
          data-testid="cli-status-badge"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 11,
            color: colors.textSecondary,
            marginRight: 4,
          }}
        >
          <Terminal size={13} />
          {cliEnabled ? 'awlasso CLI active' : 'awlasso CLI ready'}
        </span>

        {/* Environment Switcher Dropdown (Cmd/Ctrl+E) */}
        <div
          data-testid="environment-switcher-wrapper"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '3px 8px',
            borderRadius: 6,
            border: `1px solid ${colors.border}`,
            backgroundColor: colors.bgPrimary,
          }}
        >
          <span
            data-testid="environment-color-dot"
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              backgroundColor: activeEnv?.color ?? '#64748b',
              display: 'inline-block',
              flexShrink: 0,
            }}
          />
          <select
            ref={envSelectRef}
            aria-label="Active Environment"
            data-testid="environment-switcher-select"
            value={activeEnvironmentName ?? activeEnv?.name ?? ''}
            onChange={e => onSelectEnvironment(e.target.value)}
            style={{
              border: 'none',
              background: 'transparent',
              color: colors.textPrimary,
              fontSize: 12,
              fontWeight: 600,
              outline: 'none',
              cursor: 'pointer',
            }}
          >
            {environments.length === 0 ? (
              <option value="">No Environment</option>
            ) : (
              environments.map(env => (
                <option key={env.id || env.name} value={env.name}>
                  {env.name}
                </option>
              ))
            )}
          </select>
        </div>

        {/* Environments & Variables Manager Button */}
        <button
          type="button"
          data-testid="open-env-manager-btn"
          onClick={onOpenEnvironmentManager}
          title="Environments, Variables & Secrets Manager"
          style={buttonStyle}
        >
          <Layers size={13} />
          Environments
        </button>

        {/* OAuth 2.0 Token Manager Button */}
        <button
          type="button"
          data-testid="open-oauth2-manager-btn"
          onClick={onOpenOAuth2Manager}
          title="OAuth 2.0 Token Manager"
          style={buttonStyle}
        >
          <KeyRound size={13} />
          OAuth 2.0
        </button>

        {/* Open .awjc Collection Button */}
        <button
          type="button"
          data-testid="open-collection-btn"
          onClick={onOpenCollectionDialog}
          title="Open .awjc / .awj Collection (Cmd/Ctrl+O)"
          style={buttonStyle}
        >
          <FolderOpen size={13} />
          Open .awjc
        </button>

        {/* Request/Response Split Layout Toggle */}
        {onToggleSplitLayout && (
          <button
            type="button"
            data-testid="toggle-split-layout-btn"
            onClick={onToggleSplitLayout}
            title={
              splitLayout === 'vertical'
                ? 'Switch to Side-by-Side Request/Response Layout'
                : 'Switch to Top/Bottom Request/Response Layout'
            }
            aria-label="Toggle split layout"
            style={{ ...buttonStyle, padding: 6 }}
          >
            {splitLayout === 'vertical' ? <Columns size={14} /> : <Rows size={14} />}
          </button>
        )}

        {/* Preferences Button (Cmd/Ctrl+,) */}
        <button
          type="button"
          data-testid="open-preferences-btn"
          onClick={onOpenPreferences}
          title="Preferences (Cmd/Ctrl+,)"
          aria-label="Preferences"
          style={{ ...buttonStyle, padding: 6 }}
        >
          <Settings size={14} />
        </button>

        {/* Theme Toggle Button */}
        <button
          type="button"
          data-testid="theme-toggle-btn"
          onClick={() => void toggleTheme()}
          aria-label="Toggle theme"
          title="Toggle Dark / Light Theme"
          style={{ ...buttonStyle, padding: 6 }}
        >
          {isLight ? <Moon size={14} /> : <Sun size={14} />}
        </button>
      </div>
    </header>
  );
};
