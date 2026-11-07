import type { SubmissionType } from "@msim/engine";
import { submissionSections } from "@/lib/team/market";
import type { PublicSubmission } from "@/lib/team/market-data";
import { count } from "@/lib/format";

/** A public submission: its template parts in order, as locked, with its word count. */
export function Submission({ type, s }: { type: SubmissionType; s: PublicSubmission }) {
  const sections = submissionSections(type, s.content);
  const name = typeof s.content.company_name === "string" ? s.content.company_name : null;
  return (
    <div className="space-y-3 text-sm" data-testid={`submission-${type}`}>
      {name ? <p className="font-semibold text-slate-900">{name}</p> : null}
      <dl className="space-y-3">
        {sections.map((x) => (
          <div key={x.key}>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{x.label}</dt>
            <dd className="mt-0.5 whitespace-pre-wrap text-slate-800">{x.text || <span className="text-slate-400">(left empty)</span>}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-slate-500">{count(s.word_count)} words · the version saved before the lock</p>
    </div>
  );
}
