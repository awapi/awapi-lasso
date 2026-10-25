import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

export type ThemeMode = 'dark' | 'light';

export interface ThemeColors {
  bgPrimary: string;
  bgSecondary: string;
  bgTertiary: string;
  border: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  accentHover: string;
  success: string;
  warning: string;
  danger: string;
}

export interface ThemeContextValue {
  theme: ThemeMode;
  isLight: boolean;
  colors: ThemeColors;
  setTheme: (theme: ThemeMode) => Promise<void>;
  toggleTheme: () => Promise<void>;
}

const DARK_COLORS: ThemeColors = {
  bgPrimary: '#0f172a',
  bgSecondary: '#1e293b',
  bgTertiary: '#334155',
  border: '#334155',
  textPrimary: '#e2e8f0',
  textSecondary: '#94a3b8',
  textMuted: '#64748b',
  accent: '#f97316',
  accentHover: '#ea580c',
  success: '#22c55e',
  warning: '#f59e0b',
  danger: '#ef4444',
};

const LIGHT_COLORS: ThemeColors = {
  bgPrimary: '#f8fafc',
  bgSecondary: '#ffffff',
  bgTertiary: '#f1f5f9',
  border: '#cbd5e1',
  textPrimary: '#0f172a',
  textSecondary: '#475569',
  textMuted: '#64748b',
  accent: '#f97316',
  accentHover: '#ea580c',
  success: '#16a34a',
  warning: '#d97706',
  danger: '#dc2626',
};

export function getThemeColors(theme: ThemeMode): ThemeColors {
  return theme === 'light' ? LIGHT_COLORS : DARK_COLORS;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'dark',
  isLight: false,
  colors: DARK_COLORS,
  setTheme: async () => {},
  toggleTheme: async () => {},
});

export interface ThemeProviderProps {
  initialTheme?: ThemeMode;
  children: React.ReactNode;
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ initialTheme, children }) => {
  const [theme, setThemeState] = useState<ThemeMode>(() => {
    if (initialTheme) return initialTheme;
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      try {
        const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
        if (prefersLight) return 'light';
      } catch {
        // ignore matchMedia errors in JSDOM
      }
    }
    return 'dark';
  });

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.loadSettings) return;
    let mounted = true;
    void api.loadSettings().then(settings => {
      if (!mounted) return;
      if (settings?.theme === 'light' || settings?.theme === 'dark') {
        setThemeState(settings.theme);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', theme);
    }
  }, [theme]);

  const setTheme = useCallback(async (nextTheme: ThemeMode) => {
    setThemeState(nextTheme);
    await window.electronAPI?.saveSettings?.({ theme: nextTheme });
  }, []);

  const toggleTheme = useCallback(async () => {
    const nextTheme: ThemeMode = theme === 'dark' ? 'light' : 'dark';
    setThemeState(nextTheme);
    await window.electronAPI?.saveSettings?.({ theme: nextTheme });
  }, [theme]);

  const value: ThemeContextValue = {
    theme,
    isLight: theme === 'light',
    colors: getThemeColors(theme),
    setTheme,
    toggleTheme,
  };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
