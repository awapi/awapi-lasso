import { describe, it, expect } from 'vitest';
import { nextZoomLevel, MAX_ZOOM_LEVEL, MIN_ZOOM_LEVEL } from './zoom';

describe('nextZoomLevel', () => {
  it('zooms in by one step', () => {
    expect(nextZoomLevel(0, 'in')).toBe(0.5);
  });

  it('zooms out by one step', () => {
    expect(nextZoomLevel(0, 'out')).toBe(-0.5);
  });

  it('resets to 0', () => {
    expect(nextZoomLevel(3, 'reset')).toBe(0);
  });

  it('clamps to the maximum and minimum', () => {
    expect(nextZoomLevel(MAX_ZOOM_LEVEL, 'in')).toBe(MAX_ZOOM_LEVEL);
    expect(nextZoomLevel(MIN_ZOOM_LEVEL, 'out')).toBe(MIN_ZOOM_LEVEL);
  });

  it('snaps off-grid levels to the step grid', () => {
    expect(nextZoomLevel(0.1, 'in')).toBe(0.5);
  });
});
