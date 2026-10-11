import type { Metadata } from "next";
import type { CSSProperties } from "react";

import { QIN_DIORAMA_CSS_VARIABLES } from "../components/xiangqi/scene/scene-theme";
import "./globals.css";

export const metadata: Metadata = {
  title: "兵临九宫｜Q 版秦俑 3D 中国象棋",
  description:
    "秦兵马俑主题的网页 3D 中国象棋。打开浏览器就能两人同屏对弈或挑战电脑，无需安装和登录。",
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
