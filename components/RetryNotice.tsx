"use client";

import { useEffect, useState } from "react";

import { splitRetryNotice } from "@/lib/rate-limit";

/**
 * A refusal that counts down.
 *
 * The server already sends "Try again in 58 seconds." and the reader then stares
 * at 58 while it could be 12. The number is the one thing on that line that is
 * still true a minute later, so it is rendered as a clock that ticks. Anything
 * that is not a rate-limit sentence is printed unchanged — this component never
 * invents a reason.
 */
export function RetryNotice({ message }: { message: string }) {
  const { text, seconds } = splitRetryNotice(message);
  const [left, setLeft] = useState(seconds ?? 0);

  useEffect(() => {
    setLeft(seconds ?? 0);

    if (seconds === null) return;

    const timer = window.setInterval(() => {
      setLeft((value) => (value > 0 ? value - 1 : 0));
    }, 1_000);

    return () => window.clearInterval(timer);
  }, [seconds]);

  if (seconds === null) return <>{message}</>;

  const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;

  return (
    <span>
      {text}{" "}
      <span className="font-mono tabular-nums">
        {left > 0 ? `try again in ${clock}` : "try again now"}
      </span>
    </span>
  );
}
