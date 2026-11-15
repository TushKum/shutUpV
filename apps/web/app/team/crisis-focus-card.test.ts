import { describe, expect, test } from "vitest";
import { crisisParts } from "./crisis-focus-card";

describe("a crisis card's parts", () => {
  test("the situation, the twist and the decision, as the sector decks write them", () => {
    expect(crisisParts("A 46°C heatwave.\n\nThe twist: It lasts 10 more days.\n\nYour plan must decide: Rent it or ration.")).toEqual({
      situation: "A 46°C heatwave.",
      twist: "It lasts 10 more days.",
      decide: "Rent it or ration.",
    });
  });
  test("a card with no twist (an organiser's own deck) is all situation", () => {
    expect(crisisParts("A competitor launch hits the company.")).toEqual({ situation: "A competitor launch hits the company.", twist: null, decide: null });
  });
  test("a decision without a twist is still set apart", () => {
    expect(crisisParts("Prices fall.\n\nYour plan must decide: Cut or hold.")).toEqual({ situation: "Prices fall.", twist: null, decide: "Cut or hold." });
  });
});
