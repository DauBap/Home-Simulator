import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Home Simulator",
  description: "A 3D home renovation simulator",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
