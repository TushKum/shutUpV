import { describe, expect, test } from "vitest";
import { alertTasks, dueAlert, eventToast, leftText, nextAction } from "./alerts";
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
