"use client";

import { useEffect, useRef } from "react";

const GLYPHS = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789ABCDEF$%+";
const FRAME_MS = 32;
const MONO_FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

export type MatrixRainTint = "green" | "blue" | "yellow";

interface RainPalette {
  bg: string;
  trail: string;
  staticRare: string;
  staticAlt: string;
  staticBright: string;
  staticDim: string;
  spark1: string;
  spark1Shadow: string;
  spark2: string;
  spark2Shadow: string;
  colAlt: string;
  colAltMod: number;
  colRare: string;
  colRareMod: number;
  colBright: string;
  colDim: string;
}

const RAIN_PALETTES: Record<MatrixRainTint, RainPalette> = {
  green: {
    bg: "#020704",
    trail: "rgba(2, 7, 4, 0.075)",
    staticRare: "rgba(255, 178, 63, 0.28)",
    staticAlt: "rgba(96, 215, 255, 0.22)",
    staticBright: "rgba(52, 235, 139, 0.36)",
    staticDim: "rgba(20, 178, 102, 0.22)",
    spark1: "rgba(255, 206, 120, 0.94)",
    spark1Shadow: "rgba(255, 168, 52, 0.72)",
    spark2: "rgba(232, 255, 245, 0.95)",
    spark2Shadow: "rgba(52, 235, 139, 0.8)",
    colAlt: "rgba(96, 215, 255, 0.44)",
    colAltMod: 10,
    colRare: "rgba(255, 196, 72, 0.34)",
    colRareMod: 13,
    colBright: "rgba(52, 238, 138, 0.66)",
    colDim: "rgba(22, 186, 108, 0.42)",
  },
  blue: {
    bg: "#02070d",
    trail: "rgba(2, 7, 13, 0.075)",
    staticRare: "rgba(255, 196, 72, 0.2)",
    staticAlt: "rgba(52, 235, 139, 0.26)",
    staticBright: "rgba(72, 196, 255, 0.38)",
    staticDim: "rgba(28, 138, 224, 0.24)",
    spark1: "rgba(255, 212, 128, 0.82)",
    spark1Shadow: "rgba(255, 178, 64, 0.55)",
    spark2: "rgba(224, 246, 255, 0.95)",
    spark2Shadow: "rgba(72, 196, 255, 0.82)",
    colAlt: "rgba(52, 235, 139, 0.44)",
    colAltMod: 4,
    colRare: "rgba(255, 204, 78, 0.34)",
    colRareMod: 11,
    colBright: "rgba(72, 196, 255, 0.62)",
    colDim: "rgba(32, 144, 228, 0.38)",
  },
  yellow: {
    bg: "#070602",
    trail: "rgba(7, 6, 2, 0.075)",
    staticRare: "rgba(96, 215, 255, 0.22)",
    staticAlt: "rgba(52, 235, 139, 0.24)",
    staticBright: "rgba(255, 212, 68, 0.38)",
    staticDim: "rgba(208, 154, 24, 0.22)",
    spark1: "rgba(150, 238, 218, 0.86)",
    spark1Shadow: "rgba(70, 220, 178, 0.6)",
    spark2: "rgba(255, 248, 214, 0.95)",
    spark2Shadow: "rgba(255, 212, 68, 0.8)",
    colAlt: "rgba(52, 235, 139, 0.4)",
    colAltMod: 4,
    colRare: "rgba(96, 215, 255, 0.36)",
    colRareMod: 10,
    colBright: "rgba(255, 212, 68, 0.58)",
    colDim: "rgba(210, 156, 24, 0.36)",
  },
};

