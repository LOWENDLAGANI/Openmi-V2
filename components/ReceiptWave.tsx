"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";
import { useFormStatus } from "react-dom";

/**
 * The receipt wave: a web reading of Libraries.dev's `DistortionWave`.
 *
 * That kit is SwiftUI plus Metal, and this is a Next.js page, so what ports is
 * the idea and its geometry rather than the shader: the wave opens from the
 * frame of the button that was pressed, leans toward the point that was
 * touched, and carries the eye from the form into the screen that replaces it
 * once the upload is taken.
 *
 * It runs on `useFormStatus`, so it can only appear for a submission the browser
 * actually accepted: an empty plan or a missing reference never starts a wave,
 * because the form never submits.
 *
 * `prefers-reduced-motion` skips the whole thing — the submit is still shown by
 * the button's pending label, which is the information the wave decorates.
 */

/** The wave reaches the far corner in this long, then fades away. */
const EXPAND_MS = 620;
const FADE_MS = 380;

/** Bands painted from the rim inward; each is a wobbling arc. */
const BANDS = 6;

/** Hues taken from the colourful preset: cool at the rim, warm at the core. */
const HUES = [205, 232, 262, 292, 318, 36];

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

export function ReceiptWave({ children }: { children: ReactNode }) {
  const { pending } = useFormStatus();

  const holder = useRef<HTMLSpanElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const source = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const focus = useRef<{ x: number; y: number } | null>(null);
  const reduced = useRef(false);

  const [running, setRunning] = useState(false);

  useEffect(() => {
    reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  /**
   * The press, remembered before the submit happens: the button's frame is the
   * wave's source and the pointer is the focus it leans toward, the same two
   * inputs the SwiftUI component takes.
   */
  const remember = useCallback((event: PointerEvent<HTMLSpanElement>) => {
    const button = (event.target as HTMLElement | null)?.closest("button");
    const box = button?.getBoundingClientRect();

    if (box) {
      source.current = { x: box.x, y: box.y, w: box.width, h: box.height };
    }

    focus.current = { x: event.clientX, y: event.clientY };
  }, []);

  useEffect(() => {
    if (!pending || reduced.current) return;
    setRunning(true);
  }, [pending]);

  useEffect(() => {
    if (!running) return;

    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");

    if (!canvas || !context) {
      setRunning(false);
      return;
    }

    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = window.innerWidth;
    const height = window.innerHeight;

    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);

    // A keyboard submit has no pointer, so the button is measured instead.
    const fallback = holder.current
      ?.closest("form")
      ?.querySelector('button[type="submit"]')
      ?.getBoundingClientRect();

    const box = source.current ?? (fallback ? {
      x: fallback.x,
      y: fallback.y,
      w: fallback.width,
      h: fallback.height,
    } : null);

    const cx = focus.current?.x ?? (box ? box.x + box.w / 2 : width / 2);
    const cy = focus.current?.y ?? (box ? box.y + box.h / 2 : height / 2);

    // Far enough that the wobbling rim still clears the farthest corner.
    const reach =
      Math.hypot(Math.max(cx, width - cx), Math.max(cy, height - cy)) + 80;

    const started = performance.now();
    let frame = 0;

    const paint = (now: number) => {
      const elapsed = now - started;
      const grow = Math.min(1, elapsed / EXPAND_MS);
      const fade = Math.max(0, Math.min(1, (elapsed - EXPAND_MS) / FADE_MS));

      context.clearRect(0, 0, width, height);

      if (fade >= 1) {
        setRunning(false);
        return;
      }

      const radius = easeOutCubic(grow) * reach;
      const wobble = 26 * (1 - grow * 0.6) * (1 - fade);
      const gap = radius / (BANDS + 1);

      for (let band = 0; band < BANDS; band += 1) {
        const base = radius - band * gap;
        if (base <= 0) continue;

        context.beginPath();

        for (let step = 0; step <= 96; step += 1) {
          const angle = (step / 96) * Math.PI * 2;
          const edge =
            Math.sin(angle * 6 + now / 420 + band * 0.9) * wobble +
            Math.sin(angle * 11 - now / 260) * wobble * 0.35;
          const distance = Math.max(0, base + edge);
          const px = cx + Math.cos(angle) * distance;
          const py = cy + Math.sin(angle) * distance;

          if (step === 0) context.moveTo(px, py);
          else context.lineTo(px, py);
        }

        context.closePath();
        context.globalAlpha = 1 - fade;
        context.fillStyle = `hsl(${HUES[band % HUES.length]} 88% 62%)`;
        context.fill();
      }

      context.globalAlpha = 1;
      frame = requestAnimationFrame(paint);
    };

    frame = requestAnimationFrame(paint);

    return () => {
      cancelAnimationFrame(frame);
      context.clearRect(0, 0, width, height);
    };
  }, [running]);

  return (
    <span ref={holder} className="contents" onPointerDown={remember}>
      {children}
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className={`pointer-events-none fixed inset-0 z-[80] size-full ${
          running ? "" : "hidden"
        }`}
      />
    </span>
  );
}
