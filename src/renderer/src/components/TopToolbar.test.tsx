import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { TopToolbar } from './TopToolbar';
import { ThemeProvider } from '../context/ThemeContext';
import type { EnvironmentConfig } from '../../../shared/collectionSchema';

const sampleEnvironments: EnvironmentConfig[] = [
  { id: 'env_1', name: 'local', color: '#22c55e', variables: [] },
  { id: 'env_2', name: 'staging', color: '#f59e0b', variables: [] },
  { id: 'env_3', name: 'prod', color: '#ef4444', variables: [] },
];

describe('TopToolbar', () => {
  it('renders active collection badge, environment switcher with color indicator, and manager buttons', () => {
    const onSelectEnvironment = vi.fn();
    const onOpenEnvironmentManager = vi.fn();
    const onOpenOAuth2Manager = vi.fn();
    const onOpenPreferences = vi.fn();
    const onOpenCollectionDialog = vi.fn();

    render(
      <ThemeProvider>
        <TopToolbar
          activeCollectionName="Payments API"
          activeCollectionPath="/Users/me/payments.awjc"
          environments={sampleEnvironments}
          activeEnvironmentName="staging"
          onSelectEnvironment={onSelectEnvironment}
          onOpenEnvironmentManager={onOpenEnvironmentManager}
          onOpenOAuth2Manager={onOpenOAuth2Manager}
          onOpenPreferences={onOpenPreferences}
          onOpenCollectionDialog={onOpenCollectionDialog}
          cliEnabled={true}
        />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('active-collection-badge')).toHaveTextContent('Payments API');
    expect(screen.getByTestId('cli-status-badge')).toHaveTextContent('awlasso CLI active');

    const colorDot = screen.getByTestId('environment-color-dot');
    expect(colorDot).toHaveStyle({ backgroundColor: '#f59e0b' });

    const envSelect = screen.getByTestId('environment-switcher-select');
    expect(envSelect).toHaveValue('staging');

    fireEvent.change(envSelect, { target: { value: 'prod' } });
    expect(onSelectEnvironment).toHaveBeenCalledWith('prod');

    fireEvent.click(screen.getByTestId('open-env-manager-btn'));
    expect(onOpenEnvironmentManager).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('open-oauth2-manager-btn'));
    expect(onOpenOAuth2Manager).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('open-preferences-btn'));
    expect(onOpenPreferences).toHaveBeenCalledTimes(1);
  });

  it('supports Cmd/Ctrl+E to focus environment switcher and Cmd/Ctrl+, to open preferences', () => {
    const onOpenPreferences = vi.fn();
    render(
      <ThemeProvider>
        <TopToolbar
          environments={sampleEnvironments}
          activeEnvironmentName="local"
          onSelectEnvironment={vi.fn()}
          onOpenEnvironmentManager={vi.fn()}
          onOpenOAuth2Manager={vi.fn()}
          onOpenPreferences={onOpenPreferences}
          onOpenCollectionDialog={vi.fn()}
        />
      </ThemeProvider>,
    );

    const envSelect = screen.getByTestId('environment-switcher-select');
    fireEvent.keyDown(window, { key: 'e', metaKey: true });
    expect(document.activeElement).toBe(envSelect);

    fireEvent.keyDown(window, { key: ',', ctrlKey: true });
    expect(onOpenPreferences).toHaveBeenCalledTimes(1);
  });
});
