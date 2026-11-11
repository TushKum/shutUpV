// The advisor's fee: worth $10,000–$35,000 in cash and/or up to 3,000 retained shares at the IPO price, proposed by
// the Product or the Consulting team and confirmed by both (the same version); otherwise the default $22,500 cash at
// 01:05. The fund sees it read-only. Confirming takes two clicks: the second confirmation pays the fee for good.

import { RULES, type Track } from "@msim/engine";
import { clock, money } from "@/lib/format";
import { dollarsText, feeTermsText, teamLabel, upperFirst, type FeeView, type PauseState } from "@/lib/team/rescue";
import { Badge, Notice, Panel } from "@/components/ui/ui";
import { DoThis, HowItWorks } from "@/components/ui/how-it-works";
import { confirmFee, proposeFee } from "./actions";
import { ClosingActionButton, Due } from "./parts";
import { FeeForm } from "./terms-form";

export function FeePanel({
  fee,
  track,
  deadline,
  pause,
  ipoPrice,
  companyCash,
  retained,
}: {
  fee: FeeView;
  track: Track;
  deadline: string | null;
  pause: PauseState;
  ipoPrice: number | null;
  companyCash: number | null;
  retained: number | null;
}) {
  const p = fee.proposal;
  return (
    <Panel
      title="Advisor fee"
      actions={
        <span className="text-sm text-paper">
          Due <Due at={deadline} pause={pause} testId="fee-due" closed={fee.stage === "AGREED" ? "paid" : null} />
        </span>
      }
    >
      <div className="space-y-4 text-sm" data-testid="fee" data-stage={fee.stage}>
        <DoThis testId="fee-todo">
          {fee.party
            ? `Agree a fee of ${money(RULES.FEE_MIN)}–${money(RULES.FEE_MAX)} with your ${track === "PRODUCT" ? "Consulting" : "Product"} partner by ${deadline ? clock(deadline) : "01:05"}. If you don't, ${money(RULES.FEE_DEFAULT)} cash is paid automatically.`
            : "Your Product and Consulting partners agree this fee; you just watch."}
        </DoThis>
        <HowItWorks testId="fee-rules">
          <p>
            The fee is worth {money(RULES.FEE_MIN)} to {money(RULES.FEE_MAX)}, paid in cash and/or up to {RULES.FEE_MAX_SHARES.toLocaleString("en-US")} of the
            Product team&apos;s retained shares, valued at the IPO price{ipoPrice ? ` (${money(ipoPrice)})` : ""}.
          </p>
          <p>
            Either team proposes terms; both must confirm the same version by {deadline ? clock(deadline) : "01:05"}. A new proposal resets both
            confirmations. Without an agreed fee, the default {money(RULES.FEE_DEFAULT)} cash is paid.
          </p>
          {fee.party ? null : <p>The fund follows the fee here; it does not take part.</p>}
        </HowItWorks>

        {fee.stage === "BEFORE_CRISIS" ? <Notice>The fee can be proposed from the crisis.</Notice> : null}

        {fee.stage === "AGREED" && fee.executed ? (
          <Notice tone="green">
            <span data-testid="fee-outcome">
              Agreed fee paid at {clock(fee.executed.at, true)}: {feeTermsText(fee.executed)}, from the Product team to the Consulting team.
            </span>
          </Notice>
        ) : null}
        {fee.stage === "DEFAULT" && fee.executed ? (
          <Notice tone="amber">
            <span data-testid="fee-outcome">
              No fee was confirmed by both teams by the deadline: the default fee of {money(fee.executed.cash)} cash was paid to the Consulting team at{" "}
              {clock(fee.executed.at, true)}.
            </span>
          </Notice>
        ) : null}
        {fee.stage === "DEFAULT_PENDING" ? (
          <Notice tone="amber">
            <span data-testid="fee-outcome">
              The deadline has passed without a fee confirmed by both teams: the default fee of {money(RULES.FEE_DEFAULT)} cash is being paid.
            </span>
          </Notice>
        ) : null}

        {fee.stage === "OPEN" ? (
          <div className="rounded-md border border-line p-3" data-testid="fee-proposal">
            {p ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold text-phosphor">On the table: version {p.version}</h3>
                  <span className="text-xs text-muted">
                    Proposed by {teamLabel(p.by, track)} at {clock(p.at, true)}
                  </span>
                </div>
                <p className="mt-1 text-base text-phosphor" data-testid="fee-terms">
                  {feeTermsText(p)}
                </p>
                <ul className="mt-2 space-y-1" aria-label="Fee confirmations">
                  {(["PRODUCT", "CONSULTING"] as const).map((t) => (
                    <li key={t} data-testid={`fee-confirm-${t}`}>
                      {upperFirst(teamLabel(t, track))}:{" "}
                      {fee.confirmed[t] ? <Badge tone="green">Confirmed {clock(fee.confirmed[t], true)}</Badge> : <Badge tone="slate">Not confirmed</Badge>}
                    </li>
                  ))}
                </ul>
                {/* Mounted for as long as the proposal is open, so the result of a confirmation stays on screen. */}
                {fee.party ? (
                  <div className="mt-3">
                    <ClosingActionButton
                      closesAt={deadline}
                      pause={pause}
                      variant="primary"
                      disabled={!fee.canConfirm}
                      action={confirmFee.bind(null, p.version)}
                      confirm={fee.canConfirm ? `Click again to confirm ${feeTermsText(p)}` : undefined}
                    >
                      {fee.mine ? "Confirmed" : "Confirm this fee"}
                    </ClosingActionButton>
                  </div>
                ) : null}
                {fee.party && fee.mine ? (
                  <p className="mt-2 text-paper">
                    You confirmed version {p.version}.{fee.waitingFor ? ` Waiting for ${teamLabel(fee.waitingFor, track)} to confirm it.` : ""}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-paper">No fee has been proposed yet.</p>
            )}
          </div>
        ) : null}

        {fee.canPropose && ipoPrice ? (
          <div>
            <h3 className="mb-2 font-semibold text-phosphor">{p ? "Propose different terms" : "Propose a fee"}</h3>
            <FeeForm
              action={proposeFee}
              ipoPrice={ipoPrice}
              companyCash={companyCash}
              retained={retained}
              initial={p ? { cash: p.cash > 0 ? dollarsText(p.cash) : "", shares: p.shares > 0 ? String(p.shares) : "" } : { cash: "", shares: "" }}
              current={p ? { cash: p.cash, shares: p.shares } : null}
              deadline={deadline}
              pause={pause}
            />
            <p className="mt-2 text-xs text-muted">
              {companyCash === null
                ? "The company's cash and retained shares are checked when you propose, and again when the fee is paid."
                : `Your company has ${money(companyCash)} cash${retained !== null ? ` and ${retained.toLocaleString("en-US")} retained shares` : ""}.`}
            </p>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}
