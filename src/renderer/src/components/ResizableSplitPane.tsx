import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTheme } from '../context/ThemeContext';

export type SplitDirection = 'horizontal' | 'vertical';

export interface ResizableSplitPaneProps {
  /** 'horizontal' = left/right panes (col-resize), 'vertical' = top/bottom panes (row-resize) */
  direction?: SplitDirection;
  /** Initial size of the first pane in pixels */
  initialSize?: number;
  /** Minimum size of the first pane in pixels */
  minSize?: number;
  /** Maximum size of the first pane in pixels */
  maxSize?: number;
  /** Optional storage key to persist split size in localStorage */
  storageKey?: string;
  /** Whether the first pane can be collapsed */
  collapsible?: boolean;
  /** Controlled collapsed state */
  collapsed?: boolean;
  /** Callback when collapsed state changes */
  onCollapsedChange?: (collapsed: boolean) => void;
  /** Callback when pane size changes */
  onSizeChange?: (size: number) => void;
  /** First pane content (left or top) */
  firstPane: React.ReactNode;
  /** Second pane content (right or bottom) */
  secondPane: React.ReactNode;
  /** Optional data-testid prefix */
  testId?: string;
}

export function clampSplitSize(size: number, minSize: number, maxSize: number): number {
  return Math.max(minSize, Math.min(maxSize, Math.round(size)));
}

export const ResizableSplitPane: React.FC<ResizableSplitPaneProps> = ({
  direction = 'horizontal',
  initialSize = 280,
  minSize = 160,
  maxSize = 900,
  storageKey,
  collapsible = false,
  collapsed: controlledCollapsed,
  onCollapsedChange,
  onSizeChange,
  firstPane,
  secondPane,
  testId = 'split-pane',
}) => {
  const { colors } = useTheme();

  const readInitialSize = (): number => {
    if (storageKey && typeof window !== 'undefined' && window.localStorage) {
      try {
        const saved = window.localStorage.getItem(`awapilasso.split.${storageKey}`);
        if (saved !== null) {
          const parsed = Number(saved);
          if (!Number.isNaN(parsed)) {
            return clampSplitSize(parsed, minSize, maxSize);
          }
        }
      } catch {
        // ignore storage errors
      }
    }
    return clampSplitSize(initialSize, minSize, maxSize);
  };

  const [size, setSize] = useState<number>(readInitialSize);
  const [internalCollapsed, setInternalCollapsed] = useState<boolean>(false);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  const isCollapsed = controlledCollapsed !== undefined ? controlledCollapsed : internalCollapsed;
  const startCoordRef = useRef<number>(0);
  const startSizeRef = useRef<number>(size);

  const persistSize = useCallback(
    (nextSize: number) => {
      if (storageKey && typeof window !== 'undefined' && window.localStorage) {
        try {
          window.localStorage.setItem(`awapilasso.split.${storageKey}`, String(nextSize));
        } catch {
          // ignore
        }
      }
    },
    [storageKey],
  );

  const updateSize = useCallback(
    (rawSize: number) => {
      const clamped = clampSplitSize(rawSize, minSize, maxSize);
      setSize(clamped);
      persistSize(clamped);
      onSizeChange?.(clamped);
    },
    [minSize, maxSize, persistSize, onSizeChange],
  );

  const handleToggleCollapse = useCallback(() => {
    const next = !isCollapsed;
    if (controlledCollapsed === undefined) {
      setInternalCollapsed(next);
    }
    onCollapsedChange?.(next);
  }, [isCollapsed, controlledCollapsed, onCollapsedChange]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      if (isCollapsed) return;
      startCoordRef.current = direction === 'horizontal' ? e.clientX : e.clientY;
      startSizeRef.current = size;
      setIsDragging(true);
    },
    [direction, isCollapsed, size],
  );

  const handleDoubleClick = useCallback(() => {
    updateSize(initialSize);
  }, [initialSize, updateSize]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const currentCoord = direction === 'horizontal' ? e.clientX : e.clientY;
      const delta = currentCoord - startCoordRef.current;
      updateSize(startSizeRef.current + delta);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, direction, updateSize]);

  const isHorizontal = direction === 'horizontal';

  return (
    <div
      data-testid={testId}
      data-direction={direction}
      style={{
        display: 'flex',
        flexDirection: isHorizontal ? 'row' : 'column',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* First Pane */}
      <div
        data-testid={`${testId}-first`}
        data-collapsed={String(isCollapsed)}
        style={{
          [isHorizontal ? 'width' : 'height']: isCollapsed ? 0 : size,
          flexShrink: 0,
          overflow: 'hidden',
          display: isCollapsed ? 'none' : 'flex',
          flexDirection: 'column',
        }}
      >
        {firstPane}
      </div>

      {/* Draggable Splitter Handle */}
      <div
        role="separator"
        aria-orientation={isHorizontal ? 'vertical' : 'horizontal'}
        data-testid={`${testId}-resizer`}
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
        title="Drag to resize • Double-click to reset"
        style={{
          [isHorizontal ? 'width' : 'height']: 5,
          cursor: isCollapsed ? 'default' : isHorizontal ? 'col-resize' : 'row-resize',
          backgroundColor: isDragging ? colors.accent : colors.border,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          userSelect: 'none',
          transition: isDragging ? 'none' : 'background-color 0.12s ease',
        }}
      >
        {collapsible && (
          <button
            type="button"
            data-testid={`${testId}-collapse-btn`}
            onClick={e => {
              e.stopPropagation();
              handleToggleCollapse();
            }}
            aria-label={isCollapsed ? 'Expand pane' : 'Collapse pane'}
            style={{
              position: 'absolute',
              zIndex: 5,
              width: isHorizontal ? 16 : 28,
              height: isHorizontal ? 28 : 16,
              borderRadius: 4,
              border: `1px solid ${colors.border}`,
              backgroundColor: colors.bgSecondary,
              color: colors.textSecondary,
              cursor: 'pointer',
              fontSize: 10,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
            }}
          >
            {isHorizontal ? (isCollapsed ? '›' : '‹') : isCollapsed ? '▾' : '▴'}
          </button>
        )}
      </div>

      {/* Second Pane */}
      <div
        data-testid={`${testId}-second`}
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {secondPane}
      </div>
    </div>
  );
};
