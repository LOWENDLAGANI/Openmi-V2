"use client";

import { useEffect, useRef } from "react";

/**
 * Groq-style scroll fill for the whole landing page.
 *
 * Every question and answer is split into words. A word is inked once it has
 * crossed a fill line fixed at 58% of the viewport, so scrolling down darkens
 * the page one word at a time and scrolling back up un-inks it again.
 *
 * Two details keep this from looking broken:
 *   - Words are ink by default. The muted baseline is only switched on by
 *     `data-fill-ready`, which the effect sets after it has measured, so a
 *     failed hydration or blocked script leaves readable text, not a grey wall.
 *   - Word positions are re-measured on resize, orientation change, font load
 *     and any size change of the block itself, so web-font swaps and mobile
 *     URL-bar reflows do not leave words stuck on the wrong side of the line.
 */

export type Question = {
  question: string;
  answer: string;
};

function Words({ text, prefix }: { text: string; prefix: string }) {
  const parts = text.split(" ");

  return (
    <>
      {parts.map((word, index) => (
        <span key={`${prefix}-${index}`}>
          <span data-fill-word className="fill-word">
            {word}
          </span>
          {index < parts.length - 1 ? " " : null}
        </span>
      ))}
    </>
  );
}

export function ScrollFillText({
  items,
  className = "",
}: {
  items: readonly Question[];
  className?: string;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const words = Array.from(
      root.querySelectorAll<HTMLElement>("[data-fill-word]")
    );
    if (words.length === 0) return;

    // Only now does the muted baseline apply; before this the text is ink.
    root.dataset.fillReady = "true";

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      for (const word of words) word.classList.add("is-filled");
      return;
    }

    let tops: number[] = [];
    let frame = 0;
    let disposed = false;

    const measure = () => {
      if (disposed) return;
      const scrollY = window.scrollY;
      tops = words.map(
        (word) => word.getBoundingClientRect().top + scrollY
      );
    };

    const paint = () => {
      frame = 0;
      if (disposed) return;
      const line = window.scrollY + window.innerHeight * 0.58;
      for (let index = 0; index < words.length; index += 1) {
        const filled = tops[index] <= line;
        const word = words[index];
        if (word.classList.contains("is-filled") !== filled) {
          word.classList.toggle("is-filled", filled);
        }
      }
    };

    const schedule = () => {
      if (frame === 0) frame = window.requestAnimationFrame(paint);
    };

    const remeasure = () => {
      measure();
      schedule();
    };

    const settle = window.setTimeout(remeasure, 700);
    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(remeasure);
      observer.observe(root);
    }

    measure();
    paint();
    void document.fonts?.ready.then(remeasure).catch(() => undefined);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", remeasure);
    window.addEventListener("orientationchange", remeasure);

    return () => {
      disposed = true;
      window.clearTimeout(settle);
      observer?.disconnect();
      if (frame !== 0) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", remeasure);
      window.removeEventListener("orientationchange", remeasure);
    };
  }, []);

  return (
    <div ref={rootRef} className={`fill-root ${className}`.trim()}>
      {items.map((item, index) => (
        <article key={item.question} className="qa-item">
          <span className="qa-index" aria-hidden="true">
            {String(index + 1).padStart(2, "0")}
          </span>
          <div className="qa-body">
            <h2 className="qa-q">
              <Words text={item.question} prefix={`q-${index}`} />
            </h2>
            <p className="qa-a">
              <Words text={item.answer} prefix={`a-${index}`} />
            </p>
          </div>
        </article>
      ))}
    </div>
  );
}
