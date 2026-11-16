'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface KnobProps {
  size?: number;
  label?: string;
  value?: string;
  valueDim?: boolean;
  ticks?: number;
  pointerColor?: string;
  onStep: (dir: 1 | -1, fine: boolean) => void;
  onReset?: () => void;
}

/**
 * Realistic rotary knob: drag up/down to turn, mouse-wheel to step,
 * double-click to reset. Each ~14px of vertical drag = one detent step.
 */
export default function Knob({
  size = 64,
  label,
  value,
  valueDim,
  ticks = 11,
  pointerColor,
  onStep,
  onReset,
}: KnobProps) {
  const [angle, setAngle] = useState(-30);
  const drag = useRef<{ y: number; acc: number } | null>(null);
  const knobRef = useRef<HTMLDivElement>(null);

  const step = useCallback(
    (dir: 1 | -1, fine = false) => {
      setAngle((a) => Math.max(-135, Math.min(135, a + dir * (fine ? 4 : 15))));
      onStep(dir, fine);
    },
    [onStep]
  );

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, acc: 0 };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const dy = drag.current.y - e.clientY;
    drag.current.y = e.clientY;
    drag.current.acc += dy;
    const thresh = 7;
    while (drag.current.acc > thresh) {
      drag.current.acc -= thresh;
      step(1, e.shiftKey);
    }
    while (drag.current.acc < -thresh) {
      drag.current.acc += thresh;
      step(-1, e.shiftKey);
    }
  };
  const onPointerUp = () => { drag.current = null; };

  // React's onWheel is passive, so preventDefault() would be ignored and the
  // page would scroll while turning the knob. Use a native listener instead.
  useEffect(() => {
    const el = knobRef.current;
    if (!el) return;
    const onWheelNative = (e: WheelEvent) => {
      e.preventDefault();
      step(e.deltaY < 0 ? 1 : -1, e.shiftKey);
    };
    el.addEventListener('wheel', onWheelNative, { passive: false });
    return () => el.removeEventListener('wheel', onWheelNative);
  }, [step]);

  const tickArr = Array.from({ length: ticks }, (_, i) => {
    const a = -135 + (270 * i) / (ticks - 1);
    return a;
  });

  return (
    <div className="knob-unit">
      <div style={{ position: 'relative', width: size + 18, height: size + 18 }}>
        <div className="knob-ticks">
          {tickArr.map((a, i) => (
            <i
              key={i}
              style={{
                transform: `rotate(${a}deg) translateY(-${size / 2 + 5}px)`,
                transformOrigin: '50% 0',
              }}
            />
          ))}
        </div>
        <div
          ref={knobRef}
          className="knob"
          role="slider"
          aria-label={label}
          aria-valuenow={0}
          aria-valuetext={value}
          tabIndex={0}
          style={{ width: size, height: size, margin: 9 }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={onReset}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); step(1); }
            if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
          }}
        >
          <div className="ridges" />
          <div className="knob-cap" />
          <div
            className="pointer"
            style={{
              transform: `rotate(${angle}deg)`,
              transformOrigin: `2px ${size / 2 - 3}px`,
              background: pointerColor
                ? `linear-gradient(180deg, ${pointerColor}, ${pointerColor}aa)`
                : undefined,
              top: 3,
              height: size * 0.3,
            }}
          />
        </div>
      </div>
      {label && <div className="knob-label">{label}</div>}
      {value !== undefined && (
        <div className={`knob-value${valueDim ? ' dim' : ''}`}>{value}</div>
      )}
    </div>
  );
}
