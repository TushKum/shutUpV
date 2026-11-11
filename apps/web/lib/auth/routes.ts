// Which role may open which area. Pure, so it is unit-tested; the server layouts enforce it.

import type { AccountRole } from "@msim/engine";

export const AREAS = {
  "/team": ["TEAM"],
  "/admin": ["ORGANISER", "FAIRNESS"],
  "/display": ["DISPLAY", "ORGANISER", "FAIRNESS"],
} as const satisfies Record<string, readonly AccountRole[]>;

export type Area = keyof typeof AREAS;

export function areaOf(path: string): Area | null {
  for (const area of Object.keys(AREAS) as Area[]) {
    if (path === area || path.startsWith(`${area}/`)) return area;
  }
  return null;
}

export function canAccess(path: string, role: AccountRole): boolean {
  const area = areaOf(path);
  return area === null || (AREAS[area] as readonly AccountRole[]).includes(role);
}

export function homeFor(role: AccountRole): Area {
  if (role === "TEAM") return "/team";
  if (role === "DISPLAY") return "/display";
  return "/admin";
}

/** Where to go after login: the requested page if it is a same-site path this role may open. */
export function safeNext(next: unknown, role: AccountRole): string {
  if (typeof next === "string" && /^\/(?!\/)[\w\-/?=&.%]*$/.test(next) && areaOf(next) && canAccess(next, role)) {
    return next;
  }
  return homeFor(role);
}
