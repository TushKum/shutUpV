import Link from "next/link";
import type { SubmissionType } from "@msim/engine";
import type { TeamContext } from "@/lib/team/context";
import { sectionAllowed } from "@/lib/team/sections";
import { fieldSpecs } from "@/lib/team/editor";
import { Notice } from "@/components/ui/ui";

/** The notice a page shows instead of the workspace: to a Finance team, and to everyone before the squads exist. */
export function squadGate(ctx: TeamContext) {
  if (!sectionAllowed(ctx.team.track, "/squad")) {
    return (
      <Notice tone="blue">
        The squad workspace is for the Product and Consulting teams. Your squad&apos;s deal is signed under{" "}
        <Link href="/team/rescue" className="font-semibold underline">
          Rescue
        </Link>
        , and your trading is under{" "}
        <Link href="/team/trade" className="font-semibold underline">
          Trade
        </Link>
        .
      </Notice>
    );
  }
  if (!ctx.squad) {
    return <Notice>The squads are formed at the squad draw. Your squad workspace opens then.</Notice>;
  }
  return null;
}

/** Stored content shown read-only, field by field (a submitted version). */
export function ContentView({ type, content }: { type: SubmissionType; content: Record<string, unknown> }) {
  return (
    <dl className="space-y-3 text-sm">
      {fieldSpecs(type).map((f) => {
        const v = typeof content[f.key] === "string" ? (content[f.key] as string) : "";
        return (
          <div key={f.key}>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{f.label}</dt>
            <dd className="mt-0.5 whitespace-pre-wrap text-slate-900">{v.trim() === "" ? <span className="text-slate-400">—</span> : v}</dd>
          </div>
        );
      })}
    </dl>
  );
}
