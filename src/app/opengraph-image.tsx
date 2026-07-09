import { ImageResponse } from "next/og";

/** Link-preview card for the site (iMessage, WhatsApp, Slack, Twitter…). */
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Settle — Text a receipt. Split the bill. Venmo settles it.";

function Mark({ px }: { px: number }) {
  return (
    <svg width={px} height={px} viewBox="0 0 32 32" fill="none">
      <path
        d="M6 6a3 3 0 0 1 3-3h14a3 3 0 0 1 3 3v21.2l-3.33-2.2-3.34 2.2-3.33-2.2-3.33 2.2-3.34-2.2L6 27.2V6Z"
        fill="#E5484D"
      />
      <rect x="10" y="9" width="12" height="2.2" rx="1.1" fill="#FFFFFF" opacity="0.95" />
      <rect x="10" y="14" width="8.5" height="2.2" rx="1.1" fill="#FFFFFF" opacity="0.95" />
      <rect x="10" y="19" width="5" height="2.2" rx="1.1" fill="#FFFFFF" opacity="0.95" />
      <circle cx="20.8" cy="20.1" r="1.7" fill="#FFD84D" />
    </svg>
  );
}

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#FFFFFF",
          color: "#161615",
          padding: 80,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <Mark px={96} />
          <div style={{ fontSize: 64, fontWeight: 700, letterSpacing: -1 }}>Settle</div>
        </div>
        <div
          style={{
            marginTop: 44,
            fontSize: 58,
            fontWeight: 700,
            textAlign: "center",
            lineHeight: 1.15,
            letterSpacing: -1,
            maxWidth: 960,
          }}
        >
          Text a receipt. Split the bill. Venmo settles it.
        </div>
        <div style={{ marginTop: 28, fontSize: 30, color: "#6E6E67" }}>
          No accounts. No math. No awkward follow-ups.
        </div>
      </div>
    ),
    size,
  );
}
