import type { Metadata } from "next";
import Link from "next/link";
import { loadTeamContext } from "@/lib/team/context";
import { sectionAllowed } from "@/lib/team/sections";
import { judgingSteps, promptAnchor, publishedPrompts, tierRows, type PublishedPrompt } from "@/lib/team/judging";
import { parseMarkdown } from "@/lib/team/markdown";
import { bp, money } from "@/lib/format";
import { Badge, Notice, Panel, Table, Td, buttonClass } from "@/components/ui/ui";
import { Markdown } from "./markdown";

export const metadata: Metadata = { title: "Judging" };

const linkClass = "font-semibold text-slate-700 underline underline-offset-2 hover:text-slate-900";

function PromptPanel({ p }: { p: PublishedPrompt }) {
  return (
    <div id={promptAnchor(p.type)} className="scroll-mt-4" data-testid={`judging-prompt-${p.type}`}>
      <Panel title={`${p.label} prompt`} actions={<Badge>at most {p.wordLimit} words</Badge>}>
        {p.prompt.ok ? (
          <>
            <p className="text-sm text-slate-700">
              The judge&apos;s instructions for every {p.label.toLowerCase()}, from <span className="font-mono">prompts/{p.file}</span>. {p.moves}
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
          <Notice tone="red">The {p.label.toLowerCase()} prompt could not be read on the server. Please tell an organiser.</Notice>
        )}
      </Panel>
    </div>
  );
}

// How the judge scores, for every track at every phase (the brief: "Store the prompts as files in the repo; they will
// be published to teams"): the steps of judging, the score tiers, and the three system prompts exactly as the judge
// receives them, read from prompts/ on the server with the worker's own loader, each with the SHA-256 that every
// judging run stores. Shown as formatted text (lib/team/markdown, never as HTML) and as the plain file.
export default async function TeamJudgingPage() {
  const { team } = await loadTeamContext();
  if (!sectionAllowed(team.track, "/judging")) {
    return (
      <Notice tone="blue">
        How the judge scores is not open to your track.{" "}
        <Link href="/team" className="font-semibold underline">
          Back to Home
        </Link>
      </Notice>
    );
  }
  const prompts = publishedPrompts();
  return (
    <div className="space-y-6">
      <Panel title="How the judge scores">
        <p className="text-sm text-slate-700">
          An AI judge scores every pitch card, rescue plan and flash answer out of 100 against a published rubric. This is what happens to a
          submission, and below are the three prompts the judge is given, word for word.
        </p>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-700 marker:text-slate-500" aria-label="How a submission is judged">
          {judgingSteps().map((s) => (
            <li key={s.title} className="pl-1">
              <span className="font-semibold text-slate-900">{s.title}</span> {s.text}
            </li>
          ))}
        </ol>
        <nav aria-label="The prompts" className="mt-4 flex flex-wrap gap-2">
          {prompts.map((p) => (
            <a key={p.type} href={`#${promptAnchor(p.type)}`} className={buttonClass.secondary}>
              {p.label} prompt
            </a>
          ))}
        </nav>
      </Panel>

      <Panel title="Score tiers">
        <div data-testid="judging-tiers">
          <Table head={["Score", "Pitch", "Plan", "Flash"]} label="Score tiers">
            {tierRows().map((t) => (
              <tr key={t.band}>
                <Td mono>{t.band}</Td>
                <Td mono>
                  {bp(t.bp.PITCH)}
                  <span className="block text-xs text-slate-500">IPO {money(t.ipoPrice)}</span>
                </Td>
                <Td mono>{bp(t.bp.PLAN)}</Td>
                <Td mono>{bp(t.bp.FLASH)}</Td>
              </tr>
            ))}
          </Table>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          The change in price for a released score. The pitch tier sets the IPO price; plan and flash tiers apply to both the market price and the AI
          price.
        </p>
      </Panel>

      {prompts.map((p) => (
        <PromptPanel key={p.type} p={p} />
      ))}
    </div>
  );
}
