"use client";

import { useEffect, useRef } from "react";

const glyphs = "アカサタナハマヤラワ012345789ABCDEFGHIJKLMNOPQRSTUVWXYZアイウエオカキクケコ";

export function MatrixRain() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let width = 0, height = 0, columns = 0, drops: number[] = [], frame = 0, raf = 0;
    const fontSize = 15;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth; height = window.innerHeight;
      canvas.width = Math.floor(width * dpr); canvas.height = Math.floor(height * dpr);
      canvas.style.width = width + "px"; canvas.style.height = height + "px";
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      columns = Math.ceil(width / fontSize);
      drops = Array.from({ length: columns }, () => Math.random() * -height / fontSize);
    };
    const draw = () => {
      context.fillStyle = "rgba(2, 7, 4, 0.105)";
      context.fillRect(0, 0, width, height);
      context.font = fontSize + "px monospace";
      for (let i = 0; i < columns; i++) {
        const char = glyphs[Math.floor(Math.random() * glyphs.length)];
        const y = drops[i] * fontSize;
        const bright = Math.random() > .985;
        context.fillStyle = bright ? "#c7ffda" : (i % 5 === 0 ? "rgba(57,255,136,.72)" : "rgba(0,190,83,.46)");
        context.shadowColor = bright ? "#39ff88" : "transparent";
        context.shadowBlur = bright ? 12 : 0;
        context.fillText(char, i * fontSize, y);
        context.shadowBlur = 0;
        if (y > height && Math.random() > .978) drops[i] = 0;
        drops[i] += reduced ? 0 : .34 + Math.random() * .42;
      }
      if (!reduced) raf = window.requestAnimationFrame(draw);
    };
    resize();
    if (reduced) {
      context.fillStyle = "#020704"; context.fillRect(0, 0, width, height);
      for (let i = 0; i < columns; i++) {
        for (let j = 0; j < 7; j++) {
          context.fillStyle = "rgba(0,190,83,.25)";
          context.fillText(glyphs[Math.floor(Math.random() * glyphs.length)], i * fontSize, j * 22 + 30);
        }
      }
    } else {
      // Keep the canvas truly dormant during the logo boot sequence.
      // The rain begins only when the PRIMUS wordmark has finished assembling.
      const rainStart = window.setTimeout(() => {
        raf = window.requestAnimationFrame(draw);
      }, 3900);
      window.addEventListener("resize", resize);
      return () => {
        window.clearTimeout(rainStart);
        window.cancelAnimationFrame(raf);
        window.removeEventListener("resize", resize);
      };
    }
    window.addEventListener("resize", resize);
    return () => { window.cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, []);

  return <canvas ref={canvasRef} aria-hidden="true" className="matrix-rain-canvas" />;
}
