import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ThemeProvider, useTheme } from './ThemeContext';

const ThemeConsumer: React.FC = () => {
  const { theme, isLight, colors, toggleTheme, setTheme } = useTheme();
  return (
    <div>
      <span data-testid="current-theme">{theme}</span>
      <span data-testid="is-light">{String(isLight)}</span>
      <span data-testid="bg-color">{colors.bgPrimary}</span>
      <button type="button" data-testid="toggle-btn" onClick={() => void toggleTheme()}>
        Toggle
      </button>
      <button type="button" data-testid="set-light-btn" onClick={() => void setTheme('light')}>
        Set Light
      </button>
    </div>
  );
};

describe('ThemeContext', () => {
  beforeEach(() => {
    window.electronAPI = {
      ...window.electronAPI,
      loadSettings: vi.fn().mockResolvedValue({
        sessionDir: null,
        theme: 'dark',
      }),
      saveSettings: vi.fn().mockImplementation(async partial => ({
        sessionDir: null,
        theme: partial.theme ?? 'dark',
      })),
    } as unknown as Window['electronAPI'];
  });

  it('defaults to dark theme and syncs with loadSettings', async () => {
    render(
      <ThemeProvider>
        <ThemeConsumer />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('current-theme')).toHaveTextContent('dark');
    expect(screen.getByTestId('is-light')).toHaveTextContent('false');
    expect(screen.getByTestId('bg-color')).toHaveTextContent('#0f172a');
  });

  it('toggles between dark and light themes and persists via saveSettings', async () => {
    render(
      <ThemeProvider>
        <ThemeConsumer />
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(window.electronAPI.loadSettings).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByTestId('toggle-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('current-theme')).toHaveTextContent('light');
      expect(screen.getByTestId('is-light')).toHaveTextContent('true');
      expect(window.electronAPI.saveSettings).toHaveBeenCalledWith({ theme: 'light' });
    });

    fireEvent.click(screen.getByTestId('toggle-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('current-theme')).toHaveTextContent('dark');
      expect(window.electronAPI.saveSettings).toHaveBeenCalledWith({ theme: 'dark' });
    });
  });

  it('loads saved light theme from electronAPI.loadSettings', async () => {
    window.electronAPI.loadSettings = vi.fn().mockResolvedValue({
      sessionDir: null,
      theme: 'light',
    });

    render(
      <ThemeProvider>
        <ThemeConsumer />
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('current-theme')).toHaveTextContent('light');
    });
  });
});
