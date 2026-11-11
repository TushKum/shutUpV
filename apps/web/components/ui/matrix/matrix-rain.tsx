"use client";

// Digital rain: columns of falling half-width katakana, 0/1 and digits on one canvas, as a background layer.
// It is decoration only: it sits behind its siblings (give it a positioned parent and put the content in an opaque
// panel above it), never takes a click, draws about 30 frames a second, stops while the tab is hidden, and does not
// run at all for people who ask for less motion (the canvas is also hidden by CSS then).

import { useEffect, useRef } from "react";

const GLYPHS = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0101010123456789";
const FRAME_MS = 33;

export function MatrixRain({ opacity = 0.22, size = 16, className = "" }: { opacity?: number; size?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)");
    let drops: number[] = [];
    let frame = 0;
    let last = 0;

    // The canvas is drawn at its layout size (not the device's pixel ratio): cheaper, and the glyphs are meant to be soft.
    const fit = () => {
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
      const columns = Math.ceil(canvas.width / size);
      drops = Array.from({ length: columns }, () => Math.floor((Math.random() * -canvas.height) / size));
      ctx.font = `${size}px ui-monospace, Menlo, Consolas, monospace`;
      ctx.textBaseline = "top";
    };

    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      if (now - last < FRAME_MS) return;
      last = now;
      // A translucent black wash fades the older glyphs into trails.
      ctx.fillStyle = "rgba(0, 0, 0, 0.09)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < drops.length; i++) {
        const y = drops[i]! * size;
        if (y >= 0) {
          ctx.fillStyle = Math.random() < 0.04 ? "#d8ffd8" : "#00ff41";
          ctx.fillText(GLYPHS[Math.floor(Math.random() * GLYPHS.length)]!, i * size, y);
        }
        drops[i] = y > canvas.height && Math.random() > 0.975 ? 0 : drops[i]! + 1;
      }
    };

    const stop = () => cancelAnimationFrame(frame);
    const start = () => {
      stop();
      if (!still.matches && !document.hidden) frame = requestAnimationFrame(draw);
    };
    const onMotion = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
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
  }, [size]);
  return <canvas ref={ref} aria-hidden className={`mx-rain ${className}`} style={{ opacity }} />;
}
