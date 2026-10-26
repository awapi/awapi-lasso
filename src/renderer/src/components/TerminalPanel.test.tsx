import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ThemeProvider, useTheme } from '../context/ThemeContext';
import { notifyTerminalFontChanged } from '../terminalFonts';
import TerminalPanel, {
  DEFAULT_TERMINAL_HEIGHT,
  MIN_TERMINAL_HEIGHT,
  TERMINAL_COLORS,
  clampTerminalHeight,
  isLightColor,
  xtermThemeFor,
} from './TerminalPanel';
import type { TerminalSessionsController } from '../useTerminalSessions';

vi.mock('./TerminalView', () => ({
  default: (props: {
    sessionId: number;
    isActive: boolean;
    theme: { background?: string };
    fontFamily?: string;
    onTogglePanel: () => void;
    onNewTerminal: () => void;
  }) => (
    <div
      data-testid={`mock-view-${props.sessionId}`}
      data-active={String(props.isActive)}
      data-background={props.theme.background}
      data-font={props.fontFamily}
      onClick={props.onTogglePanel}
      onDoubleClick={props.onNewTerminal}
    />
  ),
}));

function controller(overrides: Partial<TerminalSessionsController> = {}): TerminalSessionsController {
  return {
    isAvailable: true,
    sessions: [
      { id: 1, title: 'zsh — proj', cwd: '/proj' },
      { id: 2, title: 'zsh — other', cwd: '/other', exitCode: 1 },
    ],
    activeId: 1,
    isOpen: true,
    error: null,
    setActiveId: vi.fn(),
    createSession: vi.fn(async () => {}),
    closeSession: vi.fn(),
    togglePanel: vi.fn(),
    hidePanel: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    ...overrides,
  };
}

function renderPanel(terminals = controller(), cwdForNew: string | null = '/proj/a.awjc') {
  render(
    <ThemeProvider>
      <TerminalPanel terminals={terminals} cwdForNew={cwdForNew} />
    </ThemeProvider>,
  );
  return terminals;
}

describe('TerminalPanel helpers', () => {
  it('clamps the panel height', () => {
    expect(clampTerminalHeight(10, 800)).toBe(MIN_TERMINAL_HEIGHT);
    expect(clampTerminalHeight(5000, 800)).toBe(650);
    expect(clampTerminalHeight(300.4, 800)).toBe(300);
    expect(clampTerminalHeight(300, 100)).toBe(MIN_TERMINAL_HEIGHT);
  });

  it('detects light backgrounds and picks a matching xterm palette', () => {
    expect(isLightColor('#fffffe')).toBe(true);
    expect(isLightColor('#1e1e1e')).toBe(false);
    expect(isLightColor('not-a-color')).toBe(false);

    const colors = { background: '#1e1e1e', foreground: '#d4d4d4', tabBackground: '', tabActiveBackground: '', tabBorder: '', tabHover: '' };
    expect(xtermThemeFor(colors)).toMatchObject({ background: '#1e1e1e', foreground: '#d4d4d4', selectionBackground: '#264f78' });
    expect(xtermThemeFor({ ...colors, background: '#ffffff' })).toMatchObject({ selectionBackground: '#add6ff', yellow: '#949800' });
  });
});

