import { ImageResponse } from "next/og";

import { CREDIT_PER_HOUR, DAILY_FREE_CREDIT } from "@/lib/credits";

export const runtime = "edge";

export const alt = "Openmi — Free GitHub coding agent, priced by the hour";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  const dailyHours = Math.floor(DAILY_FREE_CREDIT / CREDIT_PER_HOUR);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: "#09090b",
          color: "#fafafa",
          padding: "64px 72px",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
            <div
              style={{
                width: "36px",
                height: "36px",
                borderRadius: "8px",
                backgroundColor: "#2563eb",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "20px",
                fontWeight: 700,
                color: "#ffffff",
              }}
            >
              O
            </div>
            <span style={{ fontSize: "26px", fontWeight: 600, letterSpacing: "-0.02em" }}>
              Openmi
            </span>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              border: "1px solid #27272a",
              backgroundColor: "#111113",
              borderRadius: "8px",
              padding: "8px 16px",
              fontSize: "18px",
              color: "#a1a1aa",
            }}
          >
            Ad-supported free tier · No credit card · No API keys
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "20px", maxWidth: "960px" }}>
          <div
            style={{
              fontSize: "66px",
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: "-0.035em",
              color: "#fafafa",
            }}
          >
            Free GitHub coding agent, priced by the hour.
          </div>
          <div
            style={{
              fontSize: "26px",
              lineHeight: 1.45,
              color: "#a1a1aa",
            }}
          >
            Cloud Linux sandboxes, live previews, verified line citations, and
            isolated pull requests—straight from your browser.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: "20px",
          }}
        >
          {[
            { label: "Auto mode", value: "Free", sub: "0 Credit / hr" },
            {
              label: "Daily free",
              value: `${DAILY_FREE_CREDIT} Credit`,
              sub: `${dailyHours} hrs/day worldwide`,
            },
            {
              label: "Named hour",
              value: `${CREDIT_PER_HOUR} Credit`,
              sub: "Unlimited follow-up turns",
            },
            {
              label: "Paid passes",
              value: "No auto-renew",
              sub: "Fixed-term 15d & 30d",
            },
          ].map((stat) => (
            <div
              key={stat.label}
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                backgroundColor: "#111113",
                border: "1px solid #27272a",
                borderRadius: "12px",
                padding: "20px 22px",
              }}
            >
              <span style={{ fontSize: "16px", color: "#71717a" }}>{stat.label}</span>
              <span
                style={{
                  marginTop: "6px",
                  fontSize: "26px",
                  fontWeight: 700,
                  color: "#fafafa",
                }}
              >
                {stat.value}
              </span>
              <span style={{ marginTop: "4px", fontSize: "15px", color: "#60a5fa" }}>
                {stat.sub}
              </span>
            </div>
          ))}
        </div>
      </div>
    ),
    { ...size }
  );
}
