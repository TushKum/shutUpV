"use client";

import { useEffect, useRef } from "react";

const GLYPHS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ";
const FRAME_MS = 40;

const PALETTES = {
  green: { headBright: "#b5ffd0", headMain: "#39c96b", trailA: "#168044", trailB: "#0d6335", shadow: "#22a653" },
  blue: { headBright: "#e0f2fe", headMain: "#63a8ff", trailA: "#2563eb", trailB: "#1d4ed8", shadow: "#3b82f6" },
  amber: { headBright: "#ffedd5", headMain: "#ff9b45", trailA: "#ea580c", trailB: "#c2410c", shadow: "#f97316" },
  gold: { headBright: "#fef9c3", headMain: "#ffd84d", trailA: "#ca8a04", trailB: "#a16207", shadow: "#eab308" },
} as const;

export type MatrixRainTone = keyof typeof PALETTES;

type Stream = { x: number; y: number; length: number; speed: number; glyphs: string[]; brightness: number };

export function MatrixRain({
  opacity = 0.82,
  size = 15,
  className = "",
  tone = "green",
}: {
  opacity?: number;
  size?: number;
  className?: string;
  tone?: MatrixRainTone;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const palette = PALETTES[tone] ?? PALETTES.green;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let streams: Stream[] = [];
    let frame = 0;
    let last = 0;
    let width = 0;
    let height = 0;
    let dpr = 1;

    const randomGlyphs = (count: number) =>
      Array.from({ length: count }, () => GLYPHS[Math.floor(Math.random() * GLYPHS.length)]!);

    const randomX = () => {
      for (let attempt = 0; attempt < 14; attempt++) {
        const x = Math.random() * width;
        const centerDistance = Math.abs(x - width / 2) / (width / 2);
        if (centerDistance >= 0.34 || Math.random() < 0.12) return x;
      }
      return Math.random() < 0.5 ? Math.random() * width * 0.28 : width * (0.72 + Math.random() * 0.28);
    };

    const makeStream = (x?: number): Stream => {
      const length = 13 + Math.floor(Math.random() * 34);
      return {
        x: x ?? randomX(),
        y: Math.random() * (height + length * size) - length * size,
        length,
        speed: 0.32 + Math.random() * 0.72,
        glyphs: randomGlyphs(length),
        brightness: 0.62 + Math.random() * 0.38,
      };
    };

    const fit = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = `${size}px ui-monospace, Menlo, Consolas, monospace`;
      ctx.textBaseline = "top";

      // Keep the middle relatively quiet so the sign-in panel remains the focal point.
      const count = Math.max(18, Math.min(96, Math.round(width / 25)));
      streams = Array.from({ length: count }, () => makeStream());
      paint();
    };

    const paint = () => {
      ctx.clearRect(0, 0, width, height);
      for (const stream of streams) {
        for (let i = 0; i < stream.length; i++) {
          const y = stream.y - i * size;
          if (y < -size || y > height + size) continue;

          const distance = i / stream.length;
          const fadeIn = Math.min(1, Math.max(0, (y + size * 2) / (size * 5)));
          const fadeOut = Math.min(1, Math.max(0, (height - y + size * 2) / (size * 8)));
          const trailFade = Math.pow(1 - distance, 1.25);
          const alpha = stream.brightness * trailFade * fadeIn * fadeOut;
          if (alpha < 0.025) continue;

          const isHead = i === 0;
          ctx.globalAlpha = alpha * (isHead ? 1 : 0.88);
          ctx.fillStyle = isHead
            ? (Math.random() < 0.12 ? palette.headBright : palette.headMain)
            : (i % 4 === 0 ? palette.trailA : palette.trailB);
          if (isHead) {
            ctx.shadowColor = palette.shadow;
            ctx.shadowBlur = 9;
          } else {
            ctx.shadowBlur = 0;
          }
          ctx.fillText(stream.glyphs[i]!, stream.x, y);
        }
      }
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
    };

    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      if (now - last < FRAME_MS) return;
      last = now;
      for (const stream of streams) {
        stream.y += stream.speed * size;
        if (stream.y - stream.length * size > height + size * 3) {
          const next = makeStream();
          stream.x = next.x;
          stream.y = -Math.random() * height * 0.7 - size * 4;
          stream.length = next.length;
          stream.speed = next.speed;
          stream.glyphs = next.glyphs;
          stream.brightness = next.brightness;
        } else if (Math.random() < 0.035) {
          const index = Math.floor(Math.random() * stream.length);
          stream.glyphs[index] = GLYPHS[Math.floor(Math.random() * GLYPHS.length)]!;
        }
      }
      paint();
    };

    const stop = () => cancelAnimationFrame(frame);
    const start = () => {
      stop();
      if (document.hidden) return;
      if (reducedMotion.matches) {
        paint();
        return;
      }
      frame = requestAnimationFrame(draw);
    };

    const observer = new ResizeObserver(() => {
      fit();
      start();
    });
    fit();
    start();
    observer.observe(canvas);
    document.addEventListener("visibilitychange", start);
    reducedMotion.addEventListener("change", start);

    return () => {
      stop();
      observer.disconnect();
      document.removeEventListener("visibilitychange", start);
      reducedMotion.removeEventListener("change", start);
    };
  }, [size, tone]);

  return <canvas ref={ref} aria-hidden className={`mx-rain ${className}`} style={{ opacity }} />;
}
