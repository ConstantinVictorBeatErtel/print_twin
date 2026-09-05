/** Marble: scale, subtract metric ground offset, then rotate 180° around X. */
export function worldTransform(scale: number, ground: number) {
  return { scale: [scale, -scale, -scale] as [number, number, number], position: [0, ground, 0] as [number, number, number] };
}
