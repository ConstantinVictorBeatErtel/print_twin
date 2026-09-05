export type Surface = 'laptop' | 'phone';

/** Pathname-based surface. Do not use ontouchstart — touch laptops stay laptop. */
export function surfaceFromPath(pathname: string): Surface {
  if (pathname === '/m' || pathname.startsWith('/m/')) return 'phone';
  return 'laptop';
}

export function currentSurface(): Surface {
  return surfaceFromPath(typeof window !== 'undefined' ? window.location.pathname : '/');
}
