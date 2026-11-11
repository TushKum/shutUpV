import type { SubmissionType } from "@msim/engine";
import { submissionSections } from "@/lib/team/market";
import type { PublicSubmission } from "@/lib/team/market-data";
import { clock, count } from "@/lib/format";

/** A public submission: its template sections in order, as submitted, with its word count and time. */
export function Submission({ type, s }: { type: SubmissionType; s: PublicSubmission }) {
  const sections = submissionSections(type, s.content);
  return (
    <div className="space-y-3 text-sm" data-testid={`submission-${type}`}>
      <dl className="space-y-3">
        {sections.map((x) => (
          <div key={x.key}>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{x.label}</dt>
            <dd className="mt-0.5 whitespace-pre-wrap text-slate-800">{x.text || <span className="text-slate-400">(left empty)</span>}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-slate-500">
        {count(s.word_count)} words · submitted {clock(s.submitted_at)}
      </p>
    </div>
  );
}
