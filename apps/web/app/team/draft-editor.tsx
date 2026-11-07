"use client";

// The team's draft (the PRD or the crisis solution), edited from several screens at once: the template's parts with a
// word counter per part and in total, and autosave (a moment after typing stops, when a part loses focus, and just
// before the lock). There is no Submit: the last version saved before the lock is the one judged. Every save names the
// version it was based on. A version saved on another screen meanwhile is merged part by part with what was typed here:
// the other screen's parts are taken, the typed text stays, and a part both changed asks which text to keep (see
// lib/team/editor.ts). The form hard-closes at the lock by the server clock; the database refuses late saves anyway.

import { useEffect, useId, useReducer, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SUBMISSION_LABELS, TEMPLATES, type SubmissionType } from "@msim/engine";
import { clock } from "@/lib/format";
import { useServerNow } from "@/lib/live/clock";
import {
  AUTOSAVE_MS,
  MAX_CONTENT_CHARS,
  afterResult,
  backupOf,
  closedView,
  contentChars,
  draftPayload,
  editorReducer,
  fieldSpecs,
  initEditor,
  isDirty,
  parseBackup,
  rowsFor,
  saveProblem,
  sectionNames,
  theirText,
  tickerNote,
  wordStats,
  type DraftSnapshot,
  type EditorNotice,
  type Fields,
} from "@/lib/team/editor";
import { deadlinePassed } from "@/lib/team/time";
import { useCarryOver } from "@/lib/live/feedback";
import { ResultMessage } from "@/components/ui/action";
import { safely } from "@/components/ui/action-helpers";
import { Badge, Notice, buttonClass, inputClass } from "@/components/ui/ui";
import { saveDraft, type DraftResult } from "./write-actions";

export interface DraftEditorProps {
  type: SubmissionType;
  /** The latest saved version, as the page read it. */
  draft: DraftSnapshot;
  /** The window is open (judged by the server at render time). */
  editable: boolean;
  /** Why the editor is read-only, when it is. */
  closedNote: string;
  /** The lock (23:00 for the PRD, 01:45 for the solution). */
  deadline: string | null;
  paused: boolean;
  pausedAt: string | null;
  /** Where this tab keeps unsaved text (sessionStorage). */
  storageKey: string;
}

/** Saved this long before the lock at the latest, whatever the autosave timer says. */
const LAST_CALL_MS = 15_000;

