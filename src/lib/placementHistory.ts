// Undo/redo for placements that live in Convex.
//
// The standalone viewer kept whole-array snapshots, which works when one browser owns
// the scene. Placements are now shared: another player can add or move an object between
// your edits, and replaying a snapshot would silently revert their work. So each entry
// stores the *inverse* of one edit and applies it as a mutation.
//
// Re-inserting an undone placement produces a new document id, so every lineage keeps a
// mutable box holding its current id; later entries read the box rather than capturing
// an id that may already be stale.
import { useCallback, useMemo, useRef, useState } from "react";
import type { Id } from "../../convex/_generated/dataModel";

const LIMIT = 50;

export type PlacementInput = {
  assetId: Id<"assets">;
  position: number[];
  rotation: number[];
  scale: number;
  targetSize?: number;
};

type Box = { id: Id<"placements"> };
type Entry = { undo: () => Promise<void>; redo: () => Promise<void> };

type Mutations = {
  place: (args: PlacementInput & { room: string }) => Promise<Id<"placements">>;
  remove: (args: { id: Id<"placements"> }) => Promise<unknown>;
  update: (args: { id: Id<"placements">; position?: number[]; rotation?: number[]; scale?: number; targetSize?: number }) => Promise<unknown>;
};

export function usePlacementHistory(room: string, { place, remove, update }: Mutations) {
  const past = useRef<Entry[]>([]);
  const future = useRef<Entry[]>([]);
  const boxes = useRef(new Map<string, Box>());
  const [version, bump] = useState(0);
  const busy = useRef(false);

  const boxFor = useCallback((id: Id<"placements">): Box => {
    const existing = boxes.current.get(id);
    if (existing) return existing;
    const box = { id };
    boxes.current.set(id, box);
    return box;
  }, []);

  const rebind = useCallback((box: Box, next: Id<"placements">) => {
    boxes.current.delete(box.id);
    box.id = next;
    boxes.current.set(next, box);
  }, []);

  const push = useCallback((entry: Entry) => {
    past.current = [...past.current.slice(-(LIMIT - 1)), entry];
    future.current = [];       // a fresh edit invalidates the redo branch
    bump((n) => n + 1);
  }, []);

  /** Call after `place` resolves, with the id it returned. */
  const recordPlace = useCallback((id: Id<"placements">, input: PlacementInput) => {
    const box = boxFor(id);
    push({
      undo: async () => { await remove({ id: box.id }); },
      redo: async () => { rebind(box, await place({ room, ...input })); },
    });
  }, [boxFor, push, remove, place, rebind, room]);

  /** Call *before* removing, with the document you are about to delete. */
  const recordRemove = useCallback((id: Id<"placements">, input: PlacementInput) => {
    const box = boxFor(id);
    push({
      undo: async () => { rebind(box, await place({ room, ...input })); },
      redo: async () => { await remove({ id: box.id }); },
    });
  }, [boxFor, push, place, remove, rebind, room]);

  /** Call after an in-place edit, with the fields as they were and as they now are. */
  const recordUpdate = useCallback((
    id: Id<"placements">,
    before: Partial<PlacementInput>,
    after: Partial<PlacementInput>,
  ) => {
    const box = boxFor(id);
    push({
      undo: async () => { await update({ id: box.id, ...before }); },
      redo: async () => { await update({ id: box.id, ...after }); },
    });
  }, [boxFor, push, update]);

  // One at a time: these are network round trips, and a double-click must not
  // pop two entries and apply them out of order.
  const step = useCallback(async (from: typeof past, to: typeof future, run: (e: Entry) => Promise<void>) => {
    if (busy.current) return;
    const entry = from.current.at(-1);
    if (!entry) return;
    busy.current = true;
    from.current = from.current.slice(0, -1);
    bump((n) => n + 1);
    try {
      await run(entry);
      to.current = [...to.current, entry];
    } catch {
      from.current = [...from.current, entry];   // leave the stack as it was
    } finally {
      busy.current = false;
      bump((n) => n + 1);
    }
  }, []);

  const undo = useCallback(() => step(past, future, (e) => e.undo()), [step]);
  const redo = useCallback(() => step(future, past, (e) => e.redo()), [step]);
  const clear = useCallback(() => {
    past.current = []; future.current = []; boxes.current.clear();
    bump((n) => n + 1);
  }, []);

  return useMemo(() => ({
    recordPlace, recordRemove, recordUpdate, undo, redo, clear,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
  // `version` is what makes canUndo/canRedo re-read the refs after a change.
  }), [recordPlace, recordRemove, recordUpdate, undo, redo, clear, version]);
}
