import React, { useCallback, useEffect, useState } from 'react';
import type { ITheme } from '@xterm/xterm';
import { ChevronDown, Plus, X } from 'lucide-react';
import { formatTerminalFontFamily, TERMINAL_FONT_CHANGED_EVENT } from '../terminalFonts';
import TerminalView from './TerminalView';
import type { TerminalSessionsController } from '../useTerminalSessions';

export const DEFAULT_TERMINAL_HEIGHT = 240;
export const MIN_TERMINAL_HEIGHT = 80;
const HEIGHT_STORAGE_KEY = 'awapi.terminalPanelHeight';

export interface TerminalPanelColors {
  background: string;
  foreground: string;
  tabBackground: string;
  tabActiveBackground: string;
  tabBorder: string;
  tabHover: string;
}

/** The terminal is always dark, regardless of the app theme (matches awapi-editor). */
export const TERMINAL_COLORS: TerminalPanelColors = {
  background: '#1e1e1e',
  foreground: '#d4d4d4',
  tabBackground: '#252526',
  tabActiveBackground: '#1e1e1e',
  tabBorder: '#007acc',
  tabHover: '#2a2d2e',
};

const TERMINAL_XTERM_THEME: ITheme = xtermThemeFor(TERMINAL_COLORS);

/** Keeps the panel between the minimum and the window height minus room for the workspace. */
export function clampTerminalHeight(height: number, windowHeight: number): number {
  const max = Math.max(MIN_TERMINAL_HEIGHT, windowHeight - 150);
  return Math.round(Math.min(max, Math.max(MIN_TERMINAL_HEIGHT, height)));
}

export function isLightColor(hex: string): boolean {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return false;
  const n = parseInt(match[1], 16);
  const luminance = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return luminance > 0.5;
}

/** xterm colors matching the terminal theme (ANSI palette tuned for light backgrounds, as in VS Code). */
export function xtermThemeFor(colors: TerminalPanelColors): ITheme {
  const base: ITheme = {
    background: colors.background,
    foreground: colors.foreground,
    cursor: colors.foreground,
    cursorAccent: colors.background,
  };
  if (!isLightColor(colors.background)) {
    return { ...base, selectionBackground: '#264f78' };
  }
  return {
    ...base,
    selectionBackground: '#add6ff',
    black: '#000000',
    red: '#cd3131',
    green: '#00bc00',
    yellow: '#949800',
    blue: '#0451a5',
    magenta: '#bc05bc',
    cyan: '#0598bc',
    white: '#555555',
    brightBlack: '#666666',
    brightRed: '#cd3131',
    brightGreen: '#14ce14',
    brightYellow: '#b5ba00',
    brightBlue: '#0451a5',
    brightMagenta: '#bc05bc',
    brightCyan: '#0598bc',
    brightWhite: '#a5a5a5',
  };
}

function readStoredHeight(): number {
  try {
    const stored = Number(localStorage.getItem(HEIGHT_STORAGE_KEY));
    return Number.isFinite(stored) && stored > 0 ? stored : DEFAULT_TERMINAL_HEIGHT;
  } catch {
    return DEFAULT_TERMINAL_HEIGHT;
  }
}

export interface TerminalPanelProps {
  terminals: TerminalSessionsController;
  /** File or folder new terminals start in (the active collection path), or null for home. */
  cwdForNew: string | null;
}

