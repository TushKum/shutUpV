"use client";

// The boot sequence: a short terminal boot log over the page, once per browser session, after a team signs in.
// At most 1.5 s; any key, click or tap skips it. It never blocks input (the overlay takes no clicks, so the page
// under it works from the first moment), and it is not shown to people who ask for less motion.

import { useEffect, useState } from "react";

const KEY = "msim-booted";
const MAX_MS = 1500;

export function BootSequence({ who, lines }: { who: string; lines?: string[] }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    let seen = true;
    try {
      seen = sessionStorage.getItem(KEY) !== null;
      sessionStorage.setItem(KEY, "1");
    } catch {
      // No session storage (private mode): skip the intro rather than show it on every page.
    }
    if (seen || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const begin = setTimeout(() => setShow(true), 0);
    const end = setTimeout(() => setShow(false), MAX_MS);
    const skip = () => setShow(false);
    window.addEventListener("keydown", skip);
    window.addEventListener("pointerdown", skip);
    return () => {
      clearTimeout(begin);
      clearTimeout(end);
      window.removeEventListener("keydown", skip);
      window.removeEventListener("pointerdown", skip);
    };
  }, []);
  if (!show) return null;
  const log = lines ?? ["MARKET SIMULATION OS v3.0", "checking link ........ OK", "loading market ....... OK", `identity ............. ${who}`, "> welcome. follow the green button."];
  return (
    <div className="mx-boot" aria-hidden data-testid="boot-sequence">
      <div className="w-full max-w-md text-base leading-7 glow">
        {log.map((line, i) => (
          <p key={i} className="mx-boot-line" style={{ animationDelay: `${i * 180}ms` }}>
            {line}
          </p>
        ))}
        <p className="mx-boot-line mt-3 text-sm text-muted" style={{ animationDelay: `${log.length * 180}ms` }}>
          press any key to skip<span className="mx-cursor" />
        </p>
      </div>
    </div>
  );
}
