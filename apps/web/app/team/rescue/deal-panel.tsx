// The rescue deal: the Consulting team proposes the price per share (50%–100% of the post-crisis price), the fund
// sets the amount ($40,000–$80,000); shares = floor(amount ÷ price) move from the Product team's retained shares into
// the fund's squad lot, and the fund pays shares × price to the company. All three teams sign the same version; any
// edit resets every signature, and the third signature executes the deal. Signing takes two clicks (the last one
// moves shares and cash for good); proposing a term takes one (it can be changed until 03:00).

import { RULES, TRACKS, type Track } from "@msim/engine";
import { clock, money } from "@/lib/format";
import { dealBalanceWarning, dealTermsText, teamLabel, upperFirst, type DealView, type Deadlines, type PauseState } from "@/lib/team/rescue";
import { Badge, Notice, Panel } from "@/components/ui/ui";
import { DoThis, HowItWorks } from "@/components/ui/how-it-works";
import { setDealAmount, setDealPrice, signDeal } from "./actions";
import { ClosingActionButton, Due } from "./parts";
import { DealTermForm } from "./terms-form";

export function DealPanel({
  deal,
  track,
  deadlines,
  pause,
  postCrisis,
  fundAvailable,
  retained,
}: {
  deal: DealView;
  track: Track;
  deadlines: Deadlines;
  pause: PauseState;
  postCrisis: number | null;
  fundAvailable: number | null;
  retained: number | null;
}) {
  const warning = dealBalanceWarning(deal, { track, fundAvailable, retained });
  const showTerms = deal.stage !== "BEFORE_CRISIS";
  return (
    <Panel
      title="Rescue deal"
      actions={
        <span className="text-sm text-paper">
          Due <Due at={deadlines.DEAL} pause={pause} testId="deal-due" closed={deal.stage === "SIGNED" ? "signed" : null} />
        </span>
      }
    >
      <div className="space-y-4 text-sm" data-testid="deal" data-stage={deal.stage}>
        <DoThis testId="deal-todo">
          {track === "CONSULTING"
            ? `Set the price per share${deal.band ? ` (${money(deal.band.min)}–${money(deal.band.max)})` : ""}, then sign.`
            : track === "FINANCE"
              ? `Set how much your fund invests (${money(RULES.DEAL_MIN)}–${money(RULES.DEAL_MAX)}), then sign.`
              : "Check the price and the amount, then sign. All three teams must sign."}
        </DoThis>
        <HowItWorks testId="deal-rules">
          <p>
            The Consulting team proposes the price per share, between 50% and 100% of the post-crisis price
            {deal.band ? ` (${money(deal.band.min)} to ${money(deal.band.max)})` : ""}. The fund sets the amount, {money(RULES.DEAL_MIN)} to{" "}
            {money(RULES.DEAL_MAX)}.
          </p>
          <p>
            Shares = amount ÷ price, rounded down. They move from the Product team&apos;s retained shares to the fund, and the fund pays shares × price to the
            company.
          </p>
          <p>All three teams sign the same version; any change resets every signature. The third signature completes the deal.</p>
        </HowItWorks>
        <dl className="grid gap-2.5 sm:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]">
            <dt className="font-mono text-[11px] font-medium uppercase tracking-wider text-slate-400">Deal bonus</dt>
            <dd className="mt-1 text-slate-200">
              Fully signed by <Due at={deadlines.DEAL_BONUS} pause={pause} testId="deal-bonus-due" closed={deal.bonus === "YES" ? "signed" : null} />: the Consulting team earns {money(RULES.DEAL_BONUS)}.{" "}
              <OutcomeBadge testId="deal-bonus" value={deal.bonus} yes="Bonus earned" no="No bonus" />
            </dd>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]">
            <dt className="font-mono text-[11px] font-medium uppercase tracking-wider text-slate-400">Plan cap</dt>
            <dd className="mt-1 text-slate-200">
              Not fully signed at {deadlines.DEAL ? clock(deadlines.DEAL) : "03:00"}: the rescue plan&apos;s score is capped at {RULES.PLAN_CAP_WITHOUT_DEAL}.{" "}
              <OutcomeBadge testId="deal-cap" value={deal.capped} yes="Plan capped at 50" no="No cap" yesTone="red" />
            </dd>
          </div>
        </dl>

        {deal.stage === "BEFORE_CRISIS" ? <Notice>The deal can be agreed from the crisis.</Notice> : null}
        {deal.stage === "SIGNED" ? (
          <Notice tone="green">
            <span data-testid="deal-outcome">
              Signed by all three teams at {clock(deal.executedAt, true)}: {deal.shares?.toLocaleString("en-US")} shares at {money(deal.price)} moved from the
              Product team&apos;s retained shares into the fund&apos;s squad lot, and {money(deal.cashMoved)} was paid to the company.
            </span>
          </Notice>
        ) : null}
        {deal.stage === "CLOSED" ? (
          <Notice tone="red">
            <span data-testid="deal-outcome">
              The deal was not fully signed by the deadline: no shares or cash moved, there is no deal bonus, and the rescue plan&apos;s score is capped at{" "}
              {RULES.PLAN_CAP_WITHOUT_DEAL}.
            </span>
          </Notice>
        ) : null}

        {showTerms ? (
          <div className="rounded-2xl border border-white/14 bg-white/[0.045] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.16)]" data-testid="deal-terms">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold text-white">{deal.stage === "SIGNED" ? "Signed terms" : `Terms: version ${deal.version}`}</h3>
              {deal.editedBy && deal.editedAt ? (
                <span className="text-xs text-muted">
                  Last changed by {teamLabel(deal.editedBy, track)} at {clock(deal.editedAt, true)}
                </span>
              ) : null}
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
              <Term label="Price per share" hint="set by Consulting" value={deal.price === null ? "Not proposed" : money(deal.price)} testId="deal-price" />
              <Term label="Amount" hint="set by the fund" value={deal.amount === null ? "Not set" : money(deal.amount)} testId="deal-amount" />
              <Term label="Shares" value={deal.complete && deal.shares !== null ? deal.shares.toLocaleString("en-US") : "—"} testId="deal-shares" />
              <Term label="Cash moved" value={deal.complete ? money(deal.cashMoved) : "—"} testId="deal-cash" />
            </dl>
            <ul className="mt-3 space-y-1" aria-label="Deal signatures">
              {TRACKS.map((t) => (
                <li key={t} data-testid={`deal-sign-${t}`}>
                  {upperFirst(teamLabel(t, track))}:{" "}
                  {deal.signatures[t] ? <Badge tone="green">Signed {clock(deal.signatures[t], true)}</Badge> : <Badge tone="slate">Not signed</Badge>}
                </li>
              ))}
            </ul>
            {deal.stage === "OPEN" && !deal.complete ? (
              <p className="mt-2 text-paper">
                The terms can be signed once {deal.price === null ? "the Consulting team has proposed the price" : ""}
                {deal.price === null && deal.amount === null ? " and " : ""}
                {deal.amount === null ? "the fund has set the amount" : ""}.
              </p>
            ) : null}
            {deal.stage === "OPEN" && deal.mine ? (
              <p className="mt-2 text-paper">
                You signed version {deal.version}.
                {deal.unsigned.length > 0 ? ` Waiting for ${deal.unsigned.map((t) => teamLabel(t, track)).join(" and ")}.` : ""}
              </p>
            ) : null}
            {warning && deal.stage === "OPEN" ? <p className="mt-2 text-warn">{warning}</p> : null}
            {/* Mounted for as long as the terms can be signed, so the result of a signature stays on screen. */}
            {deal.stage === "OPEN" && deal.complete ? (
              <div className="mt-3">
                <ClosingActionButton
                  closesAt={deadlines.DEAL}
                  pause={pause}
                  variant="primary"
                  disabled={!deal.canSign}
                  action={signDeal.bind(null, deal.version)}
                  confirm={deal.canSign ? `Click again to sign ${dealTermsText(deal)}` : undefined}
                >
                  {deal.mine ? `Signed version ${deal.version}` : `Sign version ${deal.version}`}
                </ClosingActionButton>
              </div>
            ) : null}
          </div>
        ) : null}

        {(deal.canEditPrice || deal.canEditAmount) && postCrisis ? (
          <div>
            <h3 className="mb-2 font-semibold text-white">{deal.canEditPrice ? "Propose the price" : "Set the amount"}</h3>
            <DealTermForm
              action={deal.canEditPrice ? setDealPrice : setDealAmount}
              track={deal.canEditPrice ? "CONSULTING" : "FINANCE"}
              amount={deal.amount}
              price={deal.price}
              postCrisis={postCrisis}
              fundAvailable={fundAvailable}
              deadline={deadlines.DEAL ?? null}
              pause={pause}
            />
            <p className="mt-2 text-xs text-muted">
              Any change resets every signature, including those already given.
              {track === "FINANCE" && fundAvailable !== null ? ` Your available cash: ${money(fundAvailable)}.` : ""}
            </p>
          </div>
        ) : null}
        {deal.stage === "OPEN" && track === "PRODUCT" ? (
          <p className="text-xs text-muted">
            Your team signs; the Consulting team proposes the price and the fund sets the amount.
            {retained !== null ? ` Your retained shares: ${retained.toLocaleString("en-US")}.` : ""}
          </p>
        ) : null}
      </div>
    </Panel>
  );
}

function Term({ label, value, hint, testId }: { label: string; value: string; hint?: string; testId: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">
        {label}
        {hint ? <span className="text-muted"> · {hint}</span> : null}
      </dt>
      <dd className="font-mono font-semibold tabular-nums text-phosphor" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}

function OutcomeBadge({ value, yes, no, testId, yesTone = "green" }: { value: "YES" | "NO" | "OPEN"; yes: string; no: string; testId: string; yesTone?: "green" | "red" }) {
  return (
    <span data-testid={testId} data-value={value}>
      {value === "YES" ? <Badge tone={yesTone}>{yes}</Badge> : value === "NO" ? <Badge tone={yesTone === "green" ? "slate" : "green"}>{no}</Badge> : null}
    </span>
  );
}
