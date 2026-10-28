import React, { useEffect, useRef, useState } from 'react';
import {
  FileCode2,
  GitBranch,
  Layers,
  Moon,
  Play,
  Settings,
  Sparkles,
  Sun,
  Terminal,
  Upload,
  Columns,
  Rows,
} from 'lucide-react';
import type { EnvironmentConfig } from '../../../shared/collectionSchema';
import type { GitCollectionStatus } from '../../../shared/gitTypes';
import { getGitFileStateBadge } from './GitSourceControlModal';
import { useTheme } from '../context/ThemeContext';

export interface TopToolbarProps {
  activeCollectionName?: string;
  activeCollectionPath?: string | null;
  activeCollectionDirty?: boolean;
  activeGitStatus?: GitCollectionStatus | null;
  onOpenGitSourceControl?: () => void;
  environments: EnvironmentConfig[];
  activeEnvironmentName?: string | null;
  onSelectEnvironment: (environmentName: string) => void;
  onOpenEnvironmentManager: () => void;
  onOpenOAuth2Manager?: () => void;
  onOpenPreferences: () => void;
  onOpenCollectionDialog?: () => void;
  onOpenCollectionRunner?: () => void;
  onOpenImportCurl?: () => void;
  onOpenImportOpenApi?: () => void;
  cliEnabled?: boolean;
  cliCommandPath?: string | null;
  cliError?: string | null;
  onToggleCliCommand?: () => void;
  splitLayout?: 'vertical' | 'horizontal';
  onToggleSplitLayout?: () => void;
  aiPanelOpen?: boolean;
  onToggleAiPanel?: () => void;
}

