import { NextResponse } from "next/server";
import {
  applyCoordinationAction,
  createInitialCoordinationState,
  type CoordinationAction,
  type CoordinationState,
} from "../../coordination-types";

declare global {
  var __primusCoordinationState: CoordinationState | undefined;
}

function getServerState(): CoordinationState {
  if (
    !globalThis.__primusCoordinationState ||
    typeof globalThis.__primusCoordinationState.products?.XP01?.sharePrice !== "number" ||
    typeof globalThis.__primusCoordinationState.consultants?.XC01?.baseEquityPct !== "number" ||
    !Array.isArray(globalThis.__primusCoordinationState.raiseRequests) ||
    !Array.isArray(globalThis.__primusCoordinationState.financeDeals)
  ) {
    globalThis.__primusCoordinationState = createInitialCoordinationState();
  }
  return globalThis.__primusCoordinationState;
}

export const dynamic = "force-dynamic";

export async function GET() {
  const state = getServerState();
  return NextResponse.json(state, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { action?: CoordinationAction };
    if (!body?.action || typeof body.action.type !== "string") {
      return NextResponse.json({ error: "Missing action" }, { status: 400 });
    }
    const next = applyCoordinationAction(getServerState(), body.action);
    globalThis.__primusCoordinationState = next;
    return NextResponse.json(next, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch {
    return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
  }
}

export async function DELETE() {
  const next = applyCoordinationAction(getServerState(), { type: "RESET" });
  globalThis.__primusCoordinationState = next;
  return NextResponse.json(next, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
