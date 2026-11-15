"use client";

import React, { useEffect, useRef } from "react";
import { motion, type Variants } from "framer-motion";
import { ArrowRight, BarChart2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SonicWaveformCanvasProps {
  className?: string;
  /** Line colour as "r, g, b" (default teal "0, 255, 192"). */
  rgb?: string;
  /** Number of wave lines (fewer on small screens is kinder to phones). */
  lineCount?: number;
  /** Fill colour of the trail behind the lines. */
  fade?: string;
}

// Sonic Waveform Canvas Component: animated wave lines that swell near the pointer (mouse or touch). It stops when the
// tab is hidden and draws a single still frame for people who ask for reduced motion.
export const SonicWaveformCanvas = ({
  className,
  rgb = "0, 255, 192",
  lineCount: lines = 60,
  fade = "rgba(0, 0, 0, 0.1)",
}: SonicWaveformCanvasProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrameId = 0;
    const mouse = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    let time = 0;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };

    const frame = () => {
      ctx.fillStyle = fade;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const lineCount = window.innerWidth < 640 ? Math.ceil(lines / 2) : lines;
      const segmentCount = window.innerWidth < 640 ? 40 : 80;
      const height = canvas.height / 2;

      for (let i = 0; i < lineCount; i++) {
        ctx.beginPath();
        const progress = i / lineCount;
        const colorIntensity = Math.sin(progress * Math.PI);
        ctx.strokeStyle = `rgba(${rgb}, ${colorIntensity * 0.5})`;
        ctx.lineWidth = 1.5;

        for (let j = 0; j < segmentCount + 1; j++) {
          const x = (j / segmentCount) * canvas.width;

          // Mouse influence
          const distToMouse = Math.hypot(x - mouse.x, height - mouse.y);
          const mouseEffect = Math.max(0, 1 - distToMouse / 400);

          // Wave calculation
          const noise = Math.sin(j * 0.1 + time + i * 0.2) * 20;
          const spike = Math.cos(j * 0.2 + time + i * 0.1) * Math.sin(j * 0.05 + time) * 50;
          const y = height + noise + spike * (1 + mouseEffect * 2);

          if (j === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      time += 0.02;
    };

    const draw = () => {
      frame();
      animationFrameId = requestAnimationFrame(draw);
    };
    const start = () => {
      cancelAnimationFrame(animationFrameId);
      if (reduced) {
        for (let k = 0; k < 20; k++) frame(); // a still, settled picture
      } else if (document.visibilityState === "visible") draw();
    };

    const handleMouseMove = (event: MouseEvent) => {
      mouse.x = event.clientX;
      mouse.y = event.clientY;
    };
    const handleTouch = (event: TouchEvent) => {
      const t = event.touches[0];
      if (t) {
        mouse.x = t.clientX;
        mouse.y = t.clientY;
      }
    };
    const handleVisibility = () => (document.visibilityState === "visible" ? start() : cancelAnimationFrame(animationFrameId));
    const handleResize = () => {
      resizeCanvas();
      if (reduced) start();
    };

    window.addEventListener("resize", handleResize);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("touchmove", handleTouch, { passive: true });
    document.addEventListener("visibilitychange", handleVisibility);

    resizeCanvas();
    start();

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("touchmove", handleTouch);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [rgb, lines, fade]);

  return <canvas ref={canvasRef} aria-hidden className={cn("absolute inset-0 z-0 h-full w-full bg-black", className)} />;
};

export const fadeUpVariants: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      delay: i * 0.2 + 0.5,
      duration: 0.8,
      ease: "easeInOut",
    },
  }),
};

// The main hero component
const SonicWaveformHero = () => {
  return (
    <div className="relative flex h-screen w-full flex-col items-center justify-center overflow-hidden">
      <SonicWaveformCanvas />

      <div className="absolute inset-0 z-10 bg-gradient-to-t from-black via-black/30 to-transparent"></div>

      {/* Overlay HTML Content */}
      <div className="relative z-20 p-6 text-center">
        <motion.div
          custom={0}
          variants={fadeUpVariants}
          initial="hidden"
          animate="visible"
          className="mb-6 inline-flex items-center gap-2 rounded-full border border-teal-500/20 bg-teal-500/10 px-4 py-1.5 backdrop-blur-sm"
        >
          <BarChart2 className="h-4 w-4 text-teal-300" />
          <span className="text-sm font-medium text-gray-200">Real-Time Data Sonification</span>
        </motion.div>

        <motion.h1
          custom={1}
          variants={fadeUpVariants}
          initial="hidden"
          animate="visible"
          className="mb-6 bg-gradient-to-b from-white to-gray-400 bg-clip-text text-5xl font-bold tracking-tighter text-transparent md:text-7xl"
        >
          Sonic Waveform
        </motion.h1>

        <motion.p custom={2} variants={fadeUpVariants} initial="hidden" animate="visible" className="mx-auto mb-10 max-w-2xl text-lg text-gray-400">
          Translate complex data streams into intuitive, interactive soundscapes. Hear the patterns, feel the insights.
        </motion.p>

        <motion.div custom={3} variants={fadeUpVariants} initial="hidden" animate="visible">
          <button className="mx-auto flex items-center gap-2 rounded-lg bg-white px-8 py-4 font-semibold text-black shadow-lg transition-colors duration-300 hover:bg-gray-200">
            Analyze the Stream
            <ArrowRight className="h-5 w-5" />
          </button>
        </motion.div>
      </div>
    </div>
  );
};

export default SonicWaveformHero;
