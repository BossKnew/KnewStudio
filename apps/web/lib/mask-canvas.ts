export const MAX_MASK_CANVAS_EDGE = 2048;

export function boundedCanvasSize(width: number, height: number) {
  const scale = Math.min(1, MAX_MASK_CANVAS_EDGE / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
