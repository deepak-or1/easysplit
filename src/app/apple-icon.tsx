import { ImageResponse } from "next/og";

/** iOS home-screen / Safari icon — PNG generated at build/request time. */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#FAF5EC",
        }}
      >
        <svg width="128" height="128" viewBox="0 0 32 32" fill="none">
          <path
            d="M6 6a3 3 0 0 1 3-3h14a3 3 0 0 1 3 3v21.2l-3.33-2.2-3.34 2.2-3.33-2.2-3.33 2.2-3.34-2.2L6 27.2V6Z"
            fill="#E4572E"
          />
          <rect x="10" y="9" width="12" height="2.2" rx="1.1" fill="#FAF5EC" opacity="0.95" />
          <rect x="10" y="14" width="8.5" height="2.2" rx="1.1" fill="#FAF5EC" opacity="0.95" />
          <rect x="10" y="19" width="5" height="2.2" rx="1.1" fill="#FAF5EC" opacity="0.95" />
          <circle cx="20.8" cy="20.1" r="1.7" fill="#F2B84B" />
        </svg>
      </div>
    ),
    size,
  );
}
