import type { Metadata, Viewport } from "next";
import "./globals.css";
import { DitherDefs } from "@/components/ui/matrix/dither-layer";

export const metadata: Metadata = {
  title: "Market Simulation",
  description: "Live trading simulation for the overnight Market Simulation Competition",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">
        <DitherDefs />
        {children}
      </body>
    </html>
  );
}
