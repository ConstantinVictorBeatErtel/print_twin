// Types for the two plain-JS pipeline modules the sketch action reuses from the CLI.
// They are shared with scripts/ and tests/, so they stay JS; this states the shape of
// the parts convex/sketch.ts calls rather than duplicating the implementations.

declare module "*/image-benchmark/providers.mjs" {
  /** Require both visible pixels and fully transparent pixels in an input PNG. */
  export function inspectPng(bytes: Uint8Array): {
    validCutout: boolean;
    transparentPercent: number;
    visiblePercent: number;
  };
  /** Klein edit -> BiRefNet cutout -> PNG alpha validation, as one call. */
  export function runWorkflow(
    id: "klein-9b" | "ideogram-instant" | "ideogram-turbo",
    prompt: string,
    options: {
      env: Record<string, string | undefined>;
      imageUrls?: string[];
      fetchImpl?: typeof fetch;
      timeoutMs?: number;
      pollMs?: number;
      /** Stage name, e.g. "generation" then "backgroundRemoval". */
      onProgress?: (stage: string) => void;
    },
  ): Promise<{
    id: string;
    status: "ok" | "failed" | "invalid-alpha";
    error?: string;
    /** The transparent cutout PNG. Present only when status is "ok". */
    bytes: Uint8Array;
    alpha?: { validCutout: boolean; transparentPercent: number; visiblePercent: number };
    stages?: { name: string; ms: number }[];
    totalMs?: number;
  }>;
}

declare module "*/glb-assets.mjs" {
  export type GlbAppearance = {
    texturedPrimitives: number;
    vertexColoredPrimitives: number;
    materials: number;
    embeddedImages: number;
    hasSurfaceColor: boolean;
  };
  /** Throws when `requireColor` is set and the GLB carries no base colour or vertex colours. */
  export function inspectGlb(bytes: Uint8Array, options?: { requireColor?: boolean }): GlbAppearance;
  /** Picks the finished textured artifact over the grey base mesh. */
  export function modelArtifact(task: unknown, options?: { color?: boolean }): { url: string; field: string };
  export function readGlb(bytes: Uint8Array): { json: any; chunks: { type: number; data: Uint8Array }[] };
  export function geometryOnlyGlb(bytes: Uint8Array): Uint8Array;
}
