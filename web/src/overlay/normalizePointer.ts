/** Map CSS pointer offsets to normalized image coordinates [0,1] from top-left. */

export function pointerToNormalized(
  offsetX: number,
  offsetY: number,
  width: number,
  height: number,
): { u: number; v: number } {
  if (!(width > 0) || !(height > 0)) return { u: 0, v: 0 };
  return {
    u: offsetX / width,
    v: offsetY / height,
  };
}

export function normalizedToPixel(
  u: number,
  v: number,
  width: number,
  height: number,
): { x: number; y: number } {
  return { x: u * width, y: v * height };
}
