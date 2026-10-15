import type { ReactNode } from "react";
import { inlineText, type Align, type Block, type Inline } from "@/lib/team/markdown";

// Renders the block tree of lib/team/markdown as React elements: every piece of text goes through React as text,
// never as HTML, so a prompt can only ever show its own characters. Headings move down by `headingBase` levels to sit
// under the page's own headings. Tables scroll sideways inside their frame on a phone; code wraps instead of
// widening the page.

const HEADINGS = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;

const HEADING_CLASS: Record<number, string> = {
  1: "mt-6 text-lg font-semibold text-slate-900",
  2: "mt-6 text-base font-semibold text-slate-900",
};

const ALIGN: Record<Exclude<Align, null>, string> = { left: "text-left", center: "text-center", right: "text-right" };

function InlineView({ content }: { content: readonly Inline[] }): ReactNode {
  return content.map((n, i) => {
    switch (n.kind) {
      case "text":
        return n.text;
      case "code":
        return (
          <code key={i} className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.85em] text-slate-800">
            {n.text}
          </code>
        );
      case "strong":
        return (
          <strong key={i} className="font-semibold text-slate-900">
            <InlineView content={n.children} />
          </strong>
        );
      case "em":
        return (
          <em key={i}>
            <InlineView content={n.children} />
          </em>
        );
    }
  });
}

function BlockView({ block, base, label }: { block: Block; base: number; label: string }): ReactNode {
  switch (block.kind) {
    case "heading": {
      const Tag = HEADINGS[Math.min(block.level + base, 6) - 1]!;
      return (
        <Tag className={`${HEADING_CLASS[block.level] ?? "mt-4 text-sm font-semibold text-slate-900"} first:mt-0`}>
          <InlineView content={block.content} />
        </Tag>
      );
    }
    case "paragraph":
      return (
        <p className="mt-3 first:mt-0">
          <InlineView content={block.content} />
        </p>
      );
    case "list": {
      const items = block.items.map((item, i) => (
        <li key={i} className="pl-1">
          <Blocks blocks={item} base={base} label={label} />
        </li>
      ));
      return block.ordered ? (
        <ol start={block.start === 1 ? undefined : block.start} className="mt-3 list-decimal space-y-1 pl-5 marker:text-slate-500 first:mt-0 [li_&]:mt-1">
          {items}
        </ol>
      ) : (
        <ul className="mt-3 list-disc space-y-1 pl-5 marker:text-slate-400 first:mt-0 [li_&]:mt-1">{items}</ul>
      );
    }
    case "table": {
      const align = (k: number) => {
        const a = block.align[k];
        return a ? ALIGN[a] : "text-left";
      };
      return (
        <div
          role="region"
          aria-label={`${label}: table of ${block.head.map((h) => inlineText(h)).join(", ")}`}
          tabIndex={0}
          className="mt-3 overflow-x-auto rounded-md border border-slate-200 first:mt-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
        >
          <table className="w-full min-w-[36rem] text-sm [overflow-wrap:normal]">
            <thead className="bg-slate-50">
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                {block.head.map((h, k) => (
                  <th key={k} scope="col" className={`px-3 py-2 font-semibold ${align(k)}`}>
                    <InlineView content={h} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, k) => (
                    <td key={k} className={`px-3 py-2 align-top ${align(k)}`}>
                      <InlineView content={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    case "code":
      return (
        <pre className="mt-3 whitespace-pre-wrap rounded-md bg-slate-900 px-3 py-2 font-mono text-xs leading-relaxed text-slate-100 [overflow-wrap:anywhere] first:mt-0">
          <code>{block.text}</code>
        </pre>
      );
  }
}

function Blocks({ blocks, base, label }: { blocks: readonly Block[]; base: number; label: string }) {
  return blocks.map((b, i) => <BlockView key={i} block={b} base={base} label={label} />);
}

/** A Markdown document (parsed with lib/team/markdown's parseMarkdown). `label` names its tables for screen readers. */
export function Markdown({ blocks, label, headingBase = 0 }: { blocks: readonly Block[]; label: string; headingBase?: number }) {
  return (
    <div className="text-sm leading-relaxed text-slate-700">
      <Blocks blocks={blocks} base={headingBase} label={label} />
    </div>
  );
}
