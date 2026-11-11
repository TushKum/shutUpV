"use client";

// Cipher text: random glyphs that "decode", left to right, into the real text. It runs when the text first appears
// and again whenever the text changes (a price, a round title).
//
// The real text is always in the page: tests, copy/paste and screen readers get it at once (it is also the
// aria-label). While decoding, CSS makes the real text transparent and draws the scrambled line over it from the
// data-cipher attribute, so the box keeps its size. People who ask for less motion get the real text immediately.

import { useEffect, useRef } from "react";

const GLYPHS = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ01#$%&*+<>/=";
const FRAME_MS = 40;

export function CipherText({ text, duration = 700, className = "" }: { text: string; duration?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !text || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const began = performance.now();
    let frame = 0;
    let last = 0;
    const tick = (now: number) => {
      const done = Math.min(1, (now - began) / duration);
      if (done >= 1) {
        el.removeAttribute("data-cipher");
        return;
      }
      frame = requestAnimationFrame(tick);
      if (now - last < FRAME_MS) return;
      last = now;
      const settled = Math.floor(done * text.length);
      let line = text.slice(0, settled);
      // Spaces stay spaces, so words keep their shape (and wrap where the real text wraps).
      for (let i = settled; i < text.length; i++) line += text[i] === " " ? " " : GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
      el.setAttribute("data-cipher", line);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      el.removeAttribute("data-cipher");
    };
  }, [text, duration]);
  return (
    <span ref={ref} className={`mx-cipher ${className}`} aria-label={text}>
      {text}
    </span>
  );
}
