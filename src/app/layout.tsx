import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "WebBoot | WASM Native OS",
  description: "Single address space OS runtime hosted inside a Next.js shell",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
