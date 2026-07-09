import { ImageResponse } from "next/og";
import { getRoomState } from "@/lib/store";
import { formatCents } from "@/lib/money";

/**
 * Dynamic link preview for a room: when someone texts the split link, the
 * preview shows the restaurant, the bill, and the ask. Inherited by the
 * nested host and pay pages too.
 */
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Claim what you got — Settle";

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

export default async function RoomOgImage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const room = await getRoomState(id).catch(() => null);

  const restaurant = room?.split.restaurantName?.trim() || "Dinner";
  const total = room ? formatCents(room.settlement.grandTotalCents) : null;
  const host = room?.split.hostName;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          background: "#FFFFFF",
          color: "#161615",
          padding: 88,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <Mark px={56} />
          <div style={{ fontSize: 38, fontWeight: 700, letterSpacing: -0.5 }}>Settle</div>
        </div>
        <div
          style={{
            marginTop: 48,
            fontSize: 76,
            fontWeight: 700,
            lineHeight: 1.1,
            letterSpacing: -1.5,
            maxWidth: 1000,
          }}
        >
          {restaurant}
        </div>
        <div style={{ marginTop: 22, display: "flex", alignItems: "center", gap: 16, fontSize: 36 }}>
          {total && (
            <div
              style={{
                display: "flex",
                background: "#E5484D",
                color: "#FFFFFF",
                borderRadius: 999,
                padding: "10px 30px",
                fontWeight: 700,
              }}
            >
              {total}
            </div>
          )}
          {host && <div style={{ color: "#6E6E67" }}>{`hosted by ${host}`}</div>}
        </div>
        <div style={{ marginTop: 44, fontSize: 34, color: "#6E6E67" }}>
          Tap the link and claim what you got — Venmo settles it.
        </div>
      </div>
    ),
    size,
  );
}
