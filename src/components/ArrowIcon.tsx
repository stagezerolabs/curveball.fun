const rotation = {
  right: 0,
  left: 180,
  "up-right": -45,
  "down-right": 45,
} as const;

export type ArrowDirection = keyof typeof rotation;

/** SVG arrow; Unicode arrows render as emoji on some mobile platforms. */
export function ArrowIcon({
  direction = "right",
  className,
}: {
  direction?: ArrowDirection;
  className?: string;
}): JSX.Element {
  const angle = rotation[direction];
  return (
    <svg
      className={className}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={angle ? { transform: `rotate(${angle}deg)` } : undefined}
    >
      <path d="M4 10h11M11 6l4 4-4 4" />
    </svg>
  );
}

/** Inline arrow sized to the surrounding text. */
export function InlineArrow({
  direction = "up-right",
}: {
  direction?: ArrowDirection;
}): JSX.Element {
  return <ArrowIcon direction={direction} className="inline-arrow" />;
}