const noSubscribe = () => () => {};
function readStorage(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

const words = (n: number) => `${n.toLocaleString("en-US")} ${n === 1 ? "word" : "words"}`;

export function DraftEditor(props: DraftEditorProps) {
  const { type, draft, editable, deadline, storageKey } = props;
  const router = useRouter();
  const uid = useId();
  const [state, dispatch] = useReducer(editorReducer, undefined, () => initEditor(type, draft));

  // A page refresh brings the latest saved version: shown at once if nothing was typed here, merged otherwise.
  const [seen, setSeen] = useState(draft.version);
  if (seen !== draft.version) {
    setSeen(draft.version);
    dispatch({ type: "server", draft });
  }

  // Hard close at the deadline, by the server clock (frozen while the event is paused).
  const now = useServerNow(1000);
  const live = editable && !deadlinePassed(deadline, now, { paused: props.paused, pausedAt: props.pausedAt });

  // This tab's backup of unsaved text, looked at once in the browser (after hydration).
  const inBrowser = useSyncExternalStore(noSubscribe, () => true, () => false);
  const rawBackup = useSyncExternalStore(noSubscribe, () => readStorage(storageKey), () => null);
  if (inBrowser && !state.backupChecked) dispatch({ type: "backup", backup: parseBackup(type, rawBackup), editable: live });

  const dirty = isDirty(state);
  useEffect(() => {
    if (!state.backupChecked) return;
    try {
      const b = live ? backupOf(state) : null;
      if (b) window.sessionStorage.setItem(storageKey, JSON.stringify(b));
      else window.sessionStorage.removeItem(storageKey);
    } catch {
      // No storage (private mode): the backup is only a convenience.
    }
  }, [state, live, storageKey]);
  useEffect(() => {
    if (!dirty || !live) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, live]);

  const [pending, start] = useTransition();
  const [saveResult, setSaveResult] = useState<DraftResult | null>(null);
  // A save's answer outlives the editor: if the editor goes away (the lock closed it, the page moved on) before the
  // answer comes back or just after it is shown, the page's feedback bar shows it.
  const deliver = useCarryOver(saveResult);
  const payload = draftPayload(type, state.fields);
  const choosing = state.conflicts.length > 0;
  const problem = saveProblem(type, state.fields);
  const tooBig = contentChars(payload) > MAX_CONTENT_CHARS;
  const canSave = live && dirty && !choosing && !pending && !problem && !tooBig;
  const save = () => {
    if (!canSave) return;
    const sent = payload;
    const base = state.base.version;
    dispatch({ type: "saving", fields: sent });
    start(async () => {
      const r = (await safely(() => saveDraft(type, sent, base))) as DraftResult;
      deliver(r);
      dispatch(afterResult(r));
      // Autosave is quiet when it works; a refusal (a ticker taken, the lock) is shown.
      setSaveResult(r.ok ? null : r);
      router.refresh();
    });
  };
  // Autosave: a moment after the last keystroke, and at once in the last seconds before the lock. The timer calls the
  // latest save (a ref), never one from an older render.
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });
  const lockIn = deadline ? new Date(deadline).getTime() - now : Infinity;
  const lastCall = lockIn <= LAST_CALL_MS;
  useEffect(() => {
    if (!canSave) return;
    const id = window.setTimeout(() => saveRef.current(), lastCall ? 0 : AUTOSAVE_MS);
    return () => window.clearTimeout(id);
  }, [canSave, state.fields, lastCall]);

  // Open: the text on screen, based on a saved version. Closed: the latest saved version, and apart from it any text
  // typed here that was never saved.
  const closed = live ? null : closedView(state);
  const fields = closed ? closed.fields : state.fields;
  const version = closed ? closed.shown : state.base;
  const stats = wordStats(type, fields);
  const ticker = fields.ticker ?? "";
  const note = live ? tickerNote(type, fields) : null;
  const fieldClass = (readOnly: boolean, conflict = false) =>
    `${inputClass} ${readOnly ? "bg-slate-50 text-slate-700" : ""} ${conflict ? "border-amber-400 ring-2 ring-amber-200" : ""}`;
  const inConflict = (key: string) => live && state.conflicts.includes(key);
  const describedBy = (key: string, ...ids: string[]) => [...ids, inConflict(key) ? `${uid}-${key}-conflict` : ""].filter(Boolean).join(" ") || undefined;
  const conflictFor = (key: string, label: string) =>
    inConflict(key) ? (
      <ConflictChoice
        id={`${uid}-${key}-conflict`}
        testId={`conflict-${key}`}
        label={label}
        mine={state.fields[key] ?? ""}
        theirs={theirText(state, key)}
        version={state.base.version}
        onKeep={() => dispatch({ type: "keepMine", keys: [key] })}
        onUseTheirs={() => dispatch({ type: "useTheirs", keys: [key] })}
      />
    ) : null;

  const noticeText = (n: EditorNotice): string => {
    switch (n.kind) {
      case "updated":
        return `Updated to the version saved on another screen at ${clock(n.draft.updatedAt, true)}.`;
      case "refused":
        return "Not saved: another screen of your team saved a newer version, which is shown now. Check it; your next change saves again.";
      case "merged":
        return `Merged another screen's changes to ${sectionNames(type, n.keys)} (saved at ${clock(n.draft.updatedAt, true)}).${dirty ? " Your own changes are still here, saving in a moment." : ""}`;
      case "kept":
        return `You kept your text in ${sectionNames(type, n.keys)}: the next save replaces the other screen's text there.`;
      case "restored":
        return `Restored the unsaved text you typed on this device.${n.merged.length > 0 ? ` The changes saved since to ${sectionNames(type, n.merged)} are merged in.` : ""}`;
    }
  };

  return (
    <form
      className="space-y-4"
      aria-label={`${SUBMISSION_LABELS[type]} editor`}
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <p className="flex flex-wrap items-center gap-2 text-sm text-slate-600" data-testid="draft-version">
        {version.version > 0 ? (
          <span>
            Saved at <span className="font-mono">{clock(version.updatedAt, true)}</span> (version {version.version})
          </span>
        ) : (
          <span>Nothing saved yet.</span>
        )}
        {live ? (
          pending ? (
            <Badge tone="blue">Saving…</Badge>
          ) : choosing ? (
            <Badge tone="amber">Choose below, then it saves</Badge>
          ) : problem || tooBig ? (
            <Badge tone="red">Not saving: see below</Badge>
          ) : dirty ? (
            <Badge tone="amber">Saving in a moment…</Badge>
          ) : version.version > 0 ? (
            <Badge tone="green">All changes saved</Badge>
          ) : null
        ) : null}
      </p>

      {!live ? (
        <Notice tone={editable ? "amber" : "slate"}>
          <span data-testid="draft-closed">
            {editable ? `The ${SUBMISSION_LABELS[type].toLowerCase()} locked at ${clock(deadline, true)}: the version saved before then is the one judged.` : props.closedNote}
          </span>
        </Notice>
      ) : null}

      {closed?.unsaved ? (
        <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-950 ring-1 ring-inset ring-amber-200" data-testid="draft-unsaved">
          <p className="font-semibold">Not saved: the text below was typed on this screen but never saved, so it is not part of the draft.</p>
          <details className="mt-2">
            <summary className="cursor-pointer font-medium">See the unsaved text</summary>
            <FieldsText type={type} fields={closed.unsaved} />
          </details>
        </div>
      ) : null}

      {live && choosing ? (
        <div role="alert" className="rounded-md bg-amber-50 p-3 text-sm text-amber-950 ring-1 ring-inset ring-amber-200" data-testid="draft-conflict">
          <p className="font-semibold">Another screen of your team saved at {clock(state.base.updatedAt, true)} while you were typing.</p>
          <p className="mt-1">
            You both changed {sectionNames(type, state.conflicts)}: choose which text to keep{state.conflicts.length > 1 ? " in each" : ""} below. Your text
            is still there and has not been saved; saving waits for your choice.
          </p>
          {state.conflicts.length > 1 ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className={buttonClass.secondary} onClick={() => dispatch({ type: "keepMine" })}>
                Keep my text in all {state.conflicts.length}
              </button>
              <button type="button" className={buttonClass.secondary} onClick={() => dispatch({ type: "useTheirs" })}>
                Use their text in all {state.conflicts.length}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {state.stash ? (
        <div className="rounded-md bg-slate-50 p-3 text-sm ring-1 ring-inset ring-slate-200" data-testid="draft-stash">
          <p className="font-semibold text-slate-900">
            {state.stash.why === "loaded"
              ? `You chose their text in ${sectionNames(type, Object.keys(state.stash.fields))}. Your text there is set aside here.`
              : "Unsaved text from this device was found; the draft has been saved elsewhere since."}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {live ? (
              <button type="button" className={buttonClass.secondary} onClick={() => dispatch({ type: "restoreStash" })}>
                Put my text back
              </button>
            ) : null}
            <button type="button" className={buttonClass.secondary} onClick={() => dispatch({ type: "dropStash" })}>
              Discard it
            </button>
          </div>
          <details className="mt-2" open>
            <summary className="cursor-pointer font-medium">Your set-aside text</summary>
            <FieldsText type={type} fields={state.stash.fields} only={Object.keys(state.stash.fields)} />
          </details>
        </div>
      ) : null}

      {state.notice && (live || state.notice.kind === "updated") ? (
        <div role="status" className="flex flex-wrap items-start justify-between gap-2 rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-900 ring-1 ring-inset ring-sky-200">
          <span>{noticeText(state.notice)}</span>
          <button type="button" className="text-xs font-semibold underline" onClick={() => dispatch({ type: "dismissNotice" })}>
            Dismiss
          </button>
        </div>
      ) : null}

      {type === "PRD" ? (
        <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
          <div>
            <label htmlFor={`${uid}-company_name`} className="text-sm font-semibold text-slate-800">
              Company name
            </label>
            <input
              id={`${uid}-company_name`}
              value={fields.company_name ?? ""}
              onChange={(e) => dispatch({ type: "edit", key: "company_name", value: e.target.value })}
              onBlur={() => saveRef.current()}
              readOnly={!live}
              maxLength={60}
              autoComplete="off"
              aria-describedby={describedBy("company_name")}
              className={fieldClass(!live, inConflict("company_name"))}
            />
          </div>
          <div>
            <label htmlFor={`${uid}-ticker`} className="text-sm font-semibold text-slate-800">
              Ticker
            </label>
            <input
              id={`${uid}-ticker`}
              value={ticker}
              onChange={(e) => dispatch({ type: "edit", key: "ticker", value: e.target.value })}
              onBlur={() => saveRef.current()}
              readOnly={!live}
              maxLength={4}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              aria-describedby={describedBy("ticker", `${uid}-ticker-hint`)}
              className={`${fieldClass(!live, inConflict("ticker"))} font-mono uppercase`}
            />
          </div>
          <p id={`${uid}-ticker-hint`} className="text-xs text-slate-500 sm:col-span-2">
            {note ?? "Four capital letters, unique: it is claimed by the first team to save it."} The name and ticker are not counted in the word limit.
          </p>
          {conflictFor("company_name", "Company name")}
          {conflictFor("ticker", "Ticker")}
        </div>
      ) : null}

      {TEMPLATES[type].map((f) => {
        const id = `${uid}-${f.key}`;
        const n = stats.perField[f.key] ?? 0;
        const text = fields[f.key] ?? "";
        return (
          <div key={f.key}>
            <div className="flex items-baseline justify-between gap-2">
              <label htmlFor={id} className="text-sm font-semibold text-slate-800">
                {f.label}
              </label>
              <span id={`${id}-words`} className="text-xs tabular-nums text-slate-500" data-testid={`words-${f.key}`}>
                {words(n)}
              </span>
            </div>
            <textarea
              id={id}
              value={text}
              onChange={(e) => dispatch({ type: "edit", key: f.key, value: e.target.value })}
              onBlur={() => saveRef.current()}
              readOnly={!live}
              rows={rowsFor(text, 3)}
              aria-describedby={describedBy(f.key, `${id}-words`)}
              className={`${fieldClass(!live, inConflict(f.key))} resize-y`}
            />
            {conflictFor(f.key, f.label)}
          </div>
        );
      })}

      <div className="rounded-md bg-slate-50 px-3 py-2 text-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span data-testid="word-total" className={`font-semibold tabular-nums ${stats.over > 0 ? "text-red-700" : "text-slate-900"}`}>
            {stats.total.toLocaleString("en-US")} / {stats.limit.toLocaleString("en-US")} words
          </span>
          {stats.over > 0 ? <span className="font-medium text-red-700">{words(stats.over)} over the limit</span> : null}
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded bg-slate-200" aria-hidden>
          <div className={`h-full ${stats.over > 0 ? "bg-red-600" : "bg-slate-700"}`} style={{ width: `${Math.min(100, (stats.total / stats.limit) * 100)}%` }} />
        </div>
      </div>

      {tooBig && live ? <Notice tone="red">This draft is too long to save (the limit is {MAX_CONTENT_CHARS.toLocaleString("en-US")} characters).</Notice> : null}

      {live && problem ? (
        <Notice tone="red">
          <span data-testid="save-problem">Not saved: {problem.message}</span>
        </Notice>
      ) : null}

      {live ? (
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={!canSave} className={buttonClass.secondary}>
            {pending ? "Saving…" : dirty ? "Save now" : "Saved"}
          </button>
          <p className="text-xs text-slate-500">Saves on its own as you type. The version saved before {clock(deadline)} is the one judged; there is no submit button.</p>
        </div>
      ) : null}
      <ResultMessage result={saveResult} />
    </form>
  );
}

/** Text shown read-only, field by field (the unsaved text, or the set-aside sections when `only` names them). */
function FieldsText({ type, fields, only }: { type: SubmissionType; fields: Fields; only?: string[] }) {
  return (
    <dl className="mt-2 space-y-2">
      {fieldSpecs(type)
        .filter((f) => !only || only.includes(f.key))
        .map((f) => (
          <div key={f.key}>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{f.label}</dt>
            <dd className="whitespace-pre-wrap break-words text-slate-900">
              {(fields[f.key] ?? "").trim() === "" ? <span className="text-slate-400">—</span> : fields[f.key]}
            </dd>
          </div>
        ))}
    </dl>
  );
}

/**
 * A section changed here and, differently, in the saved version: both texts side by side (stacked on a phone), and
 * the choice. Keeping mine replaces theirs in this section only at the next save; using theirs sets mine aside.
 */
function ConflictChoice(props: {
  id: string;
  testId: string;
  label: string;
  mine: string;
  theirs: string;
  version: number;
  onKeep: () => void;
  onUseTheirs: () => void;
}) {
  const text = (t: string) => (t.trim() === "" ? <span className="text-slate-400">— (empty)</span> : t);
  return (
    <div id={props.id} className="mt-2 rounded-md bg-amber-50 p-3 sm:col-span-2 text-sm text-amber-950 ring-1 ring-inset ring-amber-200" data-testid={props.testId}>
      <p className="font-semibold">{props.label} was changed here and on another screen: which text do you keep?</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <div className="min-w-0 rounded bg-white p-2 ring-1 ring-inset ring-amber-200" data-testid="conflict-mine">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Your text (not saved)</p>
          <p className="mt-1 whitespace-pre-wrap break-words text-slate-900">{text(props.mine)}</p>
        </div>
        <div className="min-w-0 rounded bg-white p-2 ring-1 ring-inset ring-amber-200" data-testid="conflict-theirs">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Their text (saved on another screen)</p>
          <p className="mt-1 whitespace-pre-wrap break-words text-slate-900">{text(props.theirs)}</p>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className={buttonClass.secondary} onClick={props.onKeep}>
          Keep my text
        </button>
        <button type="button" className={buttonClass.secondary} onClick={props.onUseTheirs}>
          Use their text
        </button>
      </div>
      <p className="mt-1 text-xs">Keep my text: the next save replaces theirs in this part. Use their text: yours is set aside, so you can put it back.</p>
    </div>
  );
}
