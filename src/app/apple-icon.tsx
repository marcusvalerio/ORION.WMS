import { ImageResponse } from "next/og";
import { orionRects } from "@/components/brand/orion-mark";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** Ícone do app (iOS): fundo céu, barras noite, R = 0,37 · lado. */
export default function AppleIcon() {
  const side = size.width;
  const c = side / 2;
  return new ImageResponse(
    (
      <div style={{ width: side, height: side, display: "flex", position: "relative", background: "#7DB7F0", borderRadius: side * 0.24 }}>
        {orionRects(0.37 * side).map((b, i) => (
          <div
            key={i}
            style={{ position: "absolute", left: c + b.x, top: c + b.y, width: b.width, height: b.height, background: "#060B2A" }}
          />
        ))}
      </div>
    ),
    { ...size },
  );
}
