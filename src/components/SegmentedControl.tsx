import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";

export type SegmentedControlOption<Value extends string> = {
  value: Value;
  label: ReactNode;
};

const useBrowserLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

export function SegmentedControl<Value extends string>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: Value;
  options: readonly SegmentedControlOption<Value>[];
  onChange: (value: Value) => void;
  label: string;
  className?: string;
}) {
  const groupRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const activeIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });

  const positionIndicator = useCallback((index: number) => {
    const button = buttonRefs.current[index];
    if (!button) return;
    const next = { left: button.offsetLeft, width: button.offsetWidth };
    setIndicator((current) =>
      current.left === next.left && current.width === next.width
        ? current
        : next,
    );
  }, []);

  useBrowserLayoutEffect(() => {
    positionIndicator(activeIndex);
    const group = groupRef.current;
    if (!group || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => positionIndicator(activeIndex));
    observer.observe(group);
    return () => observer.disconnect();
  }, [activeIndex, positionIndicator]);

  const select = (index: number) => {
    positionIndicator(index);
    onChange(options[index].value);
  };

  const handleKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown")
      nextIndex = (index + 1) % options.length;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp")
      nextIndex = (index - 1 + options.length) % options.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = options.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    select(nextIndex);
    buttonRefs.current[nextIndex]?.focus();
  };

  const indicatorStyle = {
    "--segmented-control-x": `${indicator.left}px`,
    "--segmented-control-width": `${indicator.width}px`,
  } as CSSProperties;

  return (
    <div
      ref={groupRef}
      className={`animated-segmented${className ? ` ${className}` : ""}`}
      role="radiogroup"
      aria-label={label}
      data-indicator-ready={indicator.width > 0}
      style={indicatorStyle}
    >
      <span className="animated-segmented-indicator" aria-hidden="true" />
      {options.map((option, index) => (
        <button
          ref={(node) => {
            buttonRefs.current[index] = node;
          }}
          key={option.value}
          type="button"
          className={value === option.value ? "active" : ""}
          role="radio"
          aria-checked={value === option.value}
          tabIndex={value === option.value ? 0 : -1}
          onClick={() => select(index)}
          onKeyDown={(event) => handleKeyDown(event, index)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
