import { describe, it, expect } from 'vitest';
import {
  computeInitialModalRect,
  computeMovedModalRect,
  computeResizedModalRect,
} from './useDraggableResizableModal';

const limits = { minWidth: 400, minHeight: 300 };
const viewport = { width: 1200, height: 800 };

describe('useDraggableResizableModal helpers', () => {
  it('centers the initial rect and clamps it to the viewport and minimum size', () => {
    expect(computeInitialModalRect(viewport, 900, 600, limits)).toEqual({
      x: 150,
      y: 100,
      width: 900,
      height: 600,
    });
    const small = computeInitialModalRect({ width: 500, height: 400 }, 900, 600, limits);
    expect(small.width).toBe(452);
    expect(small.height).toBe(352);
    expect(computeInitialModalRect({ width: 300, height: 200 }, 900, 600, limits)).toMatchObject({
      width: 400,
      height: 300,
      x: 0,
      y: 0,
    });
  });

  it('moves the rect while keeping part of the header on screen', () => {
    const start = { x: 100, y: 100, width: 600, height: 400 };
    expect(computeMovedModalRect(start, 50, -30, viewport)).toMatchObject({ x: 150, y: 70 });
    expect(computeMovedModalRect(start, -5000, -5000, viewport)).toMatchObject({ x: -480, y: 0 });
    expect(computeMovedModalRect(start, 5000, 5000, viewport)).toMatchObject({ x: 1120, y: 752 });
  });

  it('resizes from the east/south edges and respects minimum size', () => {
    const start = { x: 100, y: 100, width: 600, height: 400 };
    expect(computeResizedModalRect(start, 'se', 100, 50, limits)).toEqual({
      x: 100,
      y: 100,
      width: 700,
      height: 450,
    });
    expect(computeResizedModalRect(start, 'se', -5000, -5000, limits)).toMatchObject({
      width: 400,
      height: 300,
    });
  });

  it('resizes from the west/north edges keeping the opposite edges fixed', () => {
    const start = { x: 100, y: 100, width: 600, height: 400 };
    expect(computeResizedModalRect(start, 'nw', -50, -40, limits)).toEqual({
      x: 50,
      y: 60,
      width: 650,
      height: 440,
    });
    const shrunk = computeResizedModalRect(start, 'nw', 5000, 5000, limits);
    expect(shrunk).toEqual({ x: 300, y: 200, width: 400, height: 300 });
    expect(shrunk.x + shrunk.width).toBe(700);
    expect(shrunk.y + shrunk.height).toBe(500);
    expect(computeResizedModalRect(start, 'n', 0, -5000, limits)).toMatchObject({
      y: 0,
      height: 500,
    });
  });
});
