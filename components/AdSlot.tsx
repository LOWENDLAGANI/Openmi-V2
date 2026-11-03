"use client";

import { useMemo } from "react";

import { AD_SLOTS, adConfig, type AdSlotId } from "@/lib/ads";

/**
 * One reserved banner slot.
 *
 * The box is always the same size whether or not a key is configured, so
 * enabling ads later cannot shift the page. Until then it shows a labelled
 * placeholder — visible on purpose, because a blank gap in the design is harder
 * to judge than an honest outline.
 *
 * The ad runs in an iframe: Adsterra's loader uses `document.write`, and
 * letting it write into this document would risk replacing the page.
 */
export function AdSlot({
  slot,
  className = "",
}: {
  slot: AdSlotId;
  className?: string;
}) {
  const spec = AD_SLOTS[slot];
  const config = useMemo(() => adConfig(slot), [slot]);

  const markup = config
    ? `<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}iframe{display:block;border:0}</style></head><body><script type="text/javascript">atOptions = ${JSON.stringify(
        {
          key: config.key,
          format: "iframe",
          height: config.height,
          width: config.width,
          params: {},
        }
      ).replace(/</g, "\\u003c")};<\/script><script type="text/javascript" src="${config.src}"><\/script></body></html>`
    : "";

  return (
    <div
      data-ad-slot={slot}
      aria-label={`Advertisement (${spec.label.toLowerCase()})`}
      role="complementary"
      className={`flex w-full flex-col items-center gap-1.5 ${className}`}
    >
      <span className="eyebrow">advertisement</span>

      {config ? (
        <iframe
          title={`Advertisement — ${spec.label}`}
          srcDoc={markup}
          width={config.width}
          height={config.height}
          loading="lazy"
          sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          className="max-w-full rounded-xl border border-line bg-raised"
          style={{ width: config.width, height: config.height }}
        />
      ) : (
        <div
          className="mx-auto grid w-full place-items-center rounded-xl border border-dashed border-line-strong bg-raised/60 px-3 text-center"
          style={{ minHeight: spec.height, maxWidth: spec.width }}
        >
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-low">
            {spec.label} · {spec.width}×{spec.height}
          </p>
        </div>
      )}
    </div>
  );
}
