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
    const p = plan([task("a", "waiting", "2026-11-14T19:35:00Z"), task("b", "done", null), task("c", "todo", null, null), task("d", "todo", "2026-11-14T19:40:00Z"), task("e", "todo", "2026-11-14T19:50:00Z")]);
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
  test("rounds: every team hears a clearing; only funds hear that a round opened", () => {
    expect(eventToast("round_cleared", { round: 4 }, "PRODUCT")).toMatchObject({ text: "Round 4 cleared: new prices are in.", href: "/team/market" });
    expect(eventToast("round_cleared", { round: 4 }, "FINANCE")).toMatchObject({ href: "/team/trade/positions" });
    expect(eventToast("round_open", { round: 5 }, "FINANCE")).toMatchObject({ text: "Round 5 is open: place your orders." });
    expect(eventToast("squad_draw", {}, "PRODUCT")).toMatchObject({ href: "/team/squad", loud: true });
    expect(eventToast("squad_draw", {}, "FINANCE")).toMatchObject({ href: "/team/chat" });
    expect(eventToast("round_open", { round: 5 }, "CONSULTING")).toBeNull();
  });

  test("a flash bulletin is loud; other news quiet; unknown kinds say nothing", () => {
    expect(eventToast("bulletin", { title: "Interest rates rise", bulletin_kind: "FLASH" }, "PRODUCT")).toMatchObject({ text: "Flash news: Interest rates rise", loud: true, tone: "warn" });
    expect(eventToast("bulletin", { title: "Dinner is served", bulletin_kind: "GENERAL" }, "PRODUCT")).toMatchObject({ text: "News: Dinner is served", loud: false });
    expect(eventToast("crisis", {}, "CONSULTING")).toMatchObject({ href: "/team/rescue", loud: true });
    expect(eventToast("qa", {}, "PRODUCT")).toBeNull();
    expect(eventToast("correction", {}, "FINANCE")).toBeNull();
  });

  test("a PRIMUS crisis, an offer and a hire are announced to the teams they concern", () => {
    expect(eventToast("subround", { k: 2, step: "reveal" }, "FINANCE")).toMatchObject({ text: "Crisis 2! Every company has a new crisis card and every price fell 5%.", loud: true, href: "/team/crisis" });
    expect(eventToast("subround", { k: 2, step: "due" }, "PRODUCT")!.text).toBe("Time is up for crisis 2. Now rate your firm.");
    expect(eventToast("subround", { k: 2, step: "hiring_closed" }, "FINANCE")).toBeNull();
    expect(eventToast("offers", { firm: "f", product: "p" }, "CONSULTING")!.text).toBe("A company sent you an offer.");
    expect(eventToast("offers", { firm: "f", product: "p" }, "PRODUCT")).toBeNull(); // its own offer
    expect(eventToast("offers", { offer: "o", accepted: true }, "PRODUCT")!.text).toBe("Deal! You have hired a firm.");
    expect(eventToast("offers", { offer: "o", accepted: true }, "CONSULTING")!.loud).toBe(true);
    expect(eventToast("draft", { step: "start" }, "PRODUCT")!.text).toBe("Round 3: the draft has started.");
    expect(eventToast("draft", { step: "pick", pick_no: 3 }, "PRODUCT")).toBeNull();
    expect(eventToast("draft", { step: "pick", next_product: "p7" }, "PRODUCT", "p7")).toMatchObject({ text: "Your pick! Choose a problem statement now: you have 20 seconds.", loud: true });
    expect(eventToast("draft", { step: "pick", next_product: "p7" }, "PRODUCT", "p8")).toBeNull();
    expect(eventToast("draft", { step: "start", next_product: "p7" }, "PRODUCT", "p7")!.text).toContain("Your pick!");
  });
});
