"use client";

// The projector canvas: everything is laid out at 1920×1080 and scaled to fit the window (letterboxed on black), so
// the screen looks the same on any projector or laptop. Hidden until the first measurement, so it never flashes at
// the wrong size.

import { useLayoutEffect, useState, type ReactNode } from "react";
import { MatrixRain } from "@/components/ui/matrix/matrix-rain";

export const STAGE_W = 1920;
export const STAGE_H = 1080;

export function Stage({ children }: { children: ReactNode }) {
  const [fit, setFit] = useState<{ scale: number; left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const scale = Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H);
      setFit({ scale, left: (window.innerWidth - STAGE_W * scale) / 2, top: (window.innerHeight - STAGE_H * scale) / 2 });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);
  return (
    <div className="fixed inset-0 overflow-hidden bg-ink">
      <div
        data-testid="stage"
        className="mx-stage absolute flex flex-col overflow-hidden bg-ink text-phosphor antialiased"
        style={{
          width: STAGE_W,
          height: STAGE_H,
          left: fit?.left ?? 0,
          top: fit?.top ?? 0,
          transform: `scale(${fit?.scale ?? 1})`,
          transformOrigin: "top left",
          visibility: fit ? "visible" : "hidden",
        }}
      >
        {/* The backdrop: rain and a CRT layer. Every block of the screen above them is opaque, so the rain only
            shows in the gaps (between tiles, in empty slots), never under words. */}
        <MatrixRain opacity={0.28} size={22} className="-z-10" />
        <div aria-hidden className="mx-crt -z-10" />
        {children}
      </div>
    </div>
  );
}
