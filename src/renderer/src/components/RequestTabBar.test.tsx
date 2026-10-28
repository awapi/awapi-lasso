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
    const onGenerateCodeForTab = vi.fn();

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
        onGenerateCodeForTab={onGenerateCodeForTab}
      />,
    );

    // Right-click on tab opens context menu -> Generate Code Snippet…
    fireEvent.contextMenu(screen.getByTestId('request-tab-tab_1'));
    fireEvent.click(screen.getByTestId('tab-ctx-generate-code-tab_1'));
    expect(onGenerateCodeForTab).toHaveBeenCalledWith(sampleTabs[0]);

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

  const renderWithTabActions = () => {
    const onRenameTab = vi.fn();
    const onDuplicateTab = vi.fn();
    const onCloseTab = vi.fn();
    render(
      <RequestTabBar
        tabs={sampleTabs}
        activeTabId="tab_1"
        onSelectTab={vi.fn()}
        onNewTab={vi.fn()}
        onCloseTab={onCloseTab}
        onCloseOtherTabs={vi.fn()}
        onCloseAllTabs={vi.fn()}
        onReopenClosedTab={vi.fn()}
        onReorderTabs={vi.fn()}
        onRenameTab={onRenameTab}
        onDuplicateTab={onDuplicateTab}
      />,
    );
    return { onRenameTab, onDuplicateTab, onCloseTab };
  };

  it('renames a tab inline from the context menu', () => {
    const { onRenameTab, onCloseTab } = renderWithTabActions();

    fireEvent.contextMenu(screen.getByTestId('request-tab-tab_2'));
    fireEvent.click(screen.getByTestId('tab-ctx-rename-tab_2'));
    const input = screen.getByTestId('tab-rename-input-tab_2');
    expect(input).toHaveValue('Fetch Orders');
    expect(screen.getByTestId('request-tab-tab_2')).toHaveAttribute('draggable', 'false');

    // Typing in the field must not trigger tab shortcuts.
    fireEvent.keyDown(input, { key: 'w', ctrlKey: true });
    expect(onCloseTab).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: '  All Orders  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRenameTab).toHaveBeenCalledWith('tab_2', 'All Orders');
    expect(screen.queryByTestId('tab-rename-input-tab_2')).not.toBeInTheDocument();
  });

  it('ignores empty, unchanged, or cancelled renames', () => {
    const { onRenameTab } = renderWithTabActions();
    const startRename = () => {
      fireEvent.contextMenu(screen.getByTestId('request-tab-tab_1'));
      fireEvent.click(screen.getByTestId('tab-ctx-rename-tab_1'));
      return screen.getByTestId('tab-rename-input-tab_1');
    };

    let input = startRename();
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.blur(input);

    input = startRename();
    fireEvent.blur(input);

    input = startRename();
    fireEvent.change(input, { target: { value: 'Something else' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(onRenameTab).not.toHaveBeenCalled();
    expect(screen.getByTestId('tab-title-tab_1')).toHaveTextContent('Get Users');
  });

  it('duplicates a tab from the context menu', () => {
    const { onDuplicateTab } = renderWithTabActions();
    fireEvent.contextMenu(screen.getByTestId('request-tab-tab_1'));
    fireEvent.click(screen.getByTestId('tab-ctx-duplicate-tab_1'));
    expect(onDuplicateTab).toHaveBeenCalledWith('tab_1');
    expect(screen.queryByTestId('tab-context-menu-tab_1')).not.toBeInTheDocument();
  });

  it('hides Rename and Duplicate when no handlers are given', () => {
    render(
      <RequestTabBar
        tabs={sampleTabs}
        activeTabId="tab_1"
        onSelectTab={vi.fn()}
        onNewTab={vi.fn()}
        onCloseTab={vi.fn()}
        onCloseOtherTabs={vi.fn()}
        onCloseAllTabs={vi.fn()}
        onReopenClosedTab={vi.fn()}
        onReorderTabs={vi.fn()}
      />,
    );
    fireEvent.contextMenu(screen.getByTestId('request-tab-tab_1'));
    expect(screen.queryByTestId('tab-ctx-rename-tab_1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tab-ctx-duplicate-tab_1')).not.toBeInTheDocument();
  });
});
