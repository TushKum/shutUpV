// Ordered dithering, pure SVG (no image files). A fade is drawn as eight bands, each filled with a 4×4 Bayer pattern
// at a rising threshold, which is what an ordered dither of a gradient looks like. <DitherDefs/> holds the patterns
// once per page (the root layout renders it); <DitherLayer/> is a decorative layer that fills its positioned parent.
// It is for edges and backgrounds: never put it under text people need to read.

/** The 4×4 Bayer matrix: a cell is lit when its value is below the band's threshold. */
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
] as const;
const BANDS = 8;
const TONES = { green: "#008f11", bright: "#00ff41", red: "#ff3b3b", amber: "#ffb000" } as const;
export type DitherTone = keyof typeof TONES;

export function DitherDefs({ cell = 2 }: { cell?: number }) {
  return (
    <svg aria-hidden width="0" height="0" className="absolute">
      <defs>
        {(Object.keys(TONES) as DitherTone[]).flatMap((tone) =>
          Array.from({ length: BANDS }, (_, band) => {
            const threshold = ((band + 1) * 16) / BANDS;
            return (
              <pattern key={`${tone}-${band}`} id={`mx-bayer-${tone}-${band + 1}`} width={cell * 4} height={cell * 4} patternUnits="userSpaceOnUse">
                {BAYER.flatMap((row, y) =>
                  row.map((value, x) => (value < threshold ? <rect key={`${x}-${y}`} x={x * cell} y={y * cell} width={cell} height={cell} fill={TONES[tone]} /> : null)),
                )}
              </pattern>
            );
          }),
        )}
      </defs>
    </svg>
  );
}

/**
 * A dithered fade across its parent: solid at the `from` side, empty at the other. `opacity` keeps it in the
 * background.
 */
export function DitherLayer({
  from = "bottom",
  tone = "green",
  opacity = 0.5,
  className = "",
}: {
  from?: "top" | "bottom" | "left" | "right";
  tone?: DitherTone;
  opacity?: number;
  className?: string;
}) {
  const across = from === "left" || from === "right";
  const size = 100 / BANDS;
  return (
    // Inline position and pointer-events too: the layer must never catch a click, even before the stylesheet loads.
    <svg aria-hidden className={`mx-dither ${className}`} style={{ opacity, position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
      {Array.from({ length: BANDS }, (_, i) => {
        // Band 0 is at the top (or left); the pattern gets denser towards the `from` side.
        const level = from === "bottom" || from === "right" ? i + 1 : BANDS - i;
        const fill = `url(#mx-bayer-${tone}-${level})`;
        return across ? (
          <rect key={i} x={`${i * size}%`} y="0" width={`${size + 0.1}%`} height="100%" fill={fill} />
        ) : (
          <rect key={i} x="0" y={`${i * size}%`} width="100%" height={`${size + 0.1}%`} fill={fill} />
        );
      })}
    </svg>
  );
}
