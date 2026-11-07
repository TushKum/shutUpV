import { describe, expect, test } from "vitest";
import { alertTasks, changeText, dueAlert, eventToast, leftText, nextAction, type TimingChange } from "./alerts";
import type { HomePlan, HomeTask } from "./home";

const task = (key: string, state: HomeTask["state"], due: string | null, href: string | null = "/team/rescue"): HomeTask => ({
  key,
  title: `Task ${key}`,
  detail: "",
  href,
  linkLabel: "Open",
  due,
  dueLabel: due ? "closes" : null,
  state,
});
const plan = (now: HomeTask[]): HomePlan => ({ now, next: [], idle: "" });

describe("nextAction and alertTasks", () => {
  test("the first open task of this team with somewhere to go; partners' turns and done tasks are skipped", () => {
    const p = plan([task("a", "info", "2026-11-14T19:35:00Z"), task("b", "done", null), task("c", "todo", null, null), task("d", "todo", "2026-11-14T19:40:00Z"), task("e", "todo", "2026-11-14T19:50:00Z")]);
    expect(nextAction(p)?.key).toBe("d");
    expect(alertTasks(p).map((t) => t.key)).toEqual(["d", "e"]);
    expect(nextAction(plan([task("x", "done", null)]))).toBeNull();
  });
});

describe("dueAlert", () => {
  test("5 minutes, then 1 minute, each once", () => {
    expect(dueAlert(6 * 60_000, new Set())).toBeNull();
    expect(dueAlert(5 * 60_000, new Set())).toEqual({ threshold: 300_000, reached: [300_000] });
    expect(dueAlert(4 * 60_000, new Set([300_000]))).toBeNull();
    expect(dueAlert(59_000, new Set([300_000]))).toEqual({ threshold: 60_000, reached: [300_000, 60_000] });
    expect(dueAlert(30_000, new Set([300_000, 60_000]))).toBeNull();
  });

  test("opened late: only the most urgent warning; never after the deadline", () => {
    expect(dueAlert(50_000, new Set())).toEqual({ threshold: 60_000, reached: [300_000, 60_000] });
    expect(dueAlert(0, new Set())).toBeNull();
    expect(dueAlert(-5000, new Set())).toBeNull();
  });

  test("the time left in words", () => {
    expect(leftText(5 * 60_000)).toBe("Under 5 minutes left");
    expect(leftText(4 * 60_000 + 10_000)).toBe("Under 5 minutes left");
    expect(leftText(89_000)).toBe("Under 2 minutes left");
    expect(leftText(59_000)).toBe("Under a minute left");
  });
});

describe("eventToast", () => {
  test("the night's big moments are loud and point to the right page", () => {
    expect(eventToast("problem_draw", {})).toMatchObject({ href: "/team/build", loud: true });
    expect(eventToast("twist", { title: "Fuel prices double" })).toMatchObject({ text: "The twist: Fuel prices double. Your PRD must answer it.", loud: true });
    expect(eventToast("prices_started", {})).toMatchObject({ href: "/team/build", loud: true });
    expect(eventToast("crisis", {})).toMatchObject({ href: "/team/rescue", loud: true, tone: "warn" });
    expect(eventToast("scores_revealed", {})).toMatchObject({ href: "/team/rescue", loud: true });
    expect(eventToast("closing_bell", {})).toMatchObject({ loud: true });
    expect(eventToast("locked", { type: "SOLUTION" })).toMatchObject({ href: "/team/rescue", loud: false });
    expect(eventToast("locked", { type: "PRD" })).toMatchObject({ href: "/team/build" });
  });

  test("rounds", () => {
    expect(eventToast("round_cleared", { round: 4 })).toMatchObject({ text: "Round 4 cleared: new prices are in.", href: "/team/trade/positions" });
    expect(eventToast("round_open", { round: 5 })).toMatchObject({ text: "Round 5 is open: place your orders.", href: "/team/trade" });
  });

  test("rumours and news are quiet; the twist bulletin has its own toast; unknown kinds say nothing", () => {
    expect(eventToast("bulletin", { title: "A buyer is circling CMP", bulletin_kind: "RUMOUR" })).toMatchObject({ text: "Rumour: A buyer is circling CMP", loud: false });
    expect(eventToast("bulletin", { title: "Dinner is served", bulletin_kind: "GENERAL" })).toMatchObject({ text: "News: Dinner is served", loud: false });
    expect(eventToast("bulletin", { title: "x", bulletin_kind: "TWIST" })).toBeNull();
    expect(eventToast("extended", { minutes: 5 })).toMatchObject({ text: "The organisers added 5 minutes: deadlines moved later." });
    expect(eventToast("qa", {})).toBeNull();
    expect(eventToast("correction", {})).toBeNull();
  });
});

describe("timing changes", () => {
  const lock = { key: "deadline:PRD_LOCK", kind: "deadline", label: "PRD form locks", from: "2026-11-20T17:30:00Z", to: "2026-11-20T17:15:00Z", earlier: true };
  const round = { key: "round:3", kind: "round", label: "Round 3 closes", from: "2026-11-20T21:30:00Z", to: "2026-11-20T21:40:00Z", earlier: false };
  const phase = { key: "phase:BUILD", kind: "phase", label: "Build ends", from: "2026-11-20T17:30:00Z", to: "2026-11-20T17:15:00Z", earlier: true };

  test("a deadline brought earlier is loud, names the new time and comes first", () => {
    const t = eventToast("timing", { action: "set_timing", changes: [round, phase, lock] })!;
    expect(t).toMatchObject({ tone: "warn", loud: true });
    expect(t.text).toBe("Deadline moved earlier: PRD form locks 23:00 → 22:45; Round 3 closes 03:00 → 03:10.");
  });

  test("later only is a quiet notice; the phases' own ends and the draw are for the staff", () => {
    expect(eventToast("timing", { changes: [round] })).toMatchObject({ tone: "info", loud: false, text: "Timing changed: Round 3 closes 03:00 → 03:10." });
    expect(eventToast("timing", { changes: [phase, { ...lock, key: "deadline:PROBLEM_DRAW" }] })).toBeNull();
    expect(eventToast("timing", { changes: "nonsense" })).toBeNull();
  });

  test("untimed and newly timed", () => {
    expect(changeText({ ...lock, to: null } as TimingChange)).toBe("PRD form locks: when the organisers end the phase");
    expect(changeText({ ...lock, from: null } as TimingChange)).toBe("PRD form locks at 22:45");
  });

  test("the end of the night", () => {
    expect(eventToast("ended", {})).toMatchObject({ tone: "good", loud: true });
  });
});
