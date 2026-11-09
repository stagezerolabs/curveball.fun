import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import {
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type MotionValue,
} from "motion/react";

export type RubberSegmentItem =
  | string
  | { value: string; label: ReactNode; icon?: ReactNode; disabled?: boolean };

export type RubberSegmentProps = {
  items: RubberSegmentItem[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string, index: number) => void;
  trackColor?: string;
  thumbColor?: string;
  textColor?: string;
  activeTextColor?: string;
  size?: "sm" | "md" | "lg";
  radius?: number;
  inset?: number;
  equalSlots?: boolean;
  stretch?: number;
  squash?: number;
  speed?: number;
  glide?: number;
  draggable?: boolean;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
};

type Slot = { l: number; r: number };
type Sample = [number, number];
type Drag = {
  id: number;
  x0: number;
  slot: number;
  onThumb: boolean;
  live: boolean;
  offset: number;
  width: number;
  history: Sample[];
};

const EASE_OUT: [number, number, number, number] = [0.23, 1, 0.32, 1];
const SPRING_UI = { type: "spring" as const, duration: 0.3, bounce: 0 };
const SPRING_MOMENTUM = { type: "spring" as const, duration: 0.4, bounce: 0.2 };
const SPRING_RELAX = { type: "spring" as const, duration: 0.16, bounce: 0 };
const SIZES = { sm: 28, md: 36, lg: 44 };
const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));
const rubber = (over: number, width: number) =>
  (over * width * 0.55) / (width + 0.55 * Math.abs(over));
const project = (velocity: number, glide: number) => {
  const decay = 1 - 0.1 * Math.pow(0.05, glide / 100);
  return ((velocity / 1000) * decay) / (1 - decay);
};
const velocityOf = (history: Sample[], now: number) => {
  const recent = history.filter(([time]) => now - time <= 100);
  if (recent.length < 2) return 0;
  const [firstTime, firstX] = recent[0];
  const [lastTime, lastX] = recent[recent.length - 1];
  return lastTime - firstTime >= 8
    ? ((lastX - firstX) / (lastTime - firstTime)) * 1000
    : 0;
};

const useBrowserLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

