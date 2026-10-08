"use client";

// The correction request: a reason and one or more entries (team, optional company and lot, cash change in dollars,
// share change). The exchange takes the other side of every entry. Rows can be added and removed; blank rows are
// ignored. The dollars are converted to cents on the server, exactly, from the text. A refused request keeps what was
// typed (the form is submitted by hand, so React does not reset it); a request that is accepted clears the form.

import { startTransition, useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { TRACK_LABELS, type Track } from "@msim/engine";
import type { ActionResult } from "@/lib/rpc";
import { MAX_ENTRIES } from "@/lib/admin/ledger-corrections";
import { ResultMessage } from "@/components/ui/action";
import { buttonClass, inputClass } from "@/components/ui/ui";

export interface RequestOptions {
  tracks: { track: Track; teams: { id: string; code: string }[] }[];
  companies: { id: string; label: string }[];
  lots: string[];
}

interface RequestState {
  result: ActionResult | null;
  accepted: number;
}


export function RequestCorrectionForm({
  action,
  options,
}: {
  action: (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;
  options: RequestOptions;
}) {
  const router = useRouter();
  // `accepted` counts accepted requests: it is the form's key, so only an accepted request clears the fields.
  const [{ result, accepted }, dispatch, pending] = useActionState<RequestState, FormData>(
    async (prev, form) => {
      const r = await action(prev.result, form);
      router.refresh();
      return { result: r, accepted: prev.accepted + (r.ok ? 1 : 0) };
    },
    { result: null, accepted: 0 },
  );
  return (
    <form
      className="space-y-4"
      key={accepted}
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        startTransition(() => dispatch(form));
      }}
    >
      <label className="block">
        <span className="text-xs font-medium text-slate-600">Reason (at least 10 characters)</span>
        <textarea name="reason" required rows={2} maxLength={1000} className={inputClass} />
      </label>
      <Entries options={options} />
      <div>
        <button type="submit" disabled={pending} className={buttonClass.primary}>
          {pending ? "Working…" : "Request correction"}
        </button>
      </div>
      <ResultMessage result={result} />
    </form>
  );
}

function Entries({ options }: { options: RequestOptions }) {
  const [rows, setRows] = useState({ keys: [0], next: 1 });
  const add = () => setRows((r) => (r.keys.length >= MAX_ENTRIES ? r : { keys: [...r.keys, r.next], next: r.next + 1 }));
  const remove = (key: number) => setRows((r) => ({ ...r, keys: r.keys.filter((k) => k !== key) }));
  return (
    <div className="space-y-3">
      {rows.keys.map((key, i) => (
        <fieldset key={key} className="rounded-md border border-slate-200 p-3">
          <legend className="px-1 text-xs font-semibold text-slate-700">Entry {i + 1}</legend>
          <div className="grid gap-2 sm:grid-cols-5">
            <label className="block">
              <span className="text-xs font-medium text-slate-600">Team</span>
              <select name="entry_team" defaultValue="" className={inputClass}>
                <option value="">—</option>
                {options.tracks.map((t) => (
                  <optgroup key={t.track} label={TRACK_LABELS[t.track]}>
                    {t.teams.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.code}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">Company (optional)</span>
              <select name="entry_company" defaultValue="" className={inputClass}>
                <option value="">None</option>
                {options.companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">Lot</span>
              <select name="entry_lot" defaultValue="" className={inputClass}>
                <option value="">None</option>
                {options.lots.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">Cash change ($)</span>
              <input name="entry_cash" inputMode="decimal" autoComplete="off" placeholder="e.g. 12.34 or -0.50" className={`${inputClass} font-mono`} />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">Share change</span>
              <input name="entry_shares" inputMode="numeric" autoComplete="off" placeholder="e.g. 100 or -100" className={`${inputClass} font-mono`} />
            </label>
          </div>
          {rows.keys.length > 1 ? (
            <button type="button" onClick={() => remove(key)} className="mt-2 text-xs font-medium text-red-700 hover:underline">
              Remove entry {i + 1}
            </button>
          ) : null}
        </fieldset>
      ))}
      <button type="button" onClick={add} disabled={rows.keys.length >= MAX_ENTRIES} className={buttonClass.secondary}>
        Add entry
      </button>
      <p className="text-xs text-slate-500">
        Each entry moves cash or shares between the team and the exchange, which takes the other side. A share change needs a company and a lot
        (RETAINED: the company&apos;s Product team; FEE: a consultant; SQUAD, EXCHANGE, SHORT: a fund). For a SHORT lot, a positive change means
        more shares short.
      </p>
    </div>
  );
}
