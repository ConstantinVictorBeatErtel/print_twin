import { pointerToNormalized, normalizedToPixel } from './normalizePointer';

export type StrokePoint = { u: number; v: number };
export type Stroke = { points: StrokePoint[]; color: string; width: number };

export class SketchLayer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private strokes: Stroke[] = [];
  private current: Stroke | null = null;
  private enabled = false;
  private penWidth: number;
  private readonly color = '#ffffff';
  private readonly onPointerDown: (e: PointerEvent) => void;
  private readonly onPointerMove: (e: PointerEvent) => void;
  private readonly onPointerUp: (e: PointerEvent) => void;
  private readonly onResize: () => void;

  constructor(container: HTMLElement, penWidth: number) {
    this.penWidth = penWidth;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'sketch-layer';
    this.canvas.style.position = 'absolute';
    this.canvas.style.inset = '0';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.pointerEvents = 'none';
    this.canvas.style.touchAction = 'none';
    container.appendChild(this.canvas);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;

    this.onPointerDown = (e) => this.handleDown(e);
    this.onPointerMove = (e) => this.handleMove(e);
    this.onPointerUp = (e) => this.handleUp(e);
    this.onResize = () => this.resize();

    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerUp);
    window.addEventListener('resize', this.onResize);
    this.resize();
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    this.canvas.style.pointerEvents = enabled ? 'auto' : 'none';
    if (!enabled) this.current = null;
  }

  undo() {
    this.strokes.pop();
    this.redraw();
  }

  clear() {
    this.strokes = [];
    this.current = null;
    this.redraw();
  }

  getStrokes(): Stroke[] {
    return this.strokes.map((s) => ({ ...s, points: [...s.points] }));
  }

  dispose() {
    window.removeEventListener('resize', this.onResize);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
    this.canvas.remove();
  }

  private resize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const w = Math.max(parent.clientWidth, 1);
    const h = Math.max(parent.clientHeight, 1);
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.redraw();
  }

  private redraw() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.ctx.clearRect(0, 0, w, h);
    for (const stroke of this.strokes) {
      this.drawStroke(stroke, w, h);
    }
    if (this.current) this.drawStroke(this.current, w, h);
  }

  private drawStroke(stroke: Stroke, w: number, h: number) {
    if (stroke.points.length === 0) return;
    this.ctx.strokeStyle = stroke.color;
    this.ctx.lineWidth = stroke.width;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.beginPath();
    const first = normalizedToPixel(stroke.points[0].u, stroke.points[0].v, w, h);
    this.ctx.moveTo(first.x, first.y);
    for (let i = 1; i < stroke.points.length; i++) {
      const p = normalizedToPixel(stroke.points[i].u, stroke.points[i].v, w, h);
      this.ctx.lineTo(p.x, p.y);
    }
    this.ctx.stroke();
  }

  private pointFromEvent(e: PointerEvent): StrokePoint {
    const rect = this.canvas.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;
    return pointerToNormalized(offsetX, offsetY, rect.width, rect.height);
  }

  private handleDown(e: PointerEvent) {
    if (!this.enabled) return;
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    this.current = {
      points: [this.pointFromEvent(e)],
      color: this.color,
      width: this.penWidth,
    };
    this.redraw();
  }

  private handleMove(e: PointerEvent) {
    if (!this.enabled || !this.current) return;
    e.preventDefault();
    this.current.points.push(this.pointFromEvent(e));
    this.redraw();
  }

  private handleUp(e: PointerEvent) {
    if (!this.current) return;
    e.preventDefault();
    if (this.current.points.length > 0) {
      this.strokes.push(this.current);
    }
    this.current = null;
    this.redraw();
  }
}
