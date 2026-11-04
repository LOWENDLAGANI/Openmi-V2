"use client";

import { gsap } from "gsap";
import { ScrollToPlugin } from "gsap/ScrollToPlugin";
import { useEffect, useRef, useState } from "react";

/**
 * Motion, in one place.
 *
 * Three rules, all learned from the CSS this replaces:
 *
 * 1. Transform and opacity only. A tween that moves layout is a tween that
 *    stutters on a phone.
 * 2. The reader's `prefers-reduced-motion` wins, before the first tween is
 *    built — not by animating and then cancelling.
 * 3. Nothing animates per token. Streaming text moves the scroll instantly; a
 *    finished message is the only thing that eases.
 */

export const MOTION_FAST = 0.28;
export const MOTION_EASE = "power2.out";

let registered = false;

/** Registered lazily so the module stays safe during server rendering. */
function ensureScrollPlugin() {
  if (registered || typeof window === "undefined") return;
  gsap.registerPlugin(ScrollToPlugin);
  registered = true;
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(query.matches);

    sync();
    query.addEventListener("change", sync);

    return () => query.removeEventListener("change", sync);
  }, []);

  return reduced;
}

/** A single element that rises into place once, when it mounts. */
export function useEnter<T extends HTMLElement>(options: {
  y?: number;
  delay?: number;
  duration?: number;
} = {}) {
  const { y = 10, delay = 0, duration = MOTION_FAST } = options;
  const ref = useRef<T | null>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const element = ref.current;
    if (!element || reduced) return;

    const tween = gsap.fromTo(
      element,
      { autoAlpha: 0, y },
      {
        autoAlpha: 1,
        y: 0,
        duration,
        delay,
        ease: MOTION_EASE,
        // Leave no inline transform behind, so hover and layout stay CSS-owned.
        clearProps: "transform,visibility,opacity",
      }
    );

    return () => {
      tween.kill();
    };
  }, [reduced, y, delay, duration]);

  return ref;
}

/** Children matching a selector, rising in sequence. */
export function useStagger<T extends HTMLElement>(
  selector: string,
  options: { y?: number; stagger?: number; delay?: number } = {}
) {
  const { y = 12, stagger = 0.045, delay = 0 } = options;
  const ref = useRef<T | null>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const root = ref.current;
    if (!root || reduced) return;

    const targets = root.querySelectorAll(selector);
    if (targets.length === 0) return;

    const tween = gsap.fromTo(
      targets,
      { autoAlpha: 0, y },
      {
        autoAlpha: 1,
        y: 0,
        duration: MOTION_FAST,
        delay,
        stagger,
        ease: MOTION_EASE,
        clearProps: "transform,visibility,opacity",
      }
    );

    return () => {
      tween.kill();
    };
  }, [reduced, selector, y, stagger, delay]);

  return ref;
}

/**
 * Follows the end of the transcript.
 *
 * `instant` is for streaming: text that arrives many times a second must not
 * start a tween per token. A finished message gets one tween, and a reader who
 * scrolls up cancels it (autoKill) instead of being dragged back down.
 */
export function scrollToBottom(
  element: HTMLElement,
  instant: boolean
): gsap.core.Tween | null {
  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (instant || reduced) {
    element.scrollTop = element.scrollHeight;
    return null;
  }

  ensureScrollPlugin();

  return gsap.to(element, {
    scrollTo: { y: element.scrollHeight, autoKill: true },
    duration: 0.4,
    ease: MOTION_EASE,
  });
}
