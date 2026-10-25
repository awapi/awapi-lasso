import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { RequestTabBar, type RequestWorkspaceTab } from './RequestTabBar';
import {
  createDefaultGraphQLRequest,
  createDefaultHttpRequest,
} from '../../../shared/collectionSchema';

const sampleTabs: RequestWorkspaceTab[] = [
  {
    id: 'tab_1',
    collectionPath: '/Users/me/api.awjc',
    request: createDefaultHttpRequest({ id: 'r1', name: 'Get Users', method: 'GET' }),
    isDirty: true,
  },
  {
    id: 'tab_2',
    collectionPath: '/Users/me/api.awjc',
    request: createDefaultGraphQLRequest({ id: 'r2', name: 'Fetch Orders' }),
    isDirty: false,
  },
];

describe('RequestTabBar', () => {
  it('renders HTTP and GraphQL tabs with method badges, active accent, and dirty indicator', () => {
    const onSelectTab = vi.fn();
    const onNewTab = vi.fn();
    const onCloseTab = vi.fn();

    render(
      <RequestTabBar
        tabs={sampleTabs}
        activeTabId="tab_1"
        hasClosedTabs={true}
        onSelectTab={onSelectTab}
        onNewTab={onNewTab}
        onCloseTab={onCloseTab}
        onCloseOtherTabs={vi.fn()}
        onCloseAllTabs={vi.fn()}
        onReopenClosedTab={vi.fn()}
        onReorderTabs={vi.fn()}
      />,
    );

    expect(screen.getByTestId('tab-badge-tab_1')).toHaveTextContent('GET');
    expect(screen.getByTestId('tab-badge-tab_2')).toHaveTextContent('GQL');
    expect(screen.getByTestId('tab-dirty-tab_1')).toBeInTheDocument();
    expect(screen.queryByTestId('tab-dirty-tab_2')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('request-tab-tab_2'));
    expect(onSelectTab).toHaveBeenCalledWith('tab_2');

    fireEvent.click(screen.getByTestId('new-request-tab-btn'));
    expect(onNewTab).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('tab-close-btn-tab_1'));
    expect(onCloseTab).toHaveBeenCalledWith('tab_1');
  });

  it('supports Close Others, Close All, Reopen Closed Tab, keyboard shortcuts, and drag-and-drop reorder', () => {
    const onCloseTab = vi.fn();
    const onCloseOtherTabs = vi.fn();
    const onCloseAllTabs = vi.fn();
    const onReopenClosedTab = vi.fn();
    const onReorderTabs = vi.fn();

    render(
      <RequestTabBar
        tabs={sampleTabs}
        activeTabId="tab_1"
        hasClosedTabs={true}
        onSelectTab={vi.fn()}
        onNewTab={vi.fn()}
        onCloseTab={onCloseTab}
        onCloseOtherTabs={onCloseOtherTabs}
        onCloseAllTabs={onCloseAllTabs}
        onReopenClosedTab={onReopenClosedTab}
        onReorderTabs={onReorderTabs}
      />,
    );

    // Right-click on tab opens context menu -> Close Others
    fireEvent.contextMenu(screen.getByTestId('request-tab-tab_1'));
    fireEvent.click(screen.getByTestId('tab-ctx-close-others-tab_1'));
    expect(onCloseOtherTabs).toHaveBeenCalledWith('tab_1');

    // Right-click -> Close All
    fireEvent.contextMenu(screen.getByTestId('request-tab-tab_1'));
    fireEvent.click(screen.getByTestId('tab-ctx-close-all-tab_1'));
    expect(onCloseAllTabs).toHaveBeenCalledTimes(1);

    // Keyboard shortcuts: Cmd+W closes active tab, Cmd+Shift+T reopens closed tab
    fireEvent.keyDown(window, { key: 'w', metaKey: true });
    expect(onCloseTab).toHaveBeenCalledWith('tab_1');

    fireEvent.keyDown(window, { key: 'T', metaKey: true, shiftKey: true });
    expect(onReopenClosedTab).toHaveBeenCalledTimes(1);

    // Drag and drop reorder from index 0 to index 1
    const tab1 = screen.getByTestId('request-tab-tab_1');
    const tab2 = screen.getByTestId('request-tab-tab_2');
    fireEvent.dragStart(tab1);
    fireEvent.dragOver(tab2);
    fireEvent.drop(tab2);
    expect(onReorderTabs).toHaveBeenCalledWith(0, 1);
  });
});
