import type { Metadata } from "next";
import type { CSSProperties } from "react";

import { QIN_DIORAMA_CSS_VARIABLES } from "../components/xiangqi/scene/scene-theme";
import "./globals.css";

export const metadata: Metadata = {
  title: "兵临九宫｜Q 版秦俑 3D 中国象棋",
  description: "以秦兵马俑、烧土陶台与黑漆铜饰构成的网页 3D 中国象棋本机双人棋局。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" style={QIN_DIORAMA_CSS_VARIABLES as CSSProperties}>
      <body>{children}</body>
    </html>
  );
}
