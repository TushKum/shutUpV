import React, { ReactNode } from "react";
import { cn } from "@/lib/utils";

type FocusFrameBorderProps = {
  children: ReactNode;
  className?: string;
  duration?: number;
  color?: string;
  /** Extra classes for the content layer (merged with cn, so they can override its background or border). */
  contentClassName?: string;
};

const corners = [
  {
    position: "top-0 left-0",
    edges: "border-t-1 border-l-1 rounded-tl-xl",
    delay: 0,
  },
  {
    position: "top-0 right-0",
    edges: "border-t-1 border-r-1 rounded-tr-xl",
    delay: 0.3,
  },
  {
    position: "bottom-0 left-0",
    edges: "border-b-1 border-l-1 rounded-bl-xl",
    delay: 0.6,
  },
  {
    position: "bottom-0 right-0",
    edges: "border-b-1 border-r-1 rounded-br-xl",
    delay: 0.9,
  },
];

const FocusFrameBorder = ({
  children,
  className,
  duration = 2.4,
  color = "var(--color-blue-500)",
  contentClassName,
}: FocusFrameBorderProps) => {
  return (
    <>
      <style>{`
        @keyframes focus-pulse {
          0%, 100% { opacity: 0.6; }
          50% { opacity: 1; }
        }
        .animate-focus-pulse {
          animation: focus-pulse var(--duration, 2.4s) ease-in-out infinite;
        }
      `}</style>
      <div className={cn("relative rounded-2xl", className)}>
        {/* Pulsing corner brackets */}
        {corners.map((corner) => (
          <div
            key={corner.position}
            className={cn(
              "absolute z-20 size-10 pointer-events-none animate-focus-pulse",
              corner.position,
              corner.edges,
            )}
            style={
              {
                borderColor: color,
                filter: `drop-shadow(0 0 6px ${color}) drop-shadow(0 0 12px ${color})`,
                animationDelay: `${corner.delay}s`,
                "--duration": `${duration}s`,
              } as React.CSSProperties
            }
          />
        ))}

        {/* Content Layer */}
        <div className={cn("relative z-10 rounded-xl bg-card border border-border/80 overflow-hidden h-full", contentClassName)}>
          {children}
        </div>
      </div>
    </>
  );
};

export default FocusFrameBorder;
