// Thermal photoscan: a horizontal scan line with a thermal-camera heat map (green → yellow → red) that sweeps down
// over its children once, trailing a heat gradient, as if the block were being scanned. For reveals (the crisis, a
// verdict, a big price move) and, looping, for loading states. Pure CSS (.mx-thermal in globals.css): the beam never
// takes a click, and under prefers-reduced-motion it is a still heat bar on the top edge.

import type { ReactNode } from "react";

/**
 * Wraps `children` and scans them. The sweep runs when the wrapper appears; give it a new React `key` to scan again
 * (say, the id of the thing revealed). `loop` keeps scanning (loading). `active={false}` renders the children only.
 */
export function ThermalScan({
  children,
  active = true,
  loop = false,
  className = "",
}: {
  children?: ReactNode;
  active?: boolean;
  loop?: boolean;
  className?: string;
}) {
  return (
    <div className={`mx-thermal ${loop ? "mx-thermal-loop" : ""} ${className}`}>
      {children}
      {active ? <span aria-hidden className="mx-thermal-beam" /> : null}
    </div>
  );
}

/** Just the beam, for a parent that is already positioned (a grid cell that must keep its own layout). */
export function ThermalBeam() {
  return <span aria-hidden className="mx-thermal-beam" />;
}

/** A loading block: a dithered slab under a looping scan. `label` is what a screen reader hears. */
export function ThermalSkeleton({ label = "Loading…", className = "" }: { label?: string; className?: string }) {
  return (
    <div role="status" aria-label={label} className={`mx-skeleton mx-thermal mx-thermal-loop ${className}`}>
      <span aria-hidden className="absolute inset-0 mx-dither-fill opacity-25" />
      <span aria-hidden className="mx-thermal-beam" />
    </div>
  );
}
