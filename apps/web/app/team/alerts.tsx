"use client";

// Alerts for a team: a toast 5 minutes and 1 minute before each of its open deadlines, and when something happens
// (a round clears or opens, news, the crisis, scores). Each deadline warning is given once per screen session, even
// across refreshes. A team can switch on a beep and a buzz (SoundToggle, in the header); browsers allow sound only
// after a click, which the switch is. The clock is the event's, so nothing counts down while the event is paused.

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Track } from "@msim/engine";
import { useDeadlineNow } from "@/lib/live/clock";
import { useEventChannel } from "@/lib/live/channel";
import { dueAlert, eventToast, leftText } from "@/lib/team/alerts";

interface AlertTask {
  key: string;
  title: string;
  due: string;
  href: string | null;
}

interface Toast {
  id: number;
  text: string;
  tone: "info" | "good" | "warn";
  href: string | null;
}

const SOUND_KEY = "msim:alert-sound";
let audio: AudioContext | null = null;

function soundOn(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) === "on";
  } catch {
    return false;
  }
}

function beep(urgent: boolean) {
  if (!soundOn()) return;
  try {
    navigator.vibrate?.(urgent ? [200, 100, 200] : 150);
    if (!audio) return;
    const at = audio.currentTime;
    for (const [i, f] of (urgent ? [880, 1175] : [660]).entries()) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0.15, at + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.001, at + i * 0.18 + 0.16);
      osc.connect(gain).connect(audio.destination);
      osc.start(at + i * 0.18);
      osc.stop(at + i * 0.18 + 0.17);
    }
  } catch {
    // No sound is fine.
  }
}

function given(key: string): Set<number> {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(`msim:alert:${key}`) ?? "[]") as number[]);
  } catch {
    return new Set();
  }
}

function remember(key: string, thresholds: number[]) {
  try {
    sessionStorage.setItem(`msim:alert:${key}`, JSON.stringify([...new Set([...given(key), ...thresholds])]));
  } catch {
    // Private mode: the warning may repeat after a refresh.
  }
}

const TONE = {
  info: "border-slate-300 bg-white text-slate-900",
  good: "border-emerald-300 bg-emerald-50 text-emerald-950",
  warn: "border-amber-400 bg-amber-50 text-amber-950",
} as const;

export function Alerts({ tasks, track }: { tasks: AlertTask[]; track: Track }) {
  const now = useDeadlineNow(1000);
  const { last } = useEventChannel();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const push = (t: Omit<Toast, "id">, ms: number, loud: boolean, urgent = false) => {
    const id = nextId.current++;
    setToasts((all) => [...all.slice(-3), { ...t, id }]);
    setTimeout(() => setToasts((all) => all.filter((x) => x.id !== id)), ms);
    if (loud) beep(urgent);
  };

  // Deadlines: checked every second against the event's clock.
  useEffect(() => {
    for (const t of tasks) {
      const key = `${t.key}:${t.due}`;
      const remaining = new Date(t.due).getTime() - now;
      const a = dueAlert(remaining, given(key));
      if (!a) continue;
      remember(key, a.reached);
      push({ text: `${leftText(remaining)}: ${t.title}`, tone: "warn", href: t.href }, 15_000, true, a.threshold <= 60_000);
    }
  }, [now, tasks]);

  // Broadcasts.
  const seen = useRef<number | null>(null);
  useEffect(() => {
    if (!last || seen.current === last.receivedAt) return;
    seen.current = last.receivedAt;
    const t = eventToast(last.event, last.payload, track);
    if (t) push({ text: t.text, tone: t.tone, href: t.href }, 10_000, t.loud);
  }, [last, track]);

  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-end gap-2 sm:left-auto sm:w-96" aria-live="polite" role="status" data-testid="alerts">
      {toasts.map((t) => (
        <div key={t.id} className={`pointer-events-auto flex w-full items-start gap-3 rounded-lg border px-4 py-3 text-sm shadow-lg ${TONE[t.tone]}`}>
          <span className="flex-1 font-medium [overflow-wrap:anywhere]">{t.text}</span>
          {t.href ? (
            <Link href={t.href} className="whitespace-nowrap font-semibold underline underline-offset-2">
              Open
            </Link>
          ) : null}
          <button type="button" aria-label="Dismiss" className="text-slate-500 hover:text-slate-900" onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

/** The header's switch for the beep and buzz. Turning it on is the click that lets the browser play sound. */
const soundListeners = new Set<() => void>();
const subscribeSound = (cb: () => void) => {
  soundListeners.add(cb);
  return () => void soundListeners.delete(cb);
};

export function SoundToggle() {
  const on = useSyncExternalStore(subscribeSound, soundOn, () => false);
  const toggle = () => {
    const next = !on;
    try {
      localStorage.setItem(SOUND_KEY, next ? "on" : "off");
    } catch {
      // Without storage the switch cannot be turned on.
    }
    for (const l of soundListeners) l();
    if (next) {
      try {
        const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        audio ??= Ctx ? new Ctx() : null;
        void audio?.resume();
      } catch {
        audio = null;
      }
      beep(false);
    }
  };
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={on}
      title={on ? "Alert sound and vibration on" : "Alert sound and vibration off"}
      className="rounded px-1.5 py-0.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
      data-testid="sound-toggle"
    >
      {on ? "🔔 Sound on" : "🔕 Sound off"}
    </button>
  );
}
