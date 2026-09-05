# Capture review — September 5, 2026

Reviewed ten HEIC photos and one frame per second from all three MOV clips. All show the same occupied hackathon hall, with white ceiling trusses/columns, desks and chairs, windows, and a dark stage area. These are input observations; generated output quality is recorded separately after generation.

| Capture | Duration | Assessment |
| --- | --- | --- |
| IMG_6872.MOV | 9.94 s | First choice. Broadest continuous sweep across the room from near a wall; visible overlapping desks, ceiling beams, and central column. |
| IMG_6877.MOV | 5.64 s | Alternate vantage near a dark partition, with a clearer patch of floor. Shorter angular coverage; people cross the view. |
| IMG_6881.MOV | 5.30 s original / 5.31 s encoded | Short sweep beside tables, with nearby people obscuring surfaces and some blurred sampled frames. |

Stills IMG_6873–6876 form a useful overlapping fallback set from the first vicinity. IMG_6878–6880 show the alternate vantage; IMG_6882–6884 show another table-side sweep. Combining all ten exceeds the eight-image reconstruction limit and mixes camera positions unnecessarily. No angles are inferred from filenames.

All original clips are portrait-oriented HEVC, 1920×1080 encoded with −90° rotation, HLG HDR. Prepared copies are upright H.264 MP4, tone-mapped to SDR BT.709, with audio and metadata removed. Originals remain untouched. Photos are converted to JPEG, orientation baked, long side capped at 2048, and metadata omitted. Prepared inputs and local contact sheets live under `data/captures/`.

## Next capture, if refinement is needed

Current footage is sufficient for a first world. A cleaner replacement should improve usable floor and table geometry:

1. Choose one open spot with a clear view of the table/floor where the object will be placed.
2. Hold the phone level at chest/eye height, preferably landscape to include more of the floor and nearby furniture.
3. Rotate slowly in place through 180–360 degrees in one continuous 20–30 second take. Keep zoom fixed and lock exposure/focus; do not walk between viewpoints during the sweep.
4. Include table edges, floor, and columns. Avoid spending most of the frame on the ceiling. Record when people near the placement area can stay still or move out of view.
5. Also take 4–8 sharp overlapping stills from approximately that same position, using the same lens/orientation/resolution.
6. For later physical scale checks, measure one identifiable span (such as a table edge), plus a different nearby span as an independent check. Record both measurements in millimeters.

Marble generates a plausible explorable space where the camera lacks coverage; it is not a guaranteed accurate survey of the room. Moving occupants and obscured table/floor areas are the main limitations in this capture set.

## API decisions verified against current documentation

- Signed media uploads: use `media_asset.media_asset_id` from the OpenAPI schema, with legacy `id` compatibility. Honor the returned method and required upload headers.
- Set `model: marble-1.1-plus` explicitly; the documented API default is an older model.
- Multi-image reconstruction: `reconstruct_images: true`, up to eight same-size images, without guessed azimuths.
- Single images: `is_pano: false` is a sibling of `image_prompt` in the current schema.
- Poll `/marble/v1/operations/{operation_id}`, fetch the final world, and download all returned SPZ resolutions, collider GLB, panorama, and thumbnail.
- Save the provider's scale and ground metadata separately from verified physical calibration. No paid HQ mesh export is needed for the room viewer.

Sources checked September 5, 2026: [Quickstart](https://docs.worldlabs.ai/api), [OpenAPI schema](https://docs.worldlabs.ai/api/reference/openapi.yaml), [Models](https://docs.worldlabs.ai/api/models), [Pricing](https://docs.worldlabs.ai/api/pricing), [Input specifications](https://docs.worldlabs.ai/marble/create/prompt-guides), [Video capture guidance](https://docs.worldlabs.ai/marble/create/prompt-guides/video-prompt), [Multi-image guidance](https://docs.worldlabs.ai/marble/create/prompt-guides/multi-image-prompt), [SPZ transforms](https://docs.worldlabs.ai/api/rendering-spz).
