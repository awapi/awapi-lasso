import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ResizableSplitPane, clampSplitSize } from './ResizableSplitPane';

describe('ResizableSplitPane', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('clamps sizes between minSize and maxSize', () => {
    expect(clampSplitSize(100, 150, 500)).toBe(150);
    expect(clampSplitSize(600, 150, 500)).toBe(500);
    expect(clampSplitSize(280, 150, 500)).toBe(280);
  });

  it('renders horizontal split pane with initial size and drags to resize', () => {
    const onSizeChange = vi.fn();
    render(
      <ResizableSplitPane
        direction="horizontal"
        initialSize={260}
        minSize={180}
        maxSize={500}
        storageKey="sidebar"
        onSizeChange={onSizeChange}
        firstPane={<div data-testid="left-content">Left</div>}
        secondPane={<div data-testid="right-content">Right</div>}
      />,
    );

    const firstPane = screen.getByTestId('split-pane-first');
    const resizer = screen.getByTestId('split-pane-resizer');

    expect(firstPane).toHaveStyle({ width: '260px' });
    expect(resizer).toHaveStyle({ cursor: 'col-resize' });

    // Drag 60px right
    fireEvent.mouseDown(resizer, { clientX: 260 });
    fireEvent.mouseMove(window, { clientX: 320 });
    fireEvent.mouseUp(window);

    expect(firstPane).toHaveStyle({ width: '320px' });
    expect(onSizeChange).toHaveBeenCalledWith(320);
    expect(window.localStorage.getItem('awapilasso.split.sidebar')).toBe('320');

    // Double-click resets to initialSize (260)
    fireEvent.doubleClick(resizer);
    expect(firstPane).toHaveStyle({ width: '260px' });
  });

  it('supports vertical split pane and min/max clamping during drag', () => {
    render(
      <ResizableSplitPane
        direction="vertical"
        initialSize={300}
        minSize={200}
        maxSize={400}
        testId="vert-split"
        firstPane={<div>Top</div>}
        secondPane={<div>Bottom</div>}
      />,
    );

    const firstPane = screen.getByTestId('vert-split-first');
    const resizer = screen.getByTestId('vert-split-resizer');

    expect(firstPane).toHaveStyle({ height: '300px' });
    expect(resizer).toHaveStyle({ cursor: 'row-resize' });

    // Drag far beyond maxSize
    fireEvent.mouseDown(resizer, { clientY: 300 });
    fireEvent.mouseMove(window, { clientY: 900 });
    fireEvent.mouseUp(window);

    expect(firstPane).toHaveStyle({ height: '400px' });
  });

  it('toggles collapse when collapsible is enabled', () => {
    const onCollapsedChange = vi.fn();
    render(
      <ResizableSplitPane
        direction="horizontal"
        initialSize={250}
        collapsible
        onCollapsedChange={onCollapsedChange}
        firstPane={<div>Sidebar</div>}
        secondPane={<div>Workspace</div>}
      />,
    );

    const firstPane = screen.getByTestId('split-pane-first');
    const collapseBtn = screen.getByTestId('split-pane-collapse-btn');

    expect(firstPane).toHaveAttribute('data-collapsed', 'false');
    fireEvent.click(collapseBtn);
    expect(firstPane).toHaveAttribute('data-collapsed', 'true');
    expect(onCollapsedChange).toHaveBeenCalledWith(true);
  });
});
