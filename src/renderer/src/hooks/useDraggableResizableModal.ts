import React, { useCallback, useEffect, useRef, useState } from 'react';

export type ModalResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export interface ModalRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ModalViewport {
  width: number;
  height: number;
}

export interface ModalSizeLimits {
  minWidth: number;
  minHeight: number;
}

export function computeInitialModalRect(
  viewport: ModalViewport,
  preferredWidth: number,
  preferredHeight: number,
  limits: ModalSizeLimits,
): ModalRect {
  const width = Math.max(limits.minWidth, Math.min(preferredWidth, viewport.width - 48));
  const height = Math.max(limits.minHeight, Math.min(preferredHeight, viewport.height - 48));
  return {
    x: Math.max(0, Math.round((viewport.width - width) / 2)),
    y: Math.max(0, Math.round((viewport.height - height) / 2)),
    width,
    height,
  };
}

/** Keeps part of the header reachable so the modal can never be dragged out of sight. */
export function computeMovedModalRect(
  start: ModalRect,
  dx: number,
  dy: number,
  viewport: ModalViewport,
): ModalRect {
  return {
    ...start,
    x: Math.max(-(start.width - 120), Math.min(viewport.width - 80, Math.round(start.x + dx))),
    y: Math.max(0, Math.min(viewport.height - 48, Math.round(start.y + dy))),
  };
}

export function computeResizedModalRect(
  start: ModalRect,
  dir: ModalResizeDirection,
  dx: number,
  dy: number,
  limits: ModalSizeLimits,
): ModalRect {
  let { x, y, width, height } = start;

  if (dir.includes('e')) {
    width = Math.max(limits.minWidth, Math.round(start.width + dx));
  }
  if (dir.includes('s')) {
    height = Math.max(limits.minHeight, Math.round(start.height + dy));
  }
  if (dir.includes('w')) {
    width = Math.max(limits.minWidth, Math.round(start.width - dx));
    x = start.x + start.width - width;
  }
  if (dir.includes('n')) {
    // The bottom edge stays fixed; the top edge cannot move above the viewport.
    const bottom = start.y + start.height;
    y = Math.max(0, Math.min(bottom - limits.minHeight, Math.round(start.y + dy)));
    height = bottom - y;
  }

  return { x, y, width, height };
}

type Interaction =
  | { kind: 'move'; startMouseX: number; startMouseY: number; startRect: ModalRect }
  | {
      kind: 'resize';
      dir: ModalResizeDirection;
      startMouseX: number;
      startMouseY: number;
      startRect: ModalRect;
    };

export interface UseDraggableResizableModalOptions extends ModalSizeLimits {
  initialWidth: number;
  initialHeight: number;
}

function currentViewport(): ModalViewport {
  return {
    width: (typeof window !== 'undefined' && window.innerWidth) || 1280,
    height: (typeof window !== 'undefined' && window.innerHeight) || 800,
  };
}

export function useDraggableResizableModal({
  initialWidth,
  initialHeight,
  minWidth,
  minHeight,
}: UseDraggableResizableModalOptions) {
  const [rect, setRect] = useState<ModalRect>(() =>
    computeInitialModalRect(currentViewport(), initialWidth, initialHeight, {
      minWidth,
      minHeight,
    }),
  );
  const [isInteracting, setIsInteracting] = useState(false);
  const interactionRef = useRef<Interaction | null>(null);

  useEffect(() => {
    if (!isInteracting) return;

    const handleMouseMove = (e: MouseEvent) => {
      const active = interactionRef.current;
      if (!active) return;
      const dx = e.clientX - active.startMouseX;
      const dy = e.clientY - active.startMouseY;
      if (active.kind === 'move') {
        setRect(computeMovedModalRect(active.startRect, dx, dy, currentViewport()));
      } else {
        setRect(
          computeResizedModalRect(active.startRect, active.dir, dx, dy, { minWidth, minHeight }),
        );
      }
    };

    const handleMouseUp = () => {
      interactionRef.current = null;
      setIsInteracting(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isInteracting, minWidth, minHeight]);

  const handleHeaderMouseDown = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('button, input, select, textarea, a')) return;
      e.preventDefault();
      interactionRef.current = {
        kind: 'move',
        startMouseX: e.clientX,
        startMouseY: e.clientY,
        startRect: rect,
      };
      setIsInteracting(true);
    },
    [rect],
  );

  const handleResizeMouseDown = useCallback(
    (dir: ModalResizeDirection, e: React.MouseEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      interactionRef.current = {
        kind: 'resize',
        dir,
        startMouseX: e.clientX,
        startMouseY: e.clientY,
        startRect: rect,
      };
      setIsInteracting(true);
    },
    [rect],
  );

  return { rect, isInteracting, handleHeaderMouseDown, handleResizeMouseDown };
}