/** Bottom panel hosting the integrated terminal sessions. */
export const TerminalPanel: React.FC<TerminalPanelProps> = ({ terminals, cwdForNew }) => {
  const colors = TERMINAL_COLORS;
  const { sessions, activeId, isOpen, error } = terminals;
  const [height, setHeight] = useState(() => clampTerminalHeight(readStoredHeight(), window.innerHeight));
  const [terminalFont, setTerminalFont] = useState<string | null>(null);
  const fontFamily = formatTerminalFontFamily(terminalFont);

  useEffect(() => {
    const w = window as unknown as {
      electronAPI?: { loadSettings?: () => Promise<{ terminalFont?: string | null }> };
    };
    w.electronAPI
      ?.loadSettings?.()
      .then(settings => {
        if (settings?.terminalFont !== undefined) {
          setTerminalFont(settings.terminalFont ?? null);
        }
      })
      .catch(() => {});

    const onFontChanged = (event: Event) => {
      const detail = (event as CustomEvent<string | null>).detail;
      setTerminalFont(detail ?? null);
    };
    window.addEventListener(TERMINAL_FONT_CHANGED_EVENT, onFontChanged);
    return () => window.removeEventListener(TERMINAL_FONT_CHANGED_EVENT, onFontChanged);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(HEIGHT_STORAGE_KEY, String(height));
    } catch {
      // Storage unavailable; the height just won't persist.
    }
  }, [height]);

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = height;
    const onMove = (ev: MouseEvent) => {
      setHeight(clampTerminalHeight(startHeight + (startY - ev.clientY), window.innerHeight));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
    };
    document.body.style.cursor = 'row-resize';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [height]);

  // Stay mounted while hidden so each xterm keeps its scrollback.
  if (!isOpen && sessions.length === 0) return null;

  const iconButton: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '22px',
    height: '22px',
    border: 'none',
    borderRadius: '3px',
    background: 'transparent',
    color: colors.foreground,
    cursor: 'pointer',
    flexShrink: 0,
  };

  return (
    <div
      data-testid="terminal-panel"
      style={{
        display: isOpen ? 'flex' : 'none',
        flexDirection: 'column',
        height: `${height}px`,
        flexShrink: 0,
        borderTop: `1px solid ${colors.tabHover}`,
        backgroundColor: colors.background,
        position: 'relative',
      }}
    >
      <div
        data-testid="terminal-resize-handle"
        onMouseDown={startResize}
        style={{ position: 'absolute', top: '-3px', left: 0, right: 0, height: '6px', cursor: 'row-resize', zIndex: 1 }}
      />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          height: '30px',
          padding: '0 8px',
          fontSize: '12px',
          color: colors.foreground,
          backgroundColor: colors.tabBackground,
          flexShrink: 0,
        }}
      >
        <span style={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: '11px', opacity: 0.7, flexShrink: 0 }}>
          Terminal
        </span>
        <div role="tablist" aria-label="Terminal sessions" style={{ display: 'flex', gap: '2px', flex: 1, minWidth: 0, overflowX: 'auto' }}>
          {sessions.map(session => {
            const selected = session.id === activeId;
            return (
              <div
                key={session.id}
                role="tab"
                aria-selected={selected}
                data-testid={`terminal-tab-${session.id}`}
                title={session.cwd}
                onClick={() => terminals.setActiveId(session.id)}
                onAuxClick={e => {
                  if (e.button === 1) {
                    e.stopPropagation();
                    terminals.closeSession(session.id);
                  }
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '2px 4px 2px 8px',
                  borderRadius: '3px',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  backgroundColor: selected ? colors.tabHover : 'transparent',
                  borderBottom: `2px solid ${selected ? colors.tabBorder : 'transparent'}`,
                  opacity: session.exitCode !== undefined ? 0.6 : 1,
                }}
              >
                <span>{session.title}</span>
                <button
                  aria-label={`Kill terminal ${session.title}`}
                  data-testid={`terminal-close-${session.id}`}
                  onClick={e => {
                    e.stopPropagation();
                    terminals.closeSession(session.id);
                  }}
                  style={{ ...iconButton, width: '18px', height: '18px' }}
                >
                  <X size={12} />
                </button>
              </div>
            );
          })}
        </div>
        <button
          aria-label="New terminal"
          title="New terminal (Ctrl+Shift+`)"
          data-testid="terminal-new"
          onClick={() => void terminals.createSession(cwdForNew)}
          style={iconButton}
        >
          <Plus size={14} />
        </button>
        <button
          aria-label="Hide terminal panel"
          title="Hide terminal panel (Ctrl+`)"
          data-testid="terminal-hide"
          onClick={terminals.hidePanel}
          style={iconButton}
        >
          <ChevronDown size={14} />
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {error && (
          <div
            data-testid="terminal-error"
            role="alert"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              zIndex: 2,
              padding: '8px 12px',
              fontSize: '12px',
              color: '#f48771',
              backgroundColor: colors.tabBackground,
            }}
          >
            {error}
          </div>
        )}
        {sessions.map(session => (
          <TerminalView
            key={session.id}
            sessionId={session.id}
            isActive={isOpen && session.id === activeId}
            theme={TERMINAL_XTERM_THEME}
            fontFamily={fontFamily}
            subscribe={terminals.subscribe}
            onTogglePanel={() => terminals.togglePanel(cwdForNew)}
            onNewTerminal={() => void terminals.createSession(cwdForNew)}
          />
        ))}
      </div>
    </div>
  );
};

export default TerminalPanel;
