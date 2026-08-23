import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "兵临九宫｜3D 中国象棋要塞棋盘",
  description: "写实山城要塞风格的网页 3D 中国象棋棋盘原型。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
