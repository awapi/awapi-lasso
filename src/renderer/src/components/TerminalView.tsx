import React, { useEffect, useRef } from 'react';
import { Terminal, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { detectTerminalPlatform, getTerminalKeyAction } from '../terminalKeys';
import { DEFAULT_TERMINAL_FONT_FAMILY } from '../terminalFonts';
import type { TerminalWriter } from '../useTerminalSessions';

/** The subset of `window.electronAPI` a terminal view talks to. */
export interface TerminalViewApi {
  ptyWrite: (id: number, data: string) => void;
  ptyResize: (id: number, cols: number, rows: number) => void;
  copyToClipboard?: (text: string) => Promise<void>;
  readClipboardText?: () => Promise<string>;
}

export interface TerminalViewProps {
  sessionId: number;
  /** Whether this session is the one shown in the panel. */
  isActive: boolean;
  theme: ITheme;
  fontFamily?: string;
  subscribe: (id: number, writer: TerminalWriter) => () => void;
  onTogglePanel: () => void;
  onNewTerminal: () => void;
  api?: TerminalViewApi;
}

function getDefaultApi(): TerminalViewApi | undefined {
  return (window as unknown as { electronAPI?: TerminalViewApi }).electronAPI;
}

/** One xterm.js instance bound to a shell session in the main process. */
export const TerminalView: React.FC<TerminalViewProps> = ({
  sessionId,
  isActive,
  theme,
  fontFamily = DEFAULT_TERMINAL_FONT_FAMILY,
  subscribe,
  onTogglePanel,
  onNewTerminal,
  api = getDefaultApi(),
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const onTogglePanelRef = useRef(onTogglePanel);
  onTogglePanelRef.current = onTogglePanel;
  const onNewTerminalRef = useRef(onNewTerminal);
  onNewTerminalRef.current = onNewTerminal;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const term = new Terminal({
      cursorBlink: true,
      fontFamily,
      fontSize: 13,
      scrollback: 5000,
      theme,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    termRef.current = term;
    fitRef.current = fit;

    const platform = detectTerminalPlatform(navigator.userAgent);
    term.attachCustomKeyEventHandler(event => {
      const action = getTerminalKeyAction(event, platform, term.hasSelection());
      if (!action) return true;
      event.preventDefault();
      if (action === 'toggle-panel') {
        onTogglePanelRef.current();
      } else if (action === 'new-terminal') {
        onNewTerminalRef.current();
      } else if (action === 'copy') {
        void api?.copyToClipboard?.(term.getSelection());
        term.clearSelection();
      } else if (action === 'paste') {
        void api?.readClipboardText?.().then(text => {
          if (text) term.paste(text);
        });
      }
      return false;
    });

    const dataSub = term.onData(data => api?.ptyWrite(sessionId, data));
    const resizeSub = term.onResize(({ cols, rows }) => api?.ptyResize(sessionId, cols, rows));
    const unsubscribe = subscribe(sessionId, data => term.write(data));

    const refit = () => {
      // Hidden (display: none) terminals have no size; fitting them would shrink the shell to 1x1.
      if (container.getClientRects().length === 0) return;
      try {
        fit.fit();
      } catch {
        // Ignore fits during teardown.
      }
    };
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(refit) : null;
    observer?.observe(container);
    refit();

    return () => {
      observer?.disconnect();
      unsubscribe();
      dataSub.dispose();
      resizeSub.dispose();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // The terminal is created once per session; theme updates are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (!termRef.current || termRef.current.options.fontFamily === fontFamily) return;
    termRef.current.options.fontFamily = fontFamily;
    if (isActive) {
      try {
        fitRef.current?.fit();
      } catch {
        // Not attached yet.
      }
    }
  }, [fontFamily, isActive]);

  useEffect(() => {
    if (!isActive) return;
    try {
      fitRef.current?.fit();
    } catch {
      // Not attached yet.
    }
    termRef.current?.focus();
  }, [isActive]);

  // Padding lives on the wrapper: the fit addon measures the xterm parent
  // without subtracting its padding.
  return (
    <div
      data-testid={`terminal-view-${sessionId}`}
      style={{
        display: isActive ? 'block' : 'none',
        width: '100%',
        height: '100%',
        padding: '4px 4px 0 8px',
        boxSizing: 'border-box',
      }}
    >
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
};

export default TerminalView;
