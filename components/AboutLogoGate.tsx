"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  advanceGesture,
  directionOf,
  GESTURE_IDLE,
  type GestureState,
} from "@/lib/admin/gesture";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * The one place the hidden admin gesture lives: its own logo, on /about.
 *
 * Swipe up, down, left, right on the mark (mouse drag or finger) to reveal the
 * verification card. The gesture grants nothing — `/admin` resolves the
 * operator role on the server from the verified email or the database role, and
 * answers 404 to anyone else.
 *
 * It is not inside a link, so a drag never navigates and the card can use a
 * portal without competing with an anchor's default action.
 */
export function AboutLogoGate() {
  const [unlocked, setUnlocked] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [admin, setAdmin] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const gesture = useRef<GestureState>(GESTURE_IDLE);
  const anchor = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => setMounted(true), []);

  // The card only needs one fact: is this session already an operator? The
  // answer comes from the server, never from local state.
  useEffect(() => {
    if (!unlocked) return;
    let cancelled = false;

    void fetch("/api/admin/status", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : { admin: false }))
      .then((data: { admin?: boolean }) => {
        if (!cancelled) setAdmin(Boolean(data.admin));
      })
      .catch(() => {
        if (!cancelled) setAdmin(false);
      });

    return () => {
      cancelled = true;
    };
  }, [unlocked]);

  function onPointerDown(event: React.PointerEvent<HTMLSpanElement>) {
    anchor.current = { x: event.clientX, y: event.clientY };
  }

  function onPointerMove(event: React.PointerEvent<HTMLSpanElement>) {
    const start = anchor.current;
    if (!start) return;

    const direction = directionOf(
      event.clientX - start.x,
      event.clientY - start.y
    );

    if (!direction) return;

    const result = advanceGesture(gesture.current, direction, Date.now());
    gesture.current = result.state;

    // Continue from here, so one long drag can supply several steps.
    anchor.current = { x: event.clientX, y: event.clientY };

    if (result.unlocked) setUnlocked(true);
  }

  function onPointerUp() {
    anchor.current = null;
  }

  async function verify() {
    const supabase = supabaseBrowser();

    if (!supabase) {
      setError("Supabase is not configured for this deployment.");
      return;
    }

    setBusy(true);
    setError(null);

    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(
          "/admin"
        )}`,
        queryParams: { prompt: "select_account" },
      },
    });

    if (oauthError) {
      setBusy(false);
      setError(
        oauthError.message.toLowerCase().includes("provider")
          ? "Google sign-in is not enabled in Supabase Auth yet."
          : oauthError.message
      );
    }
    // On success the browser leaves for Google; staying busy is correct.
  }

  return (
    <span
      role="img"
      aria-label="Openmi"
      draggable={false}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className="inline-flex touch-none select-none items-center gap-3"
      style={{ touchAction: "none" }}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="size-11 shrink-0 text-accent"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 15 12 7l8 8" />
        <path d="M4 20 12 12l8 8" opacity="0.45" />
      </svg>
      <span className="text-[30px] font-semibold leading-none tracking-[-0.04em] text-hi">
        openmi
      </span>

      {mounted &&
        unlocked &&
        createPortal(
          <div
            role="dialog"
            aria-label="Admin verification"
            className="fade-in fixed bottom-4 right-4 z-[70] w-[calc(100%-2rem)] max-w-xs rounded-3xl border border-line-strong bg-card p-4 shadow-[0_24px_60px_rgba(22,18,12,0.28)]"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="eyebrow">restricted</p>
                <p className="mt-1 text-[14px] font-semibold tracking-[-0.02em] text-hi">
                  Admin verification
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setUnlocked(false);
                  setError(null);
                }}
                aria-label="Close admin verification"
                className="grid size-6 shrink-0 place-items-center rounded-full text-[14px] leading-none text-low hover:bg-hover hover:text-hi"
              >
                ×
              </button>
            </div>

            <p className="mt-2 text-[11.5px] leading-relaxed text-mid">
              Google sign-in decides access on the server. An account without
              the operator role gets a 404, not this panel.
            </p>

            {error && (
              <p
                role="alert"
                className="mt-3 rounded-xl border border-danger/25 bg-danger/8 px-3 py-2 text-[11px] leading-relaxed text-danger"
              >
                {error}
              </p>
            )}

            {admin === true ? (
              <Link
                href="/admin"
                onClick={() => setUnlocked(false)}
                className="btn btn-primary mt-3 w-full py-2 text-[12px]"
              >
                Open admin panel
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => void verify()}
                disabled={busy}
                className="btn btn-primary mt-3 w-full gap-2 py-2 text-[12px]"
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  className="size-3.5"
                  fill="currentColor"
                >
                  <path d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.4Z" />
                  <path d="M12 22c2.7 0 4.9-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.7-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22Z" />
                  <path d="M6.4 14a6 6 0 0 1 0-3.9V7.5H3.1a10 10 0 0 0 0 9l3.3-2.5Z" />
                  <path d="M12 6c1.5 0 2.8.5 3.8 1.5l2.8-2.8A9.7 9.7 0 0 0 12 2a10 10 0 0 0-8.9 5.5l3.3 2.6C7.2 7.7 9.4 6 12 6Z" />
                </svg>
                {busy ? "Opening Google…" : "Verify with Google"}
              </button>
            )}

            {admin === false && (
              <p className="mt-2 text-[10.5px] leading-relaxed text-low">
                This session has no operator role.
              </p>
            )}
          </div>,
          document.body
        )}
    </span>
  );
}