export default function RubberSegment({
  items,
  value,
  defaultValue,
  onChange,
  trackColor = "#27272a",
  thumbColor = "#fafafa",
  textColor = "#fafafa",
  activeTextColor = "#18181b",
  size = "md",
  radius = 10,
  inset = 3,
  equalSlots = true,
  stretch = 100,
  squash = 3,
  speed = 1,
  glide = 75,
  draggable = true,
  disabled = false,
  className = "",
  "aria-label": ariaLabel = "Segmented control",
}: RubberSegmentProps) {
  const list = items.map((item) =>
    typeof item === "string" ? { value: item, label: item } : item,
  );
  const [inner, setInner] = useState(defaultValue ?? list[0]?.value);
  const current = value ?? inner;
  const index = Math.max(0, list.findIndex((item) => item.value === current));
  const reduce = useReducedMotion();
  const trackRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const slots = useRef<Slot[]>([]);
  const box = useRef<DOMRect | null>(null);
  const committed = useRef(index);
  const handoff = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const drag = useRef<Drag | null>(null);
  const generation = useRef(0);
  const edgeL = useMotionValue(0);
  const edgeR = useMotionValue(0);
  const innerW = useMotionValue(0);
  const thumbRadius = Math.max(0, radius - inset);
  const clipPath = useTransform(
    () =>
      `inset(0 ${Math.max(0, innerW.get() - edgeR.get())}px 0 ${Math.max(0, edgeL.get())}px round ${thumbRadius}px)`,
  );
  const duration = (seconds: number) => seconds / Math.max(speed, 0.01);

  const jumpTo = (i: number) => {
    const slot = slots.current[i];
    if (!slot) return;
    clearTimeout(handoff.current);
    generation.current += 1;
    edgeL.jump(slot.l);
    edgeR.jump(slot.r);
  };

  const measure = () => {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    box.current = rect;
    slots.current = list.map((_, i) => {
      const button = buttonRefs.current[i];
      if (!button) return { l: 0, r: 0 };
      const bounds = button.getBoundingClientRect();
      return {
        l: bounds.left - rect.left - inset,
        r: bounds.right - rect.left - inset,
      };
    });
    innerW.set(rect.width - inset * 2);
    jumpTo(committed.current);
  };

  const listKey = list.map((item) => item.value).join("|");
  useBrowserLayoutEffect(() => {
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    if (trackRef.current) observer.observe(trackRef.current);
    if (document.fonts) void document.fonts.ready.then(measure);
    return () => observer.disconnect();
    // The list key captures option identity without depending on a new array each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listKey, size, inset, equalSlots]);

  useEffect(() => {
    if (!drag.current && committed.current !== index) {
      committed.current = index;
      jumpTo(index);
    }
  });

  useEffect(
    () => () => {
      clearTimeout(handoff.current);
      edgeL.stop();
      edgeR.stop();
    },
    [edgeL, edgeR],
  );

  const commit = (i: number) => {
    if (list[i]?.disabled || disabled) return;
    committed.current = i;
    if (i === index) return;
    if (value === undefined) setInner(list[i].value);
    onChange?.(list[i].value, i);
  };

  const land = (to: number, velocity: number | null, flick: boolean, withSquash: boolean) => {
    const slot = slots.current[to];
    if (!slot) return;
    const generationAtStart = ++generation.current;
    const direction =
      Math.sign((slot.l + slot.r - edgeL.get() - edgeR.get()) / 2) || 1;
    const [lead, leadTo, trail, trailTo] =
      direction > 0
        ? [edgeR, slot.r, edgeL, slot.l]
        : [edgeL, slot.l, edgeR, slot.r];
    const velocityFor = (motionValue: MotionValue<number>) =>
      clamp(
        velocity === null ? motionValue.getVelocity() : velocity,
        -2000,
        2000,
      );
    animate(lead, leadTo, {
      ...(flick ? SPRING_MOMENTUM : SPRING_UI),
      duration: duration(flick ? 0.4 : 0.3),
      velocity: velocityFor(lead),
    });
    const trailVelocity = velocityFor(trail);
    if (!withSquash || squash <= 0) {
      animate(trail, trailTo, {
        ...SPRING_UI,
        duration: duration(0.3),
        velocity: trailVelocity,
      });
      return;
    }
    animate(trail, trailTo + direction * squash, {
      ...SPRING_UI,
      duration: duration(0.3),
      velocity: trailVelocity,
    }).then(() => {
      if (generation.current === generationAtStart)
        animate(trail, trailTo, {
          ...SPRING_RELAX,
          duration: duration(0.16),
        });
    });
  };

  const travel = (from: number, to: number) => {
    const start = slots.current[from];
    const end = slots.current[to];
    if (!start || !end) return;
    clearTimeout(handoff.current);
    generation.current += 1;
    if (reduce) {
      edgeL.jump(end.l);
      edgeR.jump(end.r);
      return;
    }
    const stretchRatio = stretch / 100;
    const tween = { duration: duration(0.19), ease: EASE_OUT };
    animate(edgeL, end.l + (Math.min(start.l, end.l) - end.l) * stretchRatio, tween);
    animate(edgeR, end.r + (Math.max(start.r, end.r) - end.r) * stretchRatio, tween);
    handoff.current = setTimeout(() => land(to, null, false, true), duration(0.15) * 1000);
  };

  const localX = (event: { clientX: number }) =>
    event.clientX - (box.current?.left ?? 0) - inset;

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>, i: number) => {
    if (disabled || list[i].disabled || drag.current || event.button !== 0) return;
    box.current = trackRef.current?.getBoundingClientRect() ?? null;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture can fail when the pointer has already been released.
    }
    const x = localX(event);
    const onThumb = draggable && x >= edgeL.get() && x <= edgeR.get();
    drag.current = {
      id: event.pointerId,
      x0: x,
      slot: i,
      onThumb,
      live: false,
      offset: 0,
      width: 0,
      history: [[event.timeStamp, x]],
    };
    if (onThumb) {
      clearTimeout(handoff.current);
      generation.current += 1;
      edgeL.stop();
      edgeR.stop();
    } else if (!reduce) {
      event.currentTarget.dataset.pressed = "";
    }
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active || event.pointerId !== active.id || !active.onThumb) return;
    const x = localX(event);
    active.history.push([event.timeStamp, x]);
    if (active.history.length > 8) active.history.shift();
    if (!active.live) {
      if (Math.abs(x - active.x0) < 4) return;
      active.live = true;
      active.offset = x - edgeL.get();
      active.width = edgeR.get() - edgeL.get();
      if (trackRef.current) trackRef.current.dataset.held = "";
    }
    const width = innerW.get();
    const left = x - active.offset;
    const maxLeft = width - active.width;
    if (reduce) {
      const next = clamp(left, 0, maxLeft);
      edgeL.set(next);
      edgeR.set(next + active.width);
    } else if (left < 0) {
      edgeL.set(0);
      edgeR.set(active.width - rubber(-left, active.width));
    } else if (left > maxLeft) {
      edgeR.set(width);
      edgeL.set(maxLeft + rubber(left - maxLeft, active.width));
    } else {
      edgeL.set(left);
      edgeR.set(left + active.width);
    }
  };

  const release = () => {
    const active = drag.current as Drag;
    drag.current = null;
    if (trackRef.current) delete trackRef.current.dataset.held;
    const button = buttonRefs.current[active.slot];
    if (button) delete button.dataset.pressed;
    return active;
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active || event.pointerId !== active.id) return;
    release();
    const x = localX(event);
    if (!active.live) {
      if (Math.abs(x - active.x0) <= 10 && active.slot !== committed.current) {
        const from = committed.current;
        commit(active.slot);
        travel(from, active.slot);
      }
      return;
    }
    const velocity = velocityOf(active.history, event.timeStamp);
    const flick = Math.abs(velocity) > 110;
    const projected = (edgeL.get() + edgeR.get()) / 2 + project(velocity, glide);
    const enabled = list
      .map((item, i) => (item.disabled ? -1 : i))
      .filter((i) => i >= 0);
    if (enabled.length === 0) return;
    let to = enabled.reduce((best, i) => {
      const center = (slots.current[i].l + slots.current[i].r) / 2;
      const bestCenter = (slots.current[best].l + slots.current[best].r) / 2;
      return Math.abs(center - projected) < Math.abs(bestCenter - projected)
        ? i
        : best;
    });
    if (flick && to === committed.current) {
      const next = enabled.filter((i) =>
        velocity > 0 ? i > to : i < to,
      );
      if (next.length) to = velocity > 0 ? next[0] : next[next.length - 1];
    }
    commit(to);
    if (reduce) jumpTo(to);
    else land(to, velocity, flick, flick);
  };

  const handlePointerCancel = (event: PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active || event.pointerId !== active.id) return;
    release();
    if (reduce) jumpTo(committed.current);
    else land(committed.current, null, false, false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    const enabled = list
      .map((item, i) => (item.disabled ? -1 : i))
      .filter((i) => i >= 0);
    let next: number | undefined;
    if (event.key === "ArrowRight" || event.key === "ArrowDown")
      next = enabled.find((i) => i > index) ?? enabled[0];
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
      next = [...enabled].reverse().find((i) => i < index) ?? enabled.at(-1);
    else if (event.key === "Home") next = enabled[0];
    else if (event.key === "End") next = enabled.at(-1);
    if (next === undefined) return;
    event.preventDefault();
    if (next !== index) {
      const from = committed.current;
      commit(next);
      travel(from, next);
    }
    buttonRefs.current[next]?.focus();
  };

  const style = {
    "--rs-track": trackColor,
    "--rs-thumb": thumbColor,
    "--rs-ink": textColor,
    "--rs-ink-active": activeTextColor,
    "--rs-radius": `${radius}px`,
    "--rs-inset": `${inset}px`,
    "--rs-thumb-radius": `${thumbRadius}px`,
    "--rs-height": `${SIZES[size]}px`,
  } as CSSProperties;

  return (
    <div
      ref={trackRef}
      role="radiogroup"
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      data-equal={equalSlots ? "" : undefined}
      data-draggable={draggable && !disabled ? "" : undefined}
      className={`rubber-segment${className ? ` ${className}` : ""}`}
      style={style}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handlePointerCancel}
    >
      {list.map((item, i) => (
        <button
          key={item.value}
          ref={(node) => {
            buttonRefs.current[i] = node;
          }}
          type="button"
          role="radio"
          aria-checked={i === index}
          tabIndex={i === index ? 0 : -1}
          disabled={disabled || item.disabled}
          onPointerDown={(event) => handlePointerDown(event, i)}
          onClick={(event) => {
            if (event.detail !== 0 || i === committed.current) return;
            const from = committed.current;
            commit(i);
            travel(from, i);
          }}
          onKeyDown={handleKeyDown}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
      <motion.div className="rubber-segment-thumb" aria-hidden="true" style={{ clipPath }}>
        {list.map((item) => (
          <span key={item.value}>
            {item.icon}
            {item.label}
          </span>
        ))}
      </motion.div>
    </div>
  );
}
