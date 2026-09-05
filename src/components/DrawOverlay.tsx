// Sketch an object over the room, then hand the drawing to Tripo.
//
// A plain 2D canvas stacked on top of the R3F <Canvas>. `active` flips pointer-events so
// OrbitControls keeps working when we're not drawing — the two never fight over the pointer.
//
// Strokes are kept as point lists rather than pixels: undo is a pop(), and export can be
// re-rendered at 1024² instead of upscaling whatever the screen happened to be.
//
// Export is deliberately NOT a screenshot. Tripo reads dark pixels as material, so it gets a
// filled silhouette on white, cropped to the drawing. Sending an outline yields a bent tube
// following the pen path; sending a filled shape yields the object.
import { useEffect, useRef, useState } from "react";

type Pt = { x: number; y: number };
type Stroke = { pts: Pt[]; w: number; fill: boolean };

export function DrawOverlay({
  active,
  busy,
  onSubmit,
}: {
  active: boolean;
  busy?: boolean;
  onSubmit: (png: Blob) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Stroke[]>([]);
  const drawing = useRef<Stroke | null>(null);
  const [count, setCount] = useState(0); // re-render the toolbar on stroke changes
  const [brush, setBrush] = useState(14);
  const [fill, setFill] = useState(true);

  // --- painting ---------------------------------------------------------
  // One routine for both the live overlay and the export bitmap, so what you see is what
  // Tripo gets. `s`/`dx`/`dy` let export crop and rescale into its square.
  function paint(
    c: CanvasRenderingContext2D,
    list: Stroke[],
    xf = { s: 1, dx: 0, dy: 0 },
    color = "#fff",
  ) {
    c.lineCap = "round";
    c.lineJoin = "round";
    c.strokeStyle = color;
    c.fillStyle = color;
    for (const st of list) {
      if (!st.pts.length) continue;
      const P = (p: Pt) => [p.x * xf.s + xf.dx, p.y * xf.s + xf.dy] as const;
      c.beginPath();
      c.moveTo(...P(st.pts[0]));
      for (let i = 1; i < st.pts.length - 1; i++) {
        const a = st.pts[i], b = st.pts[i + 1];
        const [ax, ay] = P(a);
        const [mx, my] = P({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
        c.quadraticCurveTo(ax, ay, mx, my);
      }
      if (st.pts.length > 1) c.lineTo(...P(st.pts[st.pts.length - 1]));
      // Closing and filling turns the pen path into a solid shape. This is the difference
      // between Tripo seeing "a wire bent like a pawn" and "a pawn".
      if (st.fill && st.pts.length > 2) {
        c.closePath();
        c.fill();
      }
      c.lineWidth = st.w * xf.s;
      c.stroke();
    }
  }

  function repaint() {
    const cv = canvasRef.current;
    const c = cv?.getContext("2d");
    if (!cv || !c) return;
    c.clearRect(0, 0, cv.width, cv.height);
    paint(c, strokes.current);
    if (drawing.current) paint(c, [drawing.current]);
  }

  // Match the backing store to the element box, then repaint (resizing clears the canvas).
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const fit = () => {
      const r = cv.getBoundingClientRect();
      const dpr = Math.min(devicePixelRatio, 2);
      cv.width = r.width * dpr;
      cv.height = r.height * dpr;
      cv.getContext("2d")!.setTransform(dpr, 0, 0, dpr, 0, 0);
      repaint();
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(cv);
    return () => ro.disconnect();
  }, []);

  // --- pointer ----------------------------------------------------------
  const local = (e: React.PointerEvent): Pt => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  function down(e: React.PointerEvent) {
    if (!active) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = { pts: [local(e)], w: brush, fill };
    repaint();
  }
  function move(e: React.PointerEvent) {
    if (!drawing.current) return;
    drawing.current.pts.push(local(e));
    repaint();
  }
  function up() {
    if (!drawing.current) return;
    strokes.current.push(drawing.current);
    drawing.current = null;
    repaint();
    setCount(strokes.current.length);
  }

  // --- export -----------------------------------------------------------
  // Crop to the drawing's bounds, pad, and centre in a white square. Tripo reconstructs
  // better from a tight, high-contrast subject than from a small figure in a large field.
  function toPng(px = 1024, pad = 0.09): Promise<Blob | null> {
    const all = strokes.current;
    if (!all.length) return Promise.resolve(null);

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const st of all) for (const p of st.pts) {
      const r = st.w / 2;
      minX = Math.min(minX, p.x - r); maxX = Math.max(maxX, p.x + r);
      minY = Math.min(minY, p.y - r); maxY = Math.max(maxY, p.y + r);
    }
    const span = Math.max(maxX - minX, maxY - minY) * (1 + pad * 2);
    const s = px / span;

    const out = document.createElement("canvas");
    out.width = out.height = px;
    const c = out.getContext("2d")!;
    c.fillStyle = "#fff";
    c.fillRect(0, 0, px, px);
    paint(c, all, {
      s,
      dx: px / 2 - ((minX + maxX) / 2) * s,
      dy: px / 2 - ((minY + maxY) / 2) * s,
    }, "#111");

    return new Promise((res) => out.toBlob(res, "image/png"));
  }

  function clear() {
    strokes.current = [];
    drawing.current = null;
    repaint();
    setCount(0);
  }

  return (
    <>
      <canvas
        ref={canvasRef}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          zIndex: 2,
          pointerEvents: active ? "auto" : "none",
          cursor: active ? "crosshair" : "default",
          touchAction: "none",
        }}
      />
      {active && (
        <div
          style={{
            position: "absolute", zIndex: 3, left: 12, bottom: 12,
            display: "flex", gap: 8, alignItems: "center",
            padding: 8, borderRadius: 4, color: "#eee",
            background: "rgba(17,17,17,.85)", fontSize: 13,
          }}
        >
          <label>
            <input type="checkbox" checked={fill} onChange={(e) => setFill(e.target.checked)} />
            {" "}solid
          </label>
          <input
            type="range" min={2} max={60} value={brush}
            onChange={(e) => setBrush(+e.target.value)} title="brush size"
          />
          <button
            onClick={() => { strokes.current.pop(); repaint(); setCount(strokes.current.length); }}
            disabled={!count}
          >undo</button>
          <button onClick={clear} disabled={!count}>clear</button>
          <button
            disabled={!count || busy}
            onClick={async () => { const b = await toPng(); if (b) onSubmit(b); }}
          >{busy ? "generating…" : "make 3D"}</button>
          <span style={{ opacity: 0.6 }}>{count} strokes</span>
        </div>
      )}
    </>
  );
}
