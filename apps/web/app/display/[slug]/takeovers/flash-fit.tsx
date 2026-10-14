"use client";

// The flash bulletin's title and body, as large as fits: the sizes step down until everything fits the content area.
// A body too long even at the smallest size is cut after the last whole word that fits, with an ellipsis. Sizes are set
// on the box as CSS variables before the browser paints (and the stage stays hidden until it has measured), so the
// projector never shows the text at the wrong size.

import { useLayoutEffect, useRef } from "react";

/** [title, body] in px. The body never goes below 28 px (the projector's smallest readable size). */
const STEPS: [number, number][] = [
  [112, 60],
  [96, 52],
  [84, 46],
  [72, 40],
  [64, 36],
  [56, 32],
  [52, 28],
];

export function FlashFit({ title, body, published }: { title: string; body: string; published: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLParagraphElement>(null);

  useLayoutEffect(() => {
    const box = boxRef.current;
    const text = bodyRef.current;
    if (!box || !text) return;
    const fits = () => box.scrollHeight <= box.clientHeight + 1 && box.scrollWidth <= box.clientWidth + 1;
    text.textContent = body;
    delete box.dataset.clamped;
    for (const [t, b] of STEPS) {
      box.style.setProperty("--flash-title", `${t}px`);
      box.style.setProperty("--flash-body", `${b}px`);
      box.dataset.size = String(b);
      if (fits()) return;
    }
    // Still too long at the smallest size: the longest run of whole words that fits, ending with an ellipsis.
    const words = body.split(/(\s+)/);
    const cut = (n: number) => `${words.slice(0, n).join("").trimEnd()}…`;
    let lo = 0;
    let hi = words.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      text.textContent = cut(mid);
      if (fits()) lo = mid;
      else hi = mid - 1;
    }
    text.textContent = cut(lo);
    box.dataset.clamped = "true";
  }, [title, body]);

  return (
    <div ref={boxRef} className="flex h-full flex-col gap-8 overflow-hidden" data-testid="flash-news">
      <p className="shrink-0 text-[32px] font-bold tracking-wide text-amber-300 uppercase">
        Flash news · <span className="font-mono tabular-nums">{published}</span>
      </p>
      {/* Centred in the space left when it is short; at the top (auto margins collapse) when it fills it. */}
      <div className="my-auto flex flex-col gap-8">
        <h2
          className="text-[length:var(--flash-title,112px)] leading-[1.08] font-black break-words text-white"
          data-testid="flash-title"
        >
          {title}
        </h2>
        <p
          ref={bodyRef}
          className="text-[length:var(--flash-body,60px)] leading-[1.35] break-words whitespace-pre-line text-slate-100"
          data-testid="flash-body"
        >
          {body}
        </p>
      </div>
    </div>
  );
}
