import type { Metadata } from "next";
import { judgingSteps, priceExamples, promptAnchor, publishedPrompts, type PublishedPrompt } from "@/lib/team/judging";
import { parseMarkdown } from "@/lib/team/markdown";
import { bp, money } from "@/lib/format";
import { Badge, Notice, Panel, Table, Td, buttonClass } from "@/components/ui/ui";
import { Markdown } from "./markdown";

export const metadata: Metadata = { title: "How judging works" };

const linkClass = "font-semibold text-slate-700 underline underline-offset-2 hover:text-slate-900";

function PromptPanel({ p }: { p: PublishedPrompt }) {
  return (
    <div id={promptAnchor(p.type)} className="scroll-mt-4" data-testid={`judging-prompt-${p.type}`}>
      <Panel title={`${p.label}: rubric and prompt`} actions={<Badge>at most {p.wordLimit} words</Badge>}>
        <p className="text-sm text-slate-700">
          {p.moves} The judge reads it with {p.context}.
        </p>
        <div className="mt-3" data-testid={`rubric-${p.type}`}>
          <Table head={["Rubric line", "Points"]} label={`${p.label} rubric`}>
            {p.rubric.map((l) => (
              <tr key={l.key}>
                <Td>{l.label}</Td>
                <Td mono className="text-right">
                  {l.max}
                </Td>
              </tr>
            ))}
            <tr>
              <Td className="font-semibold">Total</Td>
              <Td mono className="text-right font-semibold">
                {p.rubric.reduce((s, l) => s + l.max, 0)}
              </Td>
            </tr>
          </Table>
        </div>
        {p.prompt.ok ? (
          <>
            <p className="mt-4 text-sm text-slate-700">
              The judge&apos;s instructions for every {p.label === "PRD" ? "PRD" : p.label.toLowerCase()}, word for word, from <span className="font-mono">prompts/{p.file}</span>.
            </p>
            <dl className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-sm">
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">SHA-256</dt>
              <dd className="mt-0.5 break-all font-mono text-xs text-slate-900" data-testid={`prompt-sha-${p.type}`}>
                {p.prompt.sha}
              </dd>
            </dl>
            <p className="mt-2 text-xs text-slate-500">
              Every judging run stores the SHA-256 of the prompt it used, so each score can be matched to this exact text; a change of even one
              character gives a different SHA-256.{" "}
              <a href={`data:text/markdown;charset=utf-8,${encodeURIComponent(p.prompt.text)}`} download={p.file} className={linkClass}>
                Download {p.file}
              </a>
            </p>
            <div className="mt-4 border-t border-slate-100 pt-4">
              <Markdown blocks={parseMarkdown(p.prompt.text)} label={`${p.label} prompt`} headingBase={2} />
            </div>
            <details className="mt-4 border-t border-slate-100 pt-3">
              <summary className="cursor-pointer text-sm font-semibold text-slate-700">The prompt as plain text</summary>
              <pre className="mt-2 whitespace-pre-wrap rounded-md bg-slate-50 px-3 py-2 font-mono text-xs leading-relaxed text-slate-800 [overflow-wrap:anywhere]">
                {p.prompt.text}
              </pre>
            </details>
          </>
        ) : (
          <div className="mt-4">
            <Notice tone="amber">The judge&apos;s instructions are published here before the round starts. If the round has started and they are missing, tell an organiser.</Notice>
          </div>
        )}
      </Panel>
    </div>
  );
}

// How judging works, for every team at every phase: the steps of judging, what a score does to the price, and for
// the PRD and the crisis solution the rubric and the judge's prompt exactly as the judge receives it, read from
// prompts/ on the server with the worker's own loader, each with the SHA-256 that every reading stores. Shown as
// formatted text (lib/team/markdown, never as HTML) and as the plain file.
export default function TeamJudgingPage() {
  const prompts = publishedPrompts();
  return (
    <div className="space-y-6">
      <Panel title="How judging works">
        <p className="text-sm text-slate-700">
          An AI judge scores every PRD (Round 1) and every crisis solution (Round 2) out of 100 against the published rubric. This is what happens to your
          work; below are each rubric and the judge&apos;s instructions, word for word.
        </p>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-700 marker:text-slate-500" aria-label="How a submission is judged">
          {judgingSteps().map((s) => (
            <li key={s.title} className="pl-1">
              <span className="font-semibold text-slate-900">{s.title}</span> {s.text}
            </li>
          ))}
        </ol>
        <nav aria-label="The rubrics and prompts" className="mt-4 flex flex-wrap gap-2">
          {prompts.map((p) => (
            <a key={p.type} href={`#${promptAnchor(p.type)}`} className={buttonClass.secondary}>
              {p.label}
            </a>
          ))}
        </nav>
      </Panel>

      <Panel title="What a score does to the price">
        <div data-testid="judging-prices">
          <Table head={["Score", "PRD: starting price", "Crisis solution: reveal", "A $10.00 company after the crisis and the reveal"]} label="Score and price">
            {priceExamples().map((e) => (
              <tr key={e.score}>
                <Td mono>{e.score}</Td>
                <Td mono>{money(e.start)}</Td>
                <Td mono>{bp(e.factorBp - 10_000)}</Td>
                <Td mono>{money(e.afterReveal)}</Td>
              </tr>
            ))}
          </Table>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Starting price = $10.00 + $0.10 × (PRD score − 50). The crisis takes 15% off every price. At 02:45 the price moves by 0.5% for every point the
          crisis solution scores above or below 50. At the 04:30 close the closing price is half the market price and half the score-based price, which
          trading never moves.
        </p>
      </Panel>

      {prompts.map((p) => (
        <PromptPanel key={p.type} p={p} />
      ))}
    </div>
  );
}
