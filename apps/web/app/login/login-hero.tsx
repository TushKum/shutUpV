"use client";

// The PRIMUS sign-in page's welcome, beside the sign-in card (above it on a phone): what the night is, and the three
// tracks, with this portal's own track lit when the deployment serves one track. It fades up line by line (not for
// people who ask for reduced motion: framer-motion then shows it at once).

import { motion, MotionConfig } from "framer-motion";
import { Activity, Briefcase, ChartLine, QrCode, Rocket, type LucideIcon } from "lucide-react";
import type { Track } from "@msim/engine";
import { fadeUpVariants } from "@/components/ui/sonic-waveform";
import { cn } from "@/lib/utils";

const TRACKS: { track: Track; label: string; line: string; Icon: LucideIcon }[] = [
  { track: "PRODUCT", label: "Product", line: "Build a startup and list it", Icon: Rocket },
  { track: "CONSULTING", label: "Consulting", line: "Advise companies through every crisis", Icon: Briefcase },
  { track: "FINANCE", label: "Finance", line: "Invest, trade, beat the market", Icon: ChartLine },
];

export function LoginHero({ portal }: { portal: Track | null }) {
  return (
    <MotionConfig reducedMotion="user">
      <section className="text-center lg:text-left" aria-labelledby="primus-title">
        <motion.p
          custom={0}
          variants={fadeUpVariants}
          initial="hidden"
          animate="visible"
          className="mb-4 inline-flex items-center gap-2 rounded-full sm:mb-5 border border-phosphor/30 bg-phosphor/10 px-4 py-1.5 backdrop-blur-sm"
        >
          <Activity className="size-4 text-phosphor" aria-hidden />
          <span className="font-mono text-xs font-semibold tracking-wider text-paper sm:text-sm">
            LIVE MARKET SIMULATION<span className="hidden sm:inline"> · ONE NIGHT</span>
          </span>
        </motion.p>

        <motion.h1
          id="primus-title"
          custom={1}
          variants={fadeUpVariants}
          initial="hidden"
          animate="visible"
          className="mb-3 bg-gradient-to-b from-paper to-phosphor bg-clip-text font-mono text-6xl font-extrabold tracking-tighter text-transparent drop-shadow-[0_0_24px_rgba(0,255,65,0.35)] md:text-8xl"
        >
          PRIMUS
        </motion.h1>

        <motion.p
          custom={2}
          variants={fadeUpVariants}
          initial="hidden"
          animate="visible"
          className="mx-auto mb-2 max-w-md text-base text-muted sm:mb-6 sm:text-lg lg:mx-0"
        >
          Build a company, survive four crises, trade every move. Your share price is your score.
        </motion.p>

        <motion.ul
          custom={3}
          variants={fadeUpVariants}
          initial="hidden"
          animate="visible"
          className="mx-auto hidden max-w-md gap-2 sm:grid lg:mx-0"
          aria-label="The three tracks"
        >
          {TRACKS.map(({ track, label, line, Icon }) => {
            const mine = portal === track;
            const dim = portal !== null && !mine;
            return (
              <li
                key={track}
                className={cn(
                  "flex items-center gap-3 rounded-lg border bg-black/50 px-3 py-2 text-left backdrop-blur-sm",
                  mine ? "border-phosphor text-phosphor" : "border-line text-paper",
                  dim && "opacity-50",
                )}
              >
                <Icon className="size-5 shrink-0 text-phosphor" aria-hidden />
                <span className="font-mono text-sm font-bold">{label}</span>
                <span className="text-sm text-muted">{line}</span>
              </li>
            );
          })}
        </motion.ul>

        <motion.p
          custom={4}
          variants={fadeUpVariants}
          initial="hidden"
          animate="visible"
          className="mt-5 hidden items-center justify-center gap-2 text-sm text-muted sm:flex lg:justify-start"
        >
          <QrCode className="size-4 text-phosphor" aria-hidden /> Scan the QR code on your card, or type your team code.
        </motion.p>
      </section>
    </MotionConfig>
  );
}
