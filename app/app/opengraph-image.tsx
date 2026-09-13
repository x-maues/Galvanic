import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
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
          background: "#0a0a0a",
          color: "#f5f4f0",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
          <div style={{ display: "flex", height: 14, width: 14, background: "#ff5a1f", borderRadius: 3 }} />
          <div style={{ fontSize: 40, letterSpacing: 6, textTransform: "uppercase", opacity: 0.9 }}>
            Galvanic
          </div>
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 54,
            fontWeight: 600,
            letterSpacing: -1.5,
            marginTop: 36,
            maxWidth: 920,
            textAlign: "center",
            lineHeight: 1.15,
          }}
        >
          Your bond shouldn&apos;t be sold because your ETH crashed.
        </div>
        <div style={{ display: "flex", fontSize: 26, color: "rgba(245,244,240,0.5)", marginTop: 28 }}>
          Borrow against real-world assets. Keep them protected — by construction.
        </div>
      </div>
    ),
    { ...size }
  );
}
