import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import TerminalView, { type TerminalViewApi } from './TerminalView';

interface MockTerminal {
  options: Record<string, unknown>;
  ctorOptions: Record<string, unknown>;
  keyHandler: ((e: KeyboardEvent) => boolean) | null;
  dataHandler: ((d: string) => void) | null;
  resizeHandler: ((e: { cols: number; rows: number }) => void) | null;
  selection: string;
  write: ReturnType<typeof vi.fn>;
  paste: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  clearSelection: ReturnType<typeof vi.fn>;
}

const terminals: MockTerminal[] = [];

vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn(function (this: any, options: Record<string, unknown>) {
    this.ctorOptions = options;
    this.options = { ...options };
    this.keyHandler = null;
    this.selection = '';
    this.loadAddon = vi.fn();
    this.open = vi.fn();
    this.attachCustomKeyEventHandler = vi.fn((h: (e: KeyboardEvent) => boolean) => { this.keyHandler = h; });
    this.onData = vi.fn((h: (d: string) => void) => { this.dataHandler = h; return { dispose: vi.fn() }; });
    this.onResize = vi.fn((h: (e: { cols: number; rows: number }) => void) => { this.resizeHandler = h; return { dispose: vi.fn() }; });
    this.write = vi.fn();
    this.paste = vi.fn();
    this.focus = vi.fn();
    this.dispose = vi.fn();
    this.hasSelection = vi.fn(() => this.selection.length > 0);
    this.getSelection = vi.fn(() => this.selection);
    this.clearSelection = vi.fn(() => { this.selection = ''; });
    terminals.push(this);
  }),
}));
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn(function (this: any) {
    this.fit = vi.fn();
  }),
}));

function createApi(): TerminalViewApi & { [K in keyof TerminalViewApi]-?: ReturnType<typeof vi.fn> } {
  return {
    ptyWrite: vi.fn(),
    ptyResize: vi.fn(),
    copyToClipboard: vi.fn(async () => {}),
    readClipboardText: vi.fn(async () => 'pasted'),
  } as any;
}

function keyEvent(key: string, mods: Partial<KeyboardEvent> = {}): KeyboardEvent {
  const e = {
    type: 'keydown',
    key,
    code: key === '`' ? 'Backquote' : `Key${key.toUpperCase()}`,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    preventDefault: vi.fn(),
    ...mods,
  };
  return e as unknown as KeyboardEvent;
}

function renderView(props: Partial<React.ComponentProps<typeof TerminalView>> = {}) {
  const api = createApi();
  const unsubscribe = vi.fn();
  let writer: ((d: string) => void) | null = null;
  const subscribe = vi.fn((_id: number, w: (d: string) => void) => { writer = w; return unsubscribe; });
  const onTogglePanel = vi.fn();
  const onNewTerminal = vi.fn();
  const utils = render(
    <TerminalView sessionId={3} isActive theme={{ background: '#000' }} subscribe={subscribe} onTogglePanel={onTogglePanel} onNewTerminal={onNewTerminal} api={api} {...props} />,
  );
  return { ...utils, api, subscribe, unsubscribe, onTogglePanel, onNewTerminal, emit: (d: string) => writer?.(d), term: terminals[terminals.length - 1] };
}

const originalUserAgent = navigator.userAgent;
function setUserAgent(ua: string) {
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
}

describe('TerminalView', () => {
  beforeEach(() => {
    terminals.length = 0;
    setUserAgent(originalUserAgent);
  });

  it('creates a terminal, wires input/resize to the pty, and writes subscribed output', () => {
    const { api, subscribe, term, emit } = renderView();

    expect(term.ctorOptions).toMatchObject({ cursorBlink: true, fontSize: 13, theme: { background: '#000' } });
    expect(subscribe).toHaveBeenCalledWith(3, expect.any(Function));
    term.dataHandler?.('ls\r');
    expect(api.ptyWrite).toHaveBeenCalledWith(3, 'ls\r');
    term.resizeHandler?.({ cols: 100, rows: 30 });
    expect(api.ptyResize).toHaveBeenCalledWith(3, 100, 30);
    emit('output');
    expect(term.write).toHaveBeenCalledWith('output');
    expect(term.focus).toHaveBeenCalled();
  });

  it('is hidden and not focused when inactive', () => {
    const { term } = renderView({ isActive: false });
    expect(screen.getByTestId('terminal-view-3').style.display).toBe('none');
    expect(term.focus).not.toHaveBeenCalled();
  });

  it('updates the theme without recreating the terminal', () => {
    const { rerender, subscribe, onTogglePanel, onNewTerminal, api, term } = renderView();
    rerender(<TerminalView sessionId={3} isActive theme={{ background: '#fff' }} subscribe={subscribe} onTogglePanel={onTogglePanel} onNewTerminal={onNewTerminal} api={api} />);
    expect(terminals).toHaveLength(1);
    expect(term.options.theme).toEqual({ background: '#fff' });
  });

  it('updates fontFamily without recreating the terminal', () => {
    const { rerender, subscribe, onTogglePanel, onNewTerminal, api, term } = renderView();
    rerender(
      <TerminalView
        sessionId={3}
        isActive
        theme={{ background: '#000' }}
        fontFamily='"MesloLGS NF", monospace'
        subscribe={subscribe}
        onTogglePanel={onTogglePanel}
        onNewTerminal={onNewTerminal}
        api={api}
      />,
    );
    expect(terminals).toHaveLength(1);
    expect(term.options.fontFamily).toBe('"MesloLGS NF", monospace');
  });

  it('cleans up on unmount', () => {
    const { unmount, unsubscribe, term } = renderView();
    unmount();
    expect(unsubscribe).toHaveBeenCalled();
    expect(term.dispose).toHaveBeenCalled();
  });

  it('copies the selection with Ctrl+C on Windows and lets Ctrl+C through without a selection', () => {
    setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
    const { api, term } = renderView();

    expect(term.keyHandler?.(keyEvent('c', { ctrlKey: true }))).toBe(true);
    expect(api.copyToClipboard).not.toHaveBeenCalled();

    term.selection = 'selected text';
    const e = keyEvent('c', { ctrlKey: true });
    expect(term.keyHandler?.(e)).toBe(false);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(api.copyToClipboard).toHaveBeenCalledWith('selected text');
    expect(term.clearSelection).toHaveBeenCalled();
  });

  it('pastes clipboard text with Ctrl+V on Windows', async () => {
    setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
    const { api, term } = renderView();

    expect(term.keyHandler?.(keyEvent('v', { ctrlKey: true }))).toBe(false);
    expect(api.readClipboardText).toHaveBeenCalled();
    await waitFor(() => expect(term.paste).toHaveBeenCalledWith('pasted'));
  });

  it('toggles the panel with Ctrl+` from inside the terminal', () => {
    const { term, onTogglePanel } = renderView();
    expect(term.keyHandler?.(keyEvent('`', { ctrlKey: true }))).toBe(false);
    expect(onTogglePanel).toHaveBeenCalled();
  });

  it('opens a new terminal with Ctrl+Shift+` from inside the terminal', () => {
    const { term, onNewTerminal, onTogglePanel } = renderView();
    expect(term.keyHandler?.(keyEvent('`', { ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(onNewTerminal).toHaveBeenCalled();
    expect(onTogglePanel).not.toHaveBeenCalled();
  });

  it('leaves regular keys to xterm', () => {
    const { term } = renderView();
    expect(term.keyHandler?.(keyEvent('a'))).toBe(true);
    fireEvent.keyDown(screen.getByTestId('terminal-view-3'), { key: 'a' });
  });
});
