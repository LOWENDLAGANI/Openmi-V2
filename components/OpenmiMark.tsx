/**
 * The brand mark.
 *
 * The uploaded logo is one flat ink colour, so it ships twice: the ink copy for
 * paper surfaces and a near-white copy for the dark canvases. Both are rendered
 * and CSS decides which one is visible (`.mark-on-dark` / `.mark-on-light`),
 * which keeps this a server component with no client state.
 *
 * Both PNGs have a transparent background, so nothing may be painted behind
 * them: an earlier hand-drawn sparkle fallback sat underneath and its arms showed
 * through the counter of the mark. The image is the whole mark; the wordmark
 * beside it is the fallback when an image cannot load.
 */
export function OpenmiMark({
  size = 24,
  className = "",
  label,
}: {
  size?: number;
  className?: string;
  /** Accessible name. Omit when the mark sits next to the word "openmi". */
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
      <img
        src="/openmi-mark-inverse.png"
        alt=""
        aria-hidden="true"
        draggable={false}
        width={494}
        height={466}
        className="mark-on-dark h-full w-full select-none object-contain"
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