export function MatrixRain({ className = "", opacity = 1, tint = "green" }: { className?: string; opacity?: number; tint?: MatrixRainTint }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const palette = RAIN_PALETTES[tint];
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const fontSize = 13;
    let width = 0;
    let height = 0;
    let columns = 0;
    let drops: number[] = [];
    let speeds: number[] = [];
    let raf = 0;
    let lastTick = 0;

    const setup = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth || window.innerWidth;
      height = canvas.clientHeight || window.innerHeight;
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      context.setTransform(dpr, 0, 0, dpr, 0, 0);

      columns = Math.max(1, Math.ceil(width / fontSize));
      const rowCapacity = Math.max(12, Math.ceil(height / fontSize));
      drops = Array.from({ length: columns }, () => Math.random() * rowCapacity);
      speeds = Array.from({ length: columns }, () => 0.46 + Math.random() * 0.54);

      context.fillStyle = palette.bg;
      context.fillRect(0, 0, width, height);
    };

    const drawStatic = () => {
      context.fillStyle = palette.bg;
      context.fillRect(0, 0, width, height);
      context.font = `${fontSize}px ${MONO_FONT}`;
      context.textBaseline = "top";

      for (let i = 0; i < columns; i++) {
        const rows = Math.ceil(height / (fontSize * 1.65));
        for (let r = 0; r < rows; r++) {
          if (Math.random() > 0.56) continue;
          const glyph = GLYPHS[Math.floor(Math.random() * GLYPHS.length)]!;
          if (i % 13 === 0 && r % 6 === 0) {
            context.fillStyle = palette.staticRare;
          } else if (i % 8 === 0) {
            context.fillStyle = palette.staticAlt;
          } else {
            context.fillStyle = r % 5 === 0 ? palette.staticBright : palette.staticDim;
          }
          context.fillText(glyph, i * fontSize, r * fontSize * 1.65);
        }
      }
    };

    const drawFrame = (now: number) => {
      raf = window.requestAnimationFrame(drawFrame);
      if (now - lastTick < FRAME_MS) return;
      lastTick = now;

      context.fillStyle = palette.trail;
      context.fillRect(0, 0, width, height);
      context.font = `${fontSize}px ${MONO_FONT}`;
      context.textBaseline = "top";

      for (let i = 0; i < columns; i++) {
        const y = drops[i]! * fontSize;
        if (y >= -fontSize) {
          const glyph = GLYPHS[Math.floor(Math.random() * GLYPHS.length)]!;
          const spark = Math.random();
          if (spark > 0.982) {
            context.fillStyle = palette.spark1;
            context.shadowColor = palette.spark1Shadow;
            context.shadowBlur = 9;
          } else if (spark > 0.95) {
            context.fillStyle = palette.spark2;
            context.shadowColor = palette.spark2Shadow;
            context.shadowBlur = 10;
          } else if (i % palette.colAltMod === 1) {
            context.fillStyle = palette.colAlt;
            context.shadowBlur = 0;
          } else if (i % palette.colRareMod === 0) {
            context.fillStyle = palette.colRare;
            context.shadowBlur = 0;
          } else {
            context.fillStyle = i % 3 === 0 ? palette.colBright : palette.colDim;
            context.shadowBlur = 0;
          }
          context.fillText(glyph, i * fontSize, y);
          context.shadowBlur = 0;
        }

        if (y > height && Math.random() > 0.955) {
          drops[i] = -Math.random() * 6;
        } else {
          drops[i] = drops[i]! + speeds[i]!;
        }
      }
    };

    const stop = () => {
      if (raf) {
        window.cancelAnimationFrame(raf);
        raf = 0;
      }
    };

    const start = () => {
      stop();
      if (motionQuery.matches) {
        drawStatic();
        return;
      }
      if (document.hidden) return;
      raf = window.requestAnimationFrame(drawFrame);
    };

    const onResize = () => {
      setup();
      if (motionQuery.matches) drawStatic();
    };

    const onVisibilityChange = () => {
      if (document.hidden) stop();
      else start();
    };

    setup();
    start();

    const resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(canvas);
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibilityChange);
    motionQuery.addEventListener("change", start);

    return () => {
      stop();
      resizeObserver.disconnect();
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      motionQuery.removeEventListener("change", start);
    };
  }, [tint]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`pointer-events-none fixed inset-0 z-0 h-full w-full ${className}`.trim()}
      style={{ position: "fixed", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 0, opacity }}
    />
  );
}
