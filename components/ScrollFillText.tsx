"use client";

import { useEffect, useRef } from "react";

/**
 * Groq-style manifesto: every word starts muted and turns ink once it crosses
 * the fill line, so scrolling down darkens the paragraph a word at a time.
 *
 * The threshold is measured per word rather than as one progress value across
 * the block, because that is what makes a tall paragraph read as "the text is
 * filling in" instead of "the paragraph fades". Word positions are cached in
 * document space on mount and on resize; the scroll handler only compares
 * numbers, so it never forces layout mid-scroll.
 */
export function ScrollFillText({
  stanzas,
  className = "",
}: {
  stanzas: string[];
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

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      for (const word of words) word.classList.add("is-filled");
      return;
    }

    let tops: number[] = [];
    let frame = 0;

    const measure = () => {
      tops = words.map(
        (word) => word.getBoundingClientRect().top + window.scrollY
      );
    };

    const paint = () => {
      frame = 0;
      const filledUntil = window.scrollY + window.innerHeight * 0.62;
      for (let index = 0; index < words.length; index += 1) {
        const filled = tops[index] <= filledUntil;
        const word = words[index];
        if (word.classList.contains("is-filled") !== filled) {
          word.classList.toggle("is-filled", filled);
        }
      }
    };

    const schedule = () => {
      if (frame === 0) frame = window.requestAnimationFrame(paint);
    };

    const onResize = () => {
      measure();
      schedule();
    };

    measure();
    paint();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", onResize);

    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", onResize);
    };
  }, [stanzas]);

  return (
    <div ref={rootRef} className={className}>
      {stanzas.map((stanza, stanzaIndex) => (
        <p
          key={stanzaIndex}
          className="manifesto-stanza manifesto-stanza--tight"
        >
          {stanza.split(" ").map((word, wordIndex) => (
            <span key={`${stanzaIndex}-${wordIndex}`}>
              <span data-fill-word className="fill-word">
                {word}
              </span>{" "}
            </span>
          ))}
        </p>
      ))}
    </div>
  );
}
