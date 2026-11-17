/**
 * The product, drawn in HTML.
 *
 * A landing page for a developer tool has one job above all others: show the
 * thing. These are not screenshots, so they cannot go stale, they cost no
 * bytes on the wire, they scale with the reader's font size, and they follow
 * the three appearances because every colour is a token.
 *
 * Both mocks are inert: the controls are spans, the block is labelled as one
 * image for assistive technology, and its contents are hidden from it. A fake
 * button that can be focused is a trap, and a screen reader reading out a
 * pretend diff helps nobody.
 */

type DiffLine = {
  kind: "ctx" | "add" | "del";
  n: number;
  text: string;
};

const DIFF: DiffLine[] = [
  { kind: "ctx", n: 206, text: "}" },
  { kind: "ctx", n: 207, text: "" },
  { kind: "del", n: 208, text: "  const bucket = await bucketFor(model);" },
  { kind: "del", n: 209, text: "  await release(run.id, bucket);" },
  { kind: "add", n: 208, text: "  const bucket = await bucketFor(model);" },
  { kind: "add", n: 209, text: "  await release(run.id, bucket, {" },
  { kind: "add", n: 210, text: "    reaped: run.reaped_at !== null," },
  { kind: "add", n: 211, text: "  });" },
  { kind: "ctx", n: 212, text: "}" },
];

const SIGN: Record<DiffLine["kind"], string> = {
  ctx: " ",
  add: "+",
  del: "−",
};

/**
 * A turn in the workspace: the question, the answer with its citation, the
 * tools it read, and the diff it proposed — the four things this product
 * actually produces, in the order it produces them.
 */
export function WorkspaceFrame() {
  return (
    <div
      role="img"
      aria-label="The Openmi workspace. A question about the refund path, an answer citing lib/refunds.ts line 212, three read-only tools, and a proposed diff to lib/refunds.ts awaiting accept or reject."
      className="preview-frame"
    >
      <div aria-hidden="true" className="preview-bar">
        <span className="preview-dots">
          <span />
          <span />
          <span />
        </span>
        <span className="truncate font-mono text-[11px] text-mid">
          LOWENDLAGANI/Openmi-V2
        </span>
        <span className="ml-auto shrink-0 font-mono text-[10.5px] text-low">
          612f414
        </span>
      </div>

      <div aria-hidden="true" className="grid md:grid-cols-[0.85fr_1.15fr]">
        <div className="hidden flex-col gap-3 border-line p-4 md:flex md:border-r">
          <p className="ml-auto max-w-[24ch] rounded-2xl rounded-br-md bg-accent px-3 py-2 text-[12px] leading-[1.55] text-on-accent">
            A reaped run refunds the wrong bucket. Fix the lookup.
          </p>

          <div className="min-w-0">
            <p className="text-[12px] leading-[1.6] text-mid">
              The release does not say whether the run was reaped, so a reaped
              run’s hour goes back to the default bucket. The diff passes the
              flag; the amount is untouched.
            </p>
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-hover px-1.5 py-0.5 font-mono text-[10.5px] text-accent-text">
              lib/refunds.ts:212
            </p>
          </div>

          <ol className="mt-auto space-y-1 border-t border-line pt-2.5">
            {[
              ["read_file", "lib/refunds.ts"],
              ["search_code", "reaped_at"],
              ["read_file", "supabase/migrations"],
            ].map(([tool, arg]) => (
              <li
                key={tool + arg}
                className="flex items-baseline gap-2 truncate font-mono text-[10.5px] text-low"
              >
                <span className="text-accent-text">{tool}</span>
                <span className="truncate">{arg}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="min-w-0 p-3 sm:p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-mono text-[11px] text-mid">
              openmi/agent/8f2c1d
            </span>
            <span className="shrink-0 rounded-full border border-line-strong px-2 py-0.5 text-[10px] text-low">
              3 files
            </span>
          </div>

          <div className="mt-2 overflow-hidden rounded-xl border border-line">
            <div className="flex items-center justify-between gap-2 border-b border-line bg-raised px-2.5 py-1.5">
              <span className="truncate font-mono text-[10.5px] text-body">
                lib/refunds.ts
              </span>
              <span className="shrink-0 font-mono text-[10px] tabular-nums">
                <span className="text-accent-text">+12</span>{" "}
                <span className="text-danger">−4</span>
              </span>
            </div>

            <p className="border-b border-line bg-raised px-2.5 py-1 font-mono text-[10px] text-low">
              @@ -208,7 +208,9 @@
            </p>

            <div className="py-1">
              {DIFF.map((line) => (
                <div
                  key={`${line.kind}-${line.n}`}
                  className={`diff-row ${
                    line.kind === "add"
                      ? "diff-row--add"
                      : line.kind === "del"
                        ? "diff-row--del"
                        : ""
                  }`}
                >
                  <span className="text-right text-low">{line.n}</span>
                  <span
                    className={
                      line.kind === "add"
                        ? "text-center text-accent-text"
                        : line.kind === "del"
                          ? "text-center text-danger"
                          : "text-center text-line-strong"
                    }
                  >
                    {SIGN[line.kind]}
                  </span>
                  <span className="whitespace-pre text-body">{line.text}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-2.5 flex items-center gap-1.5">
            <span className="rounded-full bg-accent px-2.5 py-1 text-[11px] font-medium text-on-accent">
              Accept file
            </span>
            <span className="rounded-full border border-line-strong px-2.5 py-1 text-[11px] text-mid">
              Reject
            </span>
            <span className="ml-auto hidden font-mono text-[10px] text-low sm:block">
              1 of 3
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * What a turn is made of, tool by tool. The names are the four the agent
 * really has on a GitHub-only turn, and the sizes are the caps it really
 * enforces, so the card cannot drift into a nicer story than the product.
 */
export function RunTrace() {
  const steps = [
    { tool: "list_files", arg: "≤ 200 paths", note: "the tree at the pin" },
    { tool: "read_file", arg: "≤ 200 KB", note: "text only" },
    { tool: "search_code", arg: "≤ 10 hits", note: "then reads the winner" },
    { tool: "propose_edits", arg: "≤ 24 files", note: "as a unified diff" },
  ];

  return (
    <div className="rounded-2xl border border-line bg-card p-4 shadow-[var(--card-shadow)] sm:p-5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-low">
          turn 04
        </p>
        <p className="font-mono text-[10.5px] tabular-nums text-low">
          9.4k tokens
        </p>
      </div>

      <ol className="mt-3">
        {steps.map((step, index) => (
          <li
            key={step.tool}
            className="grid grid-cols-[1.5rem_1fr_auto] items-baseline gap-2 border-t border-line py-2.5 first:border-t-0 first:pt-0"
          >
            <span className="font-mono text-[10px] tabular-nums text-low">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span className="min-w-0">
              <span className="font-mono text-[12px] text-accent-text">
                {step.tool}
              </span>
              <span className="ml-2 text-[11.5px] text-mid">{step.note}</span>
            </span>
            <span className="font-mono text-[10.5px] tabular-nums text-low">
              {step.arg}
            </span>
          </li>
        ))}
      </ol>

      <p className="mt-3 border-t border-line pt-2.5 font-mono text-[10.5px] text-low">
        stops at 40 steps or 120k tokens
      </p>
    </div>
  );
}
