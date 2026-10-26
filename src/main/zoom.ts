export const MIN_ZOOM_LEVEL = -5;
export const MAX_ZOOM_LEVEL = 5;
export const ZOOM_STEP = 0.5;

export type ZoomAction = 'in' | 'out' | 'reset';

/** Computes the next Chromium zoom level (0 = 100%), clamped to the supported range. */
export function nextZoomLevel(current: number, action: ZoomAction): number {
  if (action === 'reset') return 0;
  const delta = action === 'in' ? ZOOM_STEP : -ZOOM_STEP;
  const next = Math.round((current + delta) / ZOOM_STEP) * ZOOM_STEP;
  return Math.min(MAX_ZOOM_LEVEL, Math.max(MIN_ZOOM_LEVEL, next));
}
