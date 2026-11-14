import { describe, expect, test } from "vitest";
import { organiserTodos, type TodoInput, type TypeJudging } from "./todo";

const base: TodoInput = { format: "PRIMUS", drawn: true, deck: { problems: 3, crises: 12, statements: 30 }, judging: [], appealsReady: 0 };
const j = (over: Partial<TypeJudging>): TypeJudging => ({ type: "PITCH", closed: true, unscored: 0, scoring: 0, failed: 0, sealed: 0, released: 0, ...over });

describe("the organiser's to-do list", () => {
  test("nothing to do: an empty list", () => {
    expect(organiserTodos(base)).toEqual([]);
    expect(organiserTodos({ ...base, judging: [j({ released: 50 })] })).toEqual([]);
  });

  test("missing decks before the draw; the statements until they are uploaded", () => {
    const t = organiserTodos({ ...base, drawn: false, deck: { problems: 0, crises: 0, statements: 0 } });
    expect(t.map((x) => x.text)).toEqual([
      "Upload the problem deck: the squad draw needs it.",
      "Upload the crisis deck: it locks at the squad draw.",
      "Upload the Round 3 problem statements before the draft.",
    ]);
    expect(t.every((x) => x.path === "/content")).toBe(true);
    // A classic event has no crisis deck or statements to ask for.
    expect(organiserTodos({ ...base, format: "CLASSIC", drawn: false, deck: { problems: 0, crises: 0, statements: 0 } })).toHaveLength(1);
  });

  test("judging, step by step: start, wait, release; failures first", () => {
    expect(organiserTodos({ ...base, judging: [j({ closed: false, unscored: 40 })] })).toEqual([]);
    expect(organiserTodos({ ...base, judging: [j({ unscored: 40 })] })[0]).toEqual({ tone: "red", text: "Start judging the pitch: 40 answers wait.", path: "/judge?type=PITCH" });
    expect(organiserTodos({ ...base, judging: [j({ scoring: 12, sealed: 28 })] })[0]!.text).toBe("The judge is scoring the pitch (12 left).");
    expect(organiserTodos({ ...base, judging: [j({ sealed: 50 })] })[0]).toMatchObject({ tone: "amber", text: "Release the pitch scores (50 ready): prices move when you do." });
    const failed = organiserTodos({ ...base, judging: [j({ type: "CRISIS_2", scoring: 3, failed: 1, sealed: 47 })], appealsReady: 1 });
    expect(failed.map((x) => x.text)).toEqual(["1 judge run of the crisis 2 response plan failed: retry them.", "1 appeal has a new score: apply or dismiss."]);
  });

  test("the most urgent first", () => {
    const t = organiserTodos({ ...base, appealsReady: 2, judging: [j({ type: "PITCH", sealed: 5 }), j({ type: "MEMO", unscored: 3 })] });
    expect(t.map((x) => x.tone)).toEqual(["red", "amber", "amber"]);
  });
});
