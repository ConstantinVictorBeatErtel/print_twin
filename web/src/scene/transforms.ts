/**
 * Pure helpers for Marble splatToApp.
 * Formula: R_x(π) * T(0, -ground, 0) * S(scale), column-major.
 * The 180° X rotation is already inside this matrix — do not apply it again on the SplatMesh.
 */

export function splatToAppMatrix(scale: number, ground: number): number[] {
  if (!Number.isFinite(scale) || scale <= 0 || !Number.isFinite(ground)) {
    throw new Error('Invalid scale or ground for splatToApp');
  }
  const s = scale;
  return [s, 0, 0, 0, 0, -s, 0, 0, 0, 0, -s, 0, 0, ground, 0, 1];
}

/** True when the array is a usable column-major 4×4. */
export function isValidSplatToApp(matrix: number[] | null | undefined): matrix is number[] {
  return Array.isArray(matrix) && matrix.length === 16 && matrix.every((n) => Number.isFinite(n));
}
