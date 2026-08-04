export const MIN_PLAN_ZOOM = 0.35;
export const MAX_PLAN_ZOOM = 2.5;
export const FIT_PLAN_ZOOM = 0.85;

export function clampPlanZoom(value, fallback = FIT_PLAN_ZOOM) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(MIN_PLAN_ZOOM, Math.min(MAX_PLAN_ZOOM, Number(numeric.toFixed(2))));
}

export function pointerDistance(first, second) {
  return Math.hypot(Number(second.x) - Number(first.x), Number(second.y) - Number(first.y));
}

export function pointerMidpoint(first, second) {
  return {
    x: (Number(first.x) + Number(second.x)) / 2,
    y: (Number(first.y) + Number(second.y)) / 2,
  };
}

export function zoomFromPinch(startZoom, startDistance, currentDistance) {
  const baseline = Number(startDistance);
  const distance = Number(currentDistance);
  if (!Number.isFinite(baseline) || baseline <= 0 || !Number.isFinite(distance) || distance <= 0) {
    return clampPlanZoom(startZoom);
  }
  return clampPlanZoom(Number(startZoom) * (distance / baseline));
}
