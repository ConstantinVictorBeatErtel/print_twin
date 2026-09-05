import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // A World Labs (Marble) generated world, cached into Convex storage.
  worlds: defineTable({
    name: v.string(),
    prompt: v.string(),
    model: v.string(),
    status: v.union(v.literal("generating"), v.literal("ready"), v.literal("failed")),
    worldId: v.optional(v.string()),          // World Labs world_id
    operationId: v.optional(v.string()),
    splatStorageId: v.optional(v.id("_storage")),   // cached 500k .spz
    splatFileName: v.optional(v.string()),    // e.g. "splat-500k.spz" — Convex storage URLs have no extension
    colliderStorageId: v.optional(v.id("_storage")), // cached collider .glb
    panoStorageId: v.optional(v.id("_storage")),
    spzUrl: v.optional(v.string()),           // original signed URL (may expire)
    metricScale: v.optional(v.number()),
    groundOffset: v.optional(v.number()),
    error: v.optional(v.string()),
  }).index("by_worldId", ["worldId"]),

  // A Tripo generated object, cached into Convex storage (Tripo URLs die in 5 min).
  assets: defineTable({
    prompt: v.string(),
    model: v.string(),
    status: v.union(v.literal("generating"), v.literal("ready"), v.literal("failed")),
    taskId: v.optional(v.string()),
    glbStorageId: v.optional(v.id("_storage")),
    thumbnailUrl: v.optional(v.string()),
    error: v.optional(v.string()),
  }),

  // Placed instances of assets inside a room (position/rotation/scale).
  placements: defineTable({
    room: v.string(),
    assetId: v.id("assets"),
    position: v.array(v.number()),
    rotation: v.array(v.number()),
    scale: v.number(),
  }).index("by_room", ["room"]),

  // Multiplayer: one doc per player, ~5 Hz updates, lerp on client.
  players: defineTable({
    room: v.string(),
    sessionId: v.string(),
    name: v.string(),
    color: v.string(),
    position: v.array(v.number()),
    yaw: v.number(),
    lastSeen: v.number(),
  })
    .index("by_room", ["room"])
    .index("by_session", ["sessionId"]),
});
