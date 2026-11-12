import { describe, expect, test } from "vitest";
import { concerns } from "./channel";

describe("which broadcasts make a team's screen re-read", () => {
  test("an offer concerns only the Product team and the firm it is between", () => {
    const offer = { event: "offers", payload: { offer: "o1", firm: "firm-1", product: "prod-1" } };
    expect(concerns(offer, "firm-1")).toBe(true);
    expect(concerns(offer, "prod-1")).toBe(true);
    expect(concerns(offer, "fund-9")).toBe(false);
    expect(concerns(offer, null)).toBe(true); // staff and the projector hear everything
    expect(concerns({ event: "offers", payload: { offer: "o1" } }, "fund-9")).toBe(true); // an older database
  });
  test("everything else concerns everyone", () => {
    expect(concerns({ event: "round_cleared", payload: {} }, "fund-9")).toBe(true);
    expect(concerns({ event: "subround" }, "fund-9")).toBe(true);
  });
});
