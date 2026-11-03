/**
 * The brand mark.
 *
 * The uploaded logo is one flat ink colour, so it ships twice: the ink copy for
 * paper surfaces and a near-white copy for the night and ink canvases. Both are
 * rendered and CSS decides which one is visible (`.mark-on-dark` /
 * `.mark-on-light`), which keeps this a server component with no client state.
 *
 * A hand-drawn sparkle sits underneath as the fallback: if the image cannot be
 * fetched, the empty `alt` renders nothing and the SVG shows through. Nothing
 * here loads a font or blocks paint.
 */
export function OpenmiMark({
  size = 24,
  className = "",
  label,
}: {
  size?: number;
  className?: string;
  /** Accessible name. Omit when the mark sits next to the word "Openmi". */
  label?: string;
}) {
  return (
    <span
      className={`relative inline-grid shrink-0 place-items-center ${className}`}
      style={{ width: size, height: size }}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <svg
        aria-hidden="true"
        focusable="false"
        viewBox="0 0 32 32"
        className="absolute inset-0 h-full w-full"
      >
        <defs>
          <linearGradient id="openmi-sparkle" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#bfe6cd" />
            <stop offset="55%" stopColor="#3f7d5c" />
            <stop offset="100%" stopColor="#1f4a33" />
          </linearGradient>
        </defs>
        <path
          d="M16 2.5c1.9 6.2 4.3 8.6 10.5 10.5-6.2 1.9-8.6 4.3-10.5 10.5C14.1 17.3 11.7 14.9 5.5 13 11.7 11.1 14.1 8.7 16 2.5Z"
          fill="url(#openmi-sparkle)"
        />
        <path
          d="M16 9.4v7.2M12.6 13h6.8"
          stroke="#0d1a13"
          strokeWidth="1.6"
          strokeLinecap="round"
          opacity="0.75"
        />
      </svg>

      <img
        src="/openmi-mark-inverse.png"
        alt=""
        aria-hidden="true"
        draggable={false}
        width={494}
        height={466}
        className="mark-on-dark relative h-full w-full select-none object-contain"
      />
      <img
        src="/openmi-mark.png"
        alt=""
        aria-hidden="true"
        draggable={false}
        width={494}
        height={466}
        className="mark-on-light absolute inset-0 h-full w-full select-none object-contain"
      />
    </span>
  );
}
