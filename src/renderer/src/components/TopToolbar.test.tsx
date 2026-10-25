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
  it('renders active collection badge, environment switcher with color indicator, manager button, and import menu', () => {
    const onSelectEnvironment = vi.fn();
    const onOpenEnvironmentManager = vi.fn();
    const onOpenPreferences = vi.fn();
    const onOpenImportOpenApi = vi.fn();
    const onOpenImportCurl = vi.fn();

    render(
      <ThemeProvider>
        <TopToolbar
          activeCollectionName="Payments API"
          activeCollectionPath="/Users/me/payments.awjc"
          environments={sampleEnvironments}
          activeEnvironmentName="staging"
          onSelectEnvironment={onSelectEnvironment}
          onOpenEnvironmentManager={onOpenEnvironmentManager}
          onOpenPreferences={onOpenPreferences}
          onOpenImportOpenApi={onOpenImportOpenApi}
          onOpenImportCurl={onOpenImportCurl}
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

    // Import dropdown menu shows OpenAPI / Swagger, cURL, and upcoming Bruno / Postman options
    fireEvent.click(screen.getByTestId('toolbar-import-btn'));
    expect(screen.getByTestId('toolbar-import-menu')).toBeInTheDocument();
    expect(screen.getByTestId('import-bruno-btn')).toBeDisabled();
    expect(screen.getByTestId('import-postman-btn')).toBeDisabled();

    fireEvent.click(screen.getByTestId('import-openapi-btn'));
    expect(onOpenImportOpenApi).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('toolbar-import-btn'));
    fireEvent.click(screen.getByTestId('open-import-curl-btn'));
    expect(onOpenImportCurl).toHaveBeenCalledTimes(1);

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
          onOpenPreferences={onOpenPreferences}
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
