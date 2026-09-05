import { useCallback, useRef, useState } from 'react';

type Props = {
  onMove: (move: { x: number; z: number }) => void;
  visible: boolean;
};

const SIZE = 96;
const KNOB = 36;
const MAX = (SIZE - KNOB) / 2;

export function VirtualJoystick({ onMove, visible }: Props) {
  const baseRef = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const activeId = useRef<number | null>(null);

  const updateFromEvent = useCallback(
    (clientX: number, clientY: number) => {
      const el = baseRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      let dx = clientX - cx;
      let dy = clientY - cy;
      const len = Math.hypot(dx, dy);
      if (len > MAX) {
        dx = (dx / len) * MAX;
        dy = (dy / len) * MAX;
      }
      setKnob({ x: dx, y: dy });
      // Screen: +x right, +y down → world move x right, z forward(up on stick = -z)
      onMove({ x: dx / MAX, z: dy / MAX });
    },
    [onMove],
  );

  const end = useCallback(() => {
    activeId.current = null;
    setKnob({ x: 0, y: 0 });
    onMove({ x: 0, z: 0 });
  }, [onMove]);

  if (!visible) return null;

  return (
    <div
      ref={baseRef}
      className="virtual-joystick"
      style={{ width: SIZE, height: SIZE }}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        activeId.current = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        updateFromEvent(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => {
        if (activeId.current !== e.pointerId) return;
        e.preventDefault();
        e.stopPropagation();
        updateFromEvent(e.clientX, e.clientY);
      }}
      onPointerUp={(e) => {
        if (activeId.current !== e.pointerId) return;
        e.preventDefault();
        e.stopPropagation();
        end();
      }}
      onPointerCancel={end}
    >
      <div
        className="virtual-joystick-knob"
        style={{
          width: KNOB,
          height: KNOB,
          transform: `translate(${knob.x}px, ${knob.y}px)`,
        }}
      />
    </div>
  );
}
