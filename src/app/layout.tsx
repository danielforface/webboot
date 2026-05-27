import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Everywhere OS | Nomadic Runtime",
  description: "Browser-native operating system shell with WASM linear-memory roaming",
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
