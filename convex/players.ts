// Multiplayer presence + movement. One doc per player; client sends ~5 Hz; remote players are lerped.
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const STALE_MS = 15_000;

export const inRoom = query({
  args: { room: v.string() },
  handler: async (ctx, { room }) => {
    const now = Date.now();
    const all = await ctx.db.query("players").withIndex("by_room", (q) => q.eq("room", room)).collect();
    return all.filter((p) => now - p.lastSeen < STALE_MS);
  },
});

export const join = mutation({
  args: { room: v.string(), sessionId: v.string(), name: v.string(), color: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("players").withIndex("by_session", (q) => q.eq("sessionId", args.sessionId)).unique();
    if (existing) { await ctx.db.patch(existing._id, { room: args.room, lastSeen: Date.now() }); return existing._id; }
    return ctx.db.insert("players", { ...args, position: [0, 0, 0], yaw: 0, lastSeen: Date.now() });
  },
});

export const move = mutation({
  args: { sessionId: v.string(), position: v.array(v.number()), yaw: v.number() },
  handler: async (ctx, { sessionId, position, yaw }) => {
    const p = await ctx.db.query("players").withIndex("by_session", (q) => q.eq("sessionId", sessionId)).unique();
    if (p) await ctx.db.patch(p._id, { position, yaw, lastSeen: Date.now() });
  },
});

export const heartbeat = mutation({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }) => {
    const p = await ctx.db.query("players").withIndex("by_session", (q) => q.eq("sessionId", sessionId)).unique();
    if (p) await ctx.db.patch(p._id, { lastSeen: Date.now() });
  },
});
