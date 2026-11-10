import { ImageResponse } from "next/og";
import { SITE_NAME } from "@/lib/site";

export const alt = "Log Tax: inteligência tributária conversacional";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: 80, background: "#ECEEF4", color: "#14161C" }}>
        <div style={{ fontSize: 40, fontWeight: 700, color: "#2D4A97" }}>{SITE_NAME}</div>
        <div style={{ fontSize: 76, fontWeight: 700, lineHeight: 1.1, marginTop: 24 }}>Converse e entenda os seus impostos</div>
        <div style={{ fontSize: 34, marginTop: 32, color: "#4A4F5C" }}>Empresa ou pessoa física. Estimativas ilustrativas, em linguagem simples.</div>
      </div>
    ),
    size,
  );
}