export const TopToolbar: React.FC<TopToolbarProps> = ({
  activeCollectionName,
  activeCollectionPath,
  activeCollectionDirty = false,
  activeGitStatus = null,
  onOpenGitSourceControl,
  environments,
  activeEnvironmentName,
  onSelectEnvironment,
  onOpenEnvironmentManager,
  onOpenPreferences,
  onOpenCollectionRunner,
  onOpenImportCurl,
  onOpenImportOpenApi,
  cliEnabled = false,
  cliCommandPath = null,
  cliError = null,
  onToggleCliCommand,
  splitLayout = 'vertical',
  onToggleSplitLayout,
  aiPanelOpen = false,
  onToggleAiPanel,
}) => {
  const { isLight, colors, toggleTheme } = useTheme();
  const envSelectRef = useRef<HTMLSelectElement>(null);
  const [importMenuOpen, setImportMenuOpen] = useState(false);

  const activeEnv = environments.find(env => env.name === activeEnvironmentName) ?? environments[0];

  useEffect(() => {
    if (!importMenuOpen) return;

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-toolbar-import-menu], [data-toolbar-import-trigger]')) {
        return;
      }
      setImportMenuOpen(false);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setImportMenuOpen(false);
      }
    };

    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [importMenuOpen]);

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
      } else if (e.key.toLowerCase() === 'a' && e.shiftKey && onToggleAiPanel) {
        e.preventDefault();
        onToggleAiPanel();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onOpenPreferences, onToggleAiPanel]);

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
      {/* Left Active Collection Badge & Per-Collection Git Status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
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

        {activeCollectionName && onOpenGitSourceControl && (
          <button
            type="button"
            data-testid="toolbar-git-status-btn"
            onClick={onOpenGitSourceControl}
            title={
              activeGitStatus?.isGitRepo
                ? `Git (${activeGitStatus.folderPath}): ${activeGitStatus.branch} • ${getGitFileStateBadge(activeGitStatus.fileStatus, activeCollectionDirty).label}`
                : 'Open Git Source Control & YAML Diff for this collection'
            }
            style={{
              ...buttonStyle,
              padding: '3px 10px',
              gap: 6,
              backgroundColor: colors.bgPrimary,
            }}
          >
            <GitBranch size={13} color={colors.accent} />
            {activeGitStatus?.isGitRepo ? (
              <>
                <span style={{ fontWeight: 600 }}>{activeGitStatus.branch}</span>
                <span
                  data-testid="toolbar-git-state-pill"
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    padding: '1px 6px',
                    borderRadius: 999,
                    backgroundColor: `${getGitFileStateBadge(activeGitStatus.fileStatus, activeCollectionDirty).color}22`,
                    color: getGitFileStateBadge(
                      activeGitStatus.fileStatus,
                      activeCollectionDirty,
                    ).color,
                  }}
                >
                  {
                    getGitFileStateBadge(
                      activeGitStatus.fileStatus,
                      activeCollectionDirty,
                    ).label
                  }
                </span>
                {(activeGitStatus.ahead > 0 || activeGitStatus.behind > 0) && (
                  <span style={{ fontSize: 10, color: colors.textSecondary }}>
                    {activeGitStatus.ahead > 0 ? `↑${activeGitStatus.ahead}` : ''}
                    {activeGitStatus.behind > 0 ? ` ↓${activeGitStatus.behind}` : ''}
                  </span>
                )}
              </>
            ) : (
              <span>Git</span>
            )}
          </button>
        )}
      </div>

      {/* Right Controls: Environment Switcher, Managers, CLI status, Open, Preferences, Theme */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          data-testid="cli-status-badge"
          onClick={onToggleCliCommand}
          title={
            cliError
              ? `CLI error: ${cliError}`
              : cliEnabled
                ? `awlasso CLI installed${cliCommandPath ? ` at ${cliCommandPath}` : ''} (click to uninstall)`
                : `Install 'awlasso' command in PATH${cliCommandPath ? ` (${cliCommandPath})` : ''} to open .awjc files from terminal`
          }
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            fontSize: 11,
            fontWeight: 500,
            padding: '4px 8px',
            borderRadius: 6,
            border: `1px solid ${cliError ? colors.danger : cliEnabled ? `${colors.success}66` : colors.border}`,
            backgroundColor: cliEnabled ? `${colors.success}14` : 'transparent',
            color: cliError ? colors.danger : cliEnabled ? colors.success : colors.textSecondary,
            cursor: onToggleCliCommand ? 'pointer' : 'default',
            marginRight: 4,
          }}
        >
          <Terminal size={13} />
          {cliEnabled ? 'awlasso CLI active' : 'awlasso CLI ready'}
        </button>

        {/* Environment Switcher Dropdown (Cmd/Ctrl+E) */}
        <div
          data-testid="environment-switcher-wrapper"
          title="Active Environment (Cmd/Ctrl+E)"
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
            title="Active Environment (Cmd/Ctrl+E)"
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

        {/* Environments, Variables & Auth Manager Button */}
        <button
          type="button"
          data-testid="open-env-manager-btn"
          onClick={onOpenEnvironmentManager}
          aria-label="Environments"
          title="Environments, Variables & Auth Profiles Manager"
          style={{ ...buttonStyle, padding: 6 }}
        >
          <Layers size={13} />
        </button>

        {/* Collection Runner Button */}
        {onOpenCollectionRunner && (
          <button
            type="button"
            data-testid="open-runner-btn"
            onClick={onOpenCollectionRunner}
            aria-label="Runner"
            title="Run Collection or Folder Sequentially"
            style={{ ...buttonStyle, padding: 6 }}
          >
            <Play size={13} />
          </button>
        )}

        {/* Unified Import Menu Button */}
        {(onOpenImportOpenApi || onOpenImportCurl) && (
          <div style={{ position: 'relative', display: 'inline-flex' }}>
            <button
              type="button"
              data-toolbar-import-trigger="true"
              data-testid="toolbar-import-btn"
              onClick={() => setImportMenuOpen(prev => !prev)}
              aria-label="Import"
              aria-expanded={importMenuOpen}
              title="Import API Spec or Request"
              style={{ ...buttonStyle, padding: 6 }}
            >
              <Upload size={13} />
            </button>

            {importMenuOpen && (
              <div
                data-toolbar-import-menu="true"
                data-testid="toolbar-import-menu"
                style={{
                  position: 'absolute',
                  right: 0,
                  top: 'calc(100% + 4px)',
                  zIndex: 50,
                  backgroundColor: colors.bgSecondary,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 6,
                  padding: 4,
                  minWidth: 230,
                  boxShadow: '0 8px 20px rgba(0,0,0,0.35)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                }}
              >
                {onOpenImportOpenApi && (
                  <button
                    type="button"
                    data-testid="import-openapi-btn"
                    onClick={() => {
                      setImportMenuOpen(false);
                      onOpenImportOpenApi();
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '6px 10px',
                      borderRadius: 4,
                      border: 'none',
                      background: 'transparent',
                      color: colors.textPrimary,
                      fontSize: 12,
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                  >
                    <FileCode2 size={13} />
                    Import from OpenAPI / Swagger…
                  </button>
                )}

                {onOpenImportCurl && (
                  <button
                    type="button"
                    data-testid="open-import-curl-btn"
                    onClick={() => {
                      setImportMenuOpen(false);
                      onOpenImportCurl();
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '6px 10px',
                      borderRadius: 4,
                      border: 'none',
                      background: 'transparent',
                      color: colors.textPrimary,
                      fontSize: 12,
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                  >
                    <Terminal size={13} />
                    Import from cURL…
                  </button>
                )}

                <div
                  style={{
                    height: 1,
                    backgroundColor: colors.border,
                    margin: '2px 4px',
                  }}
                />

                <button
                  type="button"
                  data-testid="import-bruno-btn"
                  disabled
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    padding: '6px 10px',
                    borderRadius: 4,
                    border: 'none',
                    background: 'transparent',
                    color: colors.textSecondary,
                    fontSize: 12,
                    textAlign: 'left',
                    opacity: 0.6,
                    cursor: 'not-allowed',
                  }}
                >
                  <span>Import from Bruno</span>
                  <span style={{ fontSize: 10 }}>Soon</span>
                </button>

                <button
                  type="button"
                  data-testid="import-postman-btn"
                  disabled
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    padding: '6px 10px',
                    borderRadius: 4,
                    border: 'none',
                    background: 'transparent',
                    color: colors.textSecondary,
                    fontSize: 12,
                    textAlign: 'left',
                    opacity: 0.6,
                    cursor: 'not-allowed',
                  }}
                >
                  <span>Import from Postman</span>
                  <span style={{ fontSize: 10 }}>Soon</span>
                </button>
              </div>
            )}
          </div>
        )}

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

        {/* AI Assistant Toggle (Cmd/Ctrl+Shift+A) */}
        {onToggleAiPanel && (
          <button
            type="button"
            data-testid="toggle-ai-panel-btn"
            onClick={onToggleAiPanel}
            title="AI Assistant (Cmd/Ctrl+Shift+A)"
            aria-label="Toggle AI assistant"
            aria-pressed={aiPanelOpen}
            style={{
              ...buttonStyle,
              padding: 6,
              borderColor: aiPanelOpen ? colors.accent : colors.border,
              color: aiPanelOpen ? colors.accent : colors.textPrimary,
            }}
          >
            <Sparkles size={14} />
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
