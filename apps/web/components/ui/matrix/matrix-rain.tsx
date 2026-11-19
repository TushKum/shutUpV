"use client";

// Digital rain: columns of falling half-width katakana, 0/1 and digits on one canvas, as a background layer.
// It is decoration only: it sits behind its siblings (give it a positioned parent and put the content in an opaque
// panel above it), never takes a click, draws about 30 frames a second, stops while the tab is hidden, and does not
// run at all for people who ask for less motion (the canvas is also hidden by CSS then).

import { useEffect, useRef } from "react";

const GLYPHS = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0101010123456789PRIMUS26";
const FRAME_MS = 38;

const PALETTES = {
  green: { trail: "#00ff41", headBright: "#d8ffd8", headAccent: "#39ff88" },
  blue: { trail: "#2f8cff", headBright: "#e0f2fe", headAccent: "#63a8ff" },
  amber: { trail: "#ff9b45", headBright: "#fff0db", headAccent: "#ffb36b" },
  gold: { trail: "#ffd84d", headBright: "#fff9db", headAccent: "#ffe27a" },
} as const;

export type MatrixRainTone = keyof typeof PALETTES;

export function MatrixRain({
  opacity = 0.22,
  size = 16,
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
    const still = window.matchMedia("(prefers-reduced-motion: reduce)");
    let drops: number[] = [];
    let chars: string[] = [];
    let frame = 0;
    let last = 0;

    const pickGlyph = () => GLYPHS[Math.floor(Math.random() * GLYPHS.length)]!;

    const stepRain = () => {
      // A translucent black wash fades older glyphs into vertical code trails.
      ctx.fillStyle = "rgba(0, 0, 0, 0.075)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const maxRows = Math.ceil(canvas.height / size) + 2;
      for (let i = 0; i < drops.length; i++) {
        const row = drops[i]!;
        const x = i * size;
        // Overwrite the previous head in glowing phosphor tone so the trail stays crisp.
        if (row > 0 && row - 1 <= maxRows) {
          ctx.fillStyle = palette.trail;
          ctx.fillText(chars[i] || pickGlyph(), x, (row - 1) * size);
        }
        const y = row * size;
        const nextChar = pickGlyph();
        chars[i] = nextChar;
        if (y >= 0 && y <= canvas.height) {
          // Bright leading head glyph at the tip of the falling code line.
          ctx.fillStyle = Math.random() < 0.72 ? palette.headBright : palette.headAccent;
          ctx.fillText(nextChar, x, y);
        }
        drops[i] = y > canvas.height && Math.random() > 0.965 ? Math.floor(Math.random() * -18) : row + 1;
      }
    };

    // The canvas is drawn at its layout size (not the device's pixel ratio): cheaper, and the glyphs are meant to be soft.
    const fit = () => {
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
      const columns = Math.ceil(canvas.width / size);
      const rows = Math.max(24, Math.ceil(canvas.height / size));
      drops = Array.from({ length: columns }, () => Math.floor(Math.random() * (rows * 1.4) - rows));
      chars = Array.from({ length: columns }, pickGlyph);
      ctx.font = `600 ${size}px ui-monospace, Menlo, Consolas, monospace`;
      ctx.textBaseline = "top";
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      // Warm up the trails so Matrix code lines are immediately visible across the screen on first paint.
      for (let step = 0; step < 48; step++) stepRain();
    };

    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      if (now - last < FRAME_MS) return;
      last = now;
      stepRain();
    };

    const stop = () => cancelAnimationFrame(frame);
    const start = () => {
      stop();
      if (!still.matches && !document.hidden) frame = requestAnimationFrame(draw);
    };
    const onMotion = () => {
      fit();
      start();
    };
    const sized = new ResizeObserver(fit);

    fit();
    start();
    sized.observe(canvas);
    document.addEventListener("visibilitychange", start);
    still.addEventListener("change", onMotion);
    return () => {
      stop();
      sized.disconnect();
      document.removeEventListener("visibilitychange", start);
      still.removeEventListener("change", onMotion);
    };
  }, [size, tone]);
  return <canvas ref={ref} aria-hidden className={`mx-rain ${className}`} style={{ opacity }} />;
}
