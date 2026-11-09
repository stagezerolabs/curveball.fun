import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import {
  animate,
  motion,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
  type AnimationPlaybackControls,
  type MotionStyle,
} from "motion/react";

type FlipCardProps = {
  front: ReactNode;
  back: ReactNode;
  flipped?: boolean;
  defaultFlipped?: boolean;
  onFlipChange?: (flipped: boolean) => void;
  axis?: "x" | "y";
  flipOnClick?: boolean;
  draggable?: boolean;
  dragDistance?: number;
  tilt?: boolean;
  tiltMax?: number;
  glare?: boolean;
  glareOpacity?: number;
  hoverScale?: number;
  perspective?: number;
  stiffness?: number;
  damping?: number;
  width?: number | string;
  height?: number | string;
  radius?: number;
  background?: string;
  color?: string;
  shadow?: boolean;
  shadowColor?: string;
  shadowOpacity?: number;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
};

type Grip = {
  id: number;
  x: number;
  y: number;
  base: number;
  moved: boolean;
  slop: number;
  history: { time: number; angle: number }[];
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const snap = (angle: number) => Math.round(angle / 180) * 180;
const isBack = (angle: number) => Math.abs(Math.round(angle / 180)) % 2 === 1;

export function FlipCard({
  front,
  back,
  flipped,
  defaultFlipped = false,
  onFlipChange,
  axis = "y",
  flipOnClick = true,
  draggable = true,
  dragDistance = 0,
  tilt = true,
  tiltMax = 12,
  glare = true,
  glareOpacity = 0.22,
  hoverScale = 1.03,
  perspective = 1100,
  stiffness = 170,
  damping = 20,
  width = "100%",
  height,
  radius = 22,
  background = "#27272a",
  color = "#f5f5f5",
  shadow = true,
  shadowColor = "#000000",
  shadowOpacity = 0.45,
  disabled = false,
  ariaLabel = "Flip card",
  className = "",
}: FlipCardProps) {
  const reduceMotion = !!useReducedMotion();
  const controlled = flipped !== undefined;
  const [innerFlipped, setInnerFlipped] = useState(defaultFlipped);
  const [dragging, setDragging] = useState(false);
  const shown = controlled ? flipped : innerFlipped;
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const rootRef = useRef<HTMLDivElement>(null);
  const grip = useRef<Grip | null>(null);
  const spin = useRef<AnimationPlaybackControls | null>(null);
  const target = useRef(shown ? 180 : 0);

  const turn = useMotionValue(shown ? 180 : 0);
  const tiltX = useSpring(0, { stiffness: 240, damping: 24, mass: 0.6 });
  const tiltY = useSpring(0, { stiffness: 240, damping: 24, mass: 0.6 });
  const lift = useSpring(1, { stiffness: 320, damping: 26 });
  const sheen = useSpring(0, { stiffness: 320, damping: 26 });
  const glareX = useMotionValue(50);
  const glareY = useMotionValue(50);

  const rotationX = useTransform([turn, tiltX], ([angle, x]: number[]) => angle + x);
  const rotationY = useTransform([turn, tiltY], ([angle, y]: number[]) => angle + y);
  const transformY = useMotionTemplate`perspective(${perspective}px) scale(${lift}) rotateX(${tiltX}deg) rotateY(${rotationY}deg)`;
  const transformX = useMotionTemplate`perspective(${perspective}px) scale(${lift}) rotateY(${tiltY}deg) rotateX(${rotationX}deg)`;
  const facing = useTransform(turn, (angle) => Math.abs(Math.cos((angle * Math.PI) / 180)));
  const shadowSpread = useTransform(facing, (value) => 0.08 + 0.92 * value);
  const shadowShade = useTransform(facing, (value) => 0.1 + 0.9 * value * value);
  const glareXPct = useMotionTemplate`${glareX}%`;
  const glareYPct = useMotionTemplate`${glareY}%`;

  const settle = (nextAngle: number, velocity = 0, instant = false) => {
    spin.current?.stop();
    target.current = nextAngle;
    if (instant || reduceMotion) turn.jump(nextAngle);
    else spin.current = animate(turn, nextAngle, { type: "spring", stiffness, damping, velocity, restDelta: 0.05 });
    const nextFlipped = isBack(nextAngle);
    if (nextFlipped === shownRef.current) return;
    shownRef.current = nextFlipped;
    if (!controlled) setInnerFlipped(nextFlipped);
    onFlipChange?.(nextFlipped);
  };
  const flip = (instant = false) => {
    const base = snap(turn.get());
    settle(isBack(base) ? base - 180 : base + 180, 0, instant);
  };
  const rest = () => {
    tiltX.set(0);
    tiltY.set(0);
    sheen.set(0);
    lift.set(1);
  };

  useEffect(() => {
    if (!controlled || isBack(target.current) === flipped) return;
    const base = target.current;
    spin.current?.stop();
    target.current = isBack(base) ? base - 180 : base + 180;
    if (reduceMotion) turn.jump(target.current);
    else spin.current = animate(turn, target.current, { type: "spring", stiffness, damping, restDelta: 0.05 });
    // Motion values remain stable for the lifetime of the component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flipped]);
  useEffect(() => () => spin.current?.stop(), []);
  useEffect(() => {
    if (disabled) rest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0 || grip.current) return;
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Capture can fail on a detached node. */ }
    spin.current?.stop();
    grip.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      base: turn.get(),
      moved: false,
      slop: event.pointerType === "touch" ? 8 : 4,
      history: [],
    };
    if (!reduceMotion) lift.set(hoverScale);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const activeGrip = grip.current;
    if (activeGrip && activeGrip.id === event.pointerId) {
      const distance = axis === "x" ? event.clientY - activeGrip.y : event.clientX - activeGrip.x;
      if (!activeGrip.moved) {
        if (Math.abs(distance) < activeGrip.slop || !draggable || reduceMotion) return;
        activeGrip.moved = true;
        setDragging(true);
        tiltX.set(0);
        tiltY.set(0);
        sheen.set(0);
      }
      const bounds = event.currentTarget.getBoundingClientRect();
      const span = dragDistance > 0 ? dragDistance : axis === "x" ? bounds.height : bounds.width;
      const angle = activeGrip.base + (axis === "x" ? -1 : 1) * (distance / Math.max(span, 1)) * 180;
      turn.set(angle);
      const now = performance.now();
      activeGrip.history.push({ time: now, angle });
      while (activeGrip.history.length > 2 && now - activeGrip.history[0].time > 90) activeGrip.history.shift();
      return;
    }
    if (!tilt || reduceMotion || disabled || event.pointerType === "touch") return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = clamp((event.clientX - bounds.left) / bounds.width, 0, 1);
    const y = clamp((event.clientY - bounds.top) / bounds.height, 0, 1);
    tiltX.set((0.5 - y) * 2 * tiltMax);
    tiltY.set((x - 0.5) * 2 * tiltMax);
    glareX.set(x * 100);
    glareY.set(y * 100);
    sheen.set(1);
  };
  const release = (event: PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const activeGrip = grip.current;
    if (!activeGrip || activeGrip.id !== event.pointerId) return;
    grip.current = null;
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    } catch { /* The browser may have already released capture. */ }
    setDragging(false);
    if (event.pointerType === "touch" || !rootRef.current?.matches(":hover")) rest();
    if (!activeGrip.moved) {
      if (!cancelled && flipOnClick) flip();
      else settle(target.current);
      return;
    }
    const history = activeGrip.history;
    const first = history[0];
    const last = history[history.length - 1];
    const velocity = !cancelled && first && last && last.time > first.time && performance.now() - last.time < 60
      ? ((last.angle - first.angle) / (last.time - first.time)) * 1000
      : 0;
    const here = turn.get();
    const nextAngle = cancelled
      ? snap(activeGrip.base)
      : clamp(snap(here + velocity * 0.16), snap(here) - 180, snap(here) + 180);
    settle(nextAngle, velocity);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    if (!event.repeat) flip(true);
  };

  const rotorStyle = {
    transform: axis === "x" ? transformX : transformY,
    "--fc-gx": glareXPct,
    "--fc-gy": glareYPct,
    "--fc-sheen": sheen,
  } as MotionStyle;
  const size = (value: number | string) => typeof value === "number" ? `${value}px` : value;

  return (
    <div
      ref={rootRef}
      className={`flip-card ${className}`}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-pressed={shown}
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      data-axis={axis}
      data-draggable={draggable && !disabled && !reduceMotion ? "" : undefined}
      data-dragging={dragging ? "" : undefined}
      data-reduced={reduceMotion ? "" : undefined}
      data-flipped={shown ? "" : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => release(event, false)}
      onPointerCancel={(event) => release(event, true)}
      onLostPointerCapture={(event) => release(event, true)}
      onPointerEnter={(event) => {
        if (!reduceMotion && !disabled && event.pointerType !== "touch") lift.set(hoverScale);
      }}
      onPointerLeave={() => { if (!grip.current) rest(); }}
      onKeyDown={onKeyDown}
      onClick={(event) => { if (!disabled && event.detail === 0) flip(true); }}
      onDragStart={(event) => event.preventDefault()}
      style={{
        "--fc-width": size(width),
        "--fc-height": height === undefined ? "auto" : size(height),
        "--fc-radius": `${radius}px`,
        "--fc-bg": background,
        "--fc-color": color,
        "--fc-shadow": shadowColor,
        "--fc-shadow-opacity": shadowOpacity,
        "--fc-glare-opacity": glareOpacity,
      } as CSSProperties}
    >
      {shadow && (
        <motion.span
          className="flip-card-shadow"
          aria-hidden="true"
          style={axis === "x" ? { scaleY: shadowSpread, opacity: shadowShade } : { scaleX: shadowSpread, opacity: shadowShade }}
        />
      )}
      <motion.div className="flip-card-rotor" style={reduceMotion ? undefined : rotorStyle}>
        <div
          className="flip-card-face flip-card-front"
          aria-hidden={shown}
          ref={(node) => { if (node) node.inert = shown; }}
        >
          {front}
          {glare && <span className="flip-card-glare" aria-hidden="true" />}
        </div>
        <div
          className="flip-card-face flip-card-back"
          aria-hidden={!shown}
          ref={(node) => { if (node) node.inert = !shown; }}
        >
          {back}
          {glare && <span className="flip-card-glare" aria-hidden="true" />}
        </div>
      </motion.div>
    </div>
  );
}