describe('TerminalPanel', () => {
  beforeEach(() => localStorage.clear());

  it('renders nothing when hidden with no sessions', () => {
    renderPanel(controller({ isOpen: false, sessions: [] }));
    expect(screen.queryByTestId('terminal-panel')).toBeNull();
  });

  it('stays mounted but hidden when closed with sessions (keeps scrollback)', () => {
    renderPanel(controller({ isOpen: false }));
    expect(screen.getByTestId('terminal-panel').style.display).toBe('none');
    expect(screen.getByTestId('mock-view-1').dataset.active).toBe('false');
  });

  it('lists sessions and shows only the active one', () => {
    renderPanel();
    expect(screen.getByTestId('terminal-tab-1').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('terminal-tab-2').getAttribute('aria-selected')).toBe('false');
    expect(screen.getByTestId('terminal-tab-1').getAttribute('title')).toBe('/proj');
    expect(screen.getByTestId('mock-view-1').dataset.active).toBe('true');
    expect(screen.getByTestId('mock-view-2').dataset.active).toBe('false');
    expect(screen.getByTestId('terminal-panel').style.height).toBe(`${DEFAULT_TERMINAL_HEIGHT}px`);
  });

  it('wires the session tabs and header buttons', () => {
    const t = renderPanel();
    fireEvent.click(screen.getByTestId('terminal-tab-2'));
    expect(t.setActiveId).toHaveBeenCalledWith(2);

    fireEvent.click(screen.getByTestId('terminal-close-2'));
    expect(t.closeSession).toHaveBeenCalledWith(2);
    expect(t.setActiveId).toHaveBeenCalledTimes(1);

    fireEvent(screen.getByTestId('terminal-tab-1'), new MouseEvent('auxclick', { button: 1, bubbles: true }));
    expect(t.closeSession).toHaveBeenCalledWith(1);

    fireEvent(screen.getByTestId('terminal-tab-1'), new MouseEvent('auxclick', { button: 2, bubbles: true }));
    expect(t.closeSession).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByTestId('terminal-new'));
    expect(t.createSession).toHaveBeenCalledWith('/proj/a.awjc');

    fireEvent.click(screen.getByTestId('terminal-hide'));
    expect(t.hidePanel).toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('mock-view-1'));
    expect(t.togglePanel).toHaveBeenCalledWith('/proj/a.awjc');

    fireEvent.doubleClick(screen.getByTestId('mock-view-1'));
    expect(t.createSession).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('terminal-new').getAttribute('title')).toBe('New terminal (Ctrl+Shift+`)');
  });

  it('shows errors', () => {
    renderPanel(controller({ error: 'Shell not found' }));
    expect(screen.getByTestId('terminal-error').textContent).toBe('Shell not found');
  });

  it('resizes by dragging the top edge and remembers the height', () => {
    renderPanel();
    fireEvent.mouseDown(screen.getByTestId('terminal-resize-handle'), { clientY: 500 });
    fireEvent.mouseMove(window, { clientY: 400 });
    fireEvent.mouseUp(window);
    expect(screen.getByTestId('terminal-panel').style.height).toBe(`${DEFAULT_TERMINAL_HEIGHT + 100}px`);
    expect(localStorage.getItem('awapi.terminalPanelHeight')).toBe(String(DEFAULT_TERMINAL_HEIGHT + 100));

    // Further moves after mouseup are ignored.
    fireEvent.mouseMove(window, { clientY: 100 });
    expect(screen.getByTestId('terminal-panel').style.height).toBe(`${DEFAULT_TERMINAL_HEIGHT + 100}px`);
  });

  it('stays dark even when the app uses the light theme', () => {
    const SwitchToLight = () => {
      const { setTheme } = useTheme();
      return <button data-testid="switch-light" onClick={() => void setTheme('light')} />;
    };
    render(
      <ThemeProvider>
        <SwitchToLight />
        <TerminalPanel terminals={controller()} cwdForNew={null} />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByTestId('switch-light'));
    expect(TERMINAL_COLORS.background).toBe('#1e1e1e');
    expect(screen.getByTestId('terminal-panel').style.backgroundColor).toBe('rgb(30, 30, 30)');
    expect(screen.getByTestId('mock-view-1').dataset.background).toBe('#1e1e1e');
  });

  it('restores the stored height', () => {
    localStorage.setItem('awapi.terminalPanelHeight', '180');
    renderPanel();
    expect(screen.getByTestId('terminal-panel').style.height).toBe('180px');
  });

  it('applies terminal font updates from settings events', () => {
    renderPanel();
    act(() => {
      notifyTerminalFontChanged('MesloLGS NF');
    });
    expect(screen.getByTestId('mock-view-1').dataset.font).toContain('"MesloLGS NF"');
  });
});
