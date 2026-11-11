import { afterEach, describe, expect, test, vi } from "vitest";
import { parsePortal, portalAdmits, portalOfHost, portalUrl, teamPortal, wrongPortalMessage } from "./portal";

afterEach(() => vi.unstubAllEnvs());

describe("team portals", () => {
  test("a deployment's portal is one track, or every track when unset", () => {
    expect(parsePortal("finance")).toBe("FINANCE");
    expect(parsePortal(" Product ")).toBe("PRODUCT");
    expect(parsePortal("")).toBeNull();
    expect(parsePortal("ADMIN")).toBeNull();
    vi.stubEnv("TEAM_PORTAL", "CONSULTING");
    return expect(teamPortal()).resolves.toBe("CONSULTING");
  });
  test("or the host name says which portal it is", () => {
    expect(portalOfHost("primus-finance.vercel.app")).toBe("FINANCE");
    expect(portalOfHost("primus-product-team.vercel.app:443")).toBe("PRODUCT");
    expect(portalOfHost("primus.vercel.app")).toBeNull();
    expect(portalOfHost("product-finance.example.com")).toBeNull();
    expect(portalOfHost(null)).toBeNull();
  });
  test("a track's portal admits only that track", () => {
    expect(portalAdmits(null, "FINANCE")).toBe(true);
    expect(portalAdmits("FINANCE", "FINANCE")).toBe(true);
    expect(portalAdmits("FINANCE", "PRODUCT")).toBe(false);
  });
  test("a team at the wrong door is told where to go", () => {
    vi.stubEnv("PORTAL_URL_PRODUCT", "https://product.example.com/");
    vi.stubEnv("PORTAL_URL_CONSULTING", "http://insecure.example.com");
    expect(portalUrl("PRODUCT")).toBe("https://product.example.com");
    expect(portalUrl("CONSULTING")).toBeNull();
    expect(wrongPortalMessage("FINANCE", "PRODUCT", "https://product.example.com")).toBe(
      "This is the Finance portal, for Finance teams only. Product teams sign in on the Product portal at https://product.example.com.",
    );
  });
});
