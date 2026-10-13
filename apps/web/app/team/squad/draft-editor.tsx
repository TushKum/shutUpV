"use client";

// The squad's draft of one submission (pitch card, rescue plan or flash answer), edited from several screens: the
// template's fields with a word counter per field and in total, Save (one click: a draft can be changed until the
// deadline) and Submit (two clicks: it replaces the version that will be judged). Every save names the version it
// was based on. A version saved elsewhere meanwhile is merged section by section with what was typed here: the other
// team's sections are taken, the typed text stays, and a section both changed asks which text to keep (see
// lib/team/editor.ts). The form hard-closes at the deadline by the server clock; the database refuses late saves anyway.

import { useEffect, useId, useReducer, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { TEMPLATES, type SubmissionType } from "@msim/engine";
import { clock } from "@/lib/format";
import { useServerNow } from "@/lib/live/clock";
import {
  MAX_CONTENT_CHARS,
  afterResult,
  backupOf,
  closedView,
  contentChars,
  draftPayload,
  editorReducer,
  fieldSpecs,
  fieldsOf,
  initEditor,
  isDirty,
  parseBackup,
  rowsFor,
  sameFields,
  sectionNames,
  submitProblem,
  theirText,
  wordStats,
  type DraftSnapshot,
  type EditorNotice,
  type Fields,
} from "@/lib/team/editor";
import { SUBMISSION_LABELS, deadlinePassed, otherSaver, roleOf, whoLabel, type SquadTeams } from "@/lib/team/squad";
import { useCarryOver } from "@/lib/live/feedback";
import { ActionButton, ResultMessage } from "@/components/ui/action";
import { safely } from "@/components/ui/action-helpers";
import { Badge, Notice, buttonClass, inputClass } from "@/components/ui/ui";
import { saveDraft, submitDraft, type DraftResult } from "./actions";

export interface DraftEditorProps {
  type: SubmissionType;
  /** The latest saved version, as the page read it. */
  draft: DraftSnapshot;
  /** The window is open and this team writes this submission (judged by the server at render time). */
  editable: boolean;
  /** Why the editor is read-only, when it is. */
  closedNote: string;
  deadline: string | null;
  paused: boolean;
  pausedAt: string | null;
  squad: SquadTeams;
  me: string;
  /** Where this tab keeps unsaved text (sessionStorage). */
  storageKey: string;
  /** The submitted version that will be judged, if any. */
  submitted: { content: Record<string, unknown>; submittedAt: string } | null;
}

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
  const { type, draft, editable, deadline, squad, me, storageKey } = props;
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
  // A submit in flight (it saves first): Save waits for it, so the two never race each other's version.
  const [submitting, setSubmitting] = useState(false);
  const [saveResult, setSaveResult] = useState<DraftResult | null>(null);
  // A save's answer outlives the editor (the deadline closes it, the page moves on): the page's feedback bar shows it.
  useCarryOver(saveResult);
  const payload = draftPayload(type, state.fields);
  const choosing = state.conflicts.length > 0;
  const save = () => {
    if (!live || !dirty || choosing || pending || submitting) return;
    const sent = payload;
    const base = state.base.version;
    dispatch({ type: "saving", fields: sent });
    start(async () => {
      const r = (await safely(() => saveDraft(type, sent, base))) as DraftResult;
      dispatch(afterResult(r));
      setSaveResult(r);
      router.refresh();
    });
  };
  const submit = async () => {
    const sent = dirty ? payload : null;
    if (sent) dispatch({ type: "saving", fields: sent });
    setSubmitting(true);
    try {
      const r = (await safely(() => submitDraft(type, sent, state.base.version))) as DraftResult;
      dispatch(afterResult(r, "submit"));
      setSaveResult(null);
      return r;
    } finally {
      setSubmitting(false);
    }
  };

  // Open: the text on screen, based on a saved version. Closed: the latest saved version, and apart from it any text
  // typed here that was never saved.
  const closed = live ? null : closedView(state);
  const fields = closed ? closed.fields : state.fields;
  const version = closed ? closed.shown : state.base;
  const stats = wordStats(type, fields);
  const problem = submitProblem(type, fields);
  const tooBig = contentChars(payload) > MAX_CONTENT_CHARS;
  const isSubmitted = !!props.submitted && sameFields(type, fieldsOf(type, props.submitted.content), fields);
  const ticker = fields.ticker ?? "";
  const confirm = `Click again to ${dirty ? "save and " : ""}submit ${words(stats.total)}${type === "PITCH" && ticker ? ` as ${ticker}` : ""}`;
  const who = (teamId: string | null) => whoLabel(squad, me, teamId);
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
        savedBy={who(state.base.updatedBy)}
        onKeep={() => dispatch({ type: "keepMine", keys: [key] })}
        onUseTheirs={() => dispatch({ type: "useTheirs", keys: [key] })}
      />
    ) : null;

  // Whose changes a merge brought in: "the Product team's changes", or another screen's of this team.
  const theirChanges = (teamId: string | null) =>
    teamId === me ? "the changes from your team's other screen" : roleOf(squad, teamId) ? `the ${who(teamId)} team's changes` : "the changes from another screen";
  const noticeText = (n: EditorNotice): string => {
    switch (n.kind) {
      case "updated":
        return `Updated to version ${n.draft.version}, saved by ${who(n.draft.updatedBy)} at ${clock(n.draft.updatedAt, true)}.`;
      case "refused": {
        const saver = otherSaver(squad, me, n.draft.updatedBy);
        return `Not ${n.action === "submit" ? "submitted" : "saved"}: ${saver.charAt(0).toLowerCase()}${saver.slice(1)} saved version ${n.draft.version}, which is shown now. Check it, then ${n.action}.`;
      }
      case "merged":
        return `Merged ${theirChanges(n.draft.updatedBy)} to ${sectionNames(type, n.keys)} (version ${n.draft.version}, saved at ${clock(n.draft.updatedAt, true)}).${dirty ? " Your own changes are still here, not saved yet." : ""}`;
      case "kept":
        return `You kept your text in ${sectionNames(type, n.keys)}: your next save replaces their text there.`;
      case "restored":
        return `Restored the unsaved text you typed on this device. Save it to keep it.${n.merged.length > 0 ? ` The changes saved since to ${sectionNames(type, n.merged)} are merged in.` : ""}`;
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
            Version {version.version} · saved by <strong className="text-slate-900">{who(version.updatedBy)}</strong> at{" "}
            <span className="font-mono">{clock(version.updatedAt, true)}</span>
          </span>
        ) : (
          <span>Not saved yet.</span>
        )}
        {dirty && live ? <Badge tone="amber">Unsaved changes</Badge> : null}
      </p>

      {!live ? (
        <Notice tone={editable ? "amber" : "slate"}>
          <span data-testid="draft-closed">{editable ? `The ${SUBMISSION_LABELS[type].toLowerCase()} closed at ${clock(deadline, true)}.` : props.closedNote}</span>
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
          <p className="font-semibold">
            {otherSaver(squad, me, state.base.updatedBy)} saved version {state.base.version} at {clock(state.base.updatedAt, true)} while you were
            editing.
          </p>
          <p className="mt-1">
            You both changed {sectionNames(type, state.conflicts)}: choose which text to keep{state.conflicts.length > 1 ? " in each" : ""} below. Your text
            is still there and has not been saved; Save waits for your choice.
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
              : `Unsaved text from this device was found. It was based on version ${state.stash.basedOn}; the saved draft is now version ${state.base.version}.`}
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

      {type === "PITCH" ? (
        <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
          <div>
            <label htmlFor={`${uid}-company_name`} className="text-sm font-semibold text-slate-800">
              Company name
            </label>
            <input
              id={`${uid}-company_name`}
              value={fields.company_name ?? ""}
              onChange={(e) => dispatch({ type: "edit", key: "company_name", value: e.target.value })}
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
            The ticker is 3 or 4 capital letters and must be unique; it is claimed when you submit. The name and ticker are not counted in the word limit.
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
              readOnly={!live}
              rows={rowsFor(text, type === "FLASH" ? 5 : 3)}
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

      {props.submitted ? (
        isSubmitted ? (
          <p className="text-sm text-emerald-800" data-testid="submitted-state">
            This text is the submitted version (submitted at {clock(props.submitted.submittedAt, true)}).
          </p>
        ) : (
          <p className="text-sm text-amber-800" data-testid="submitted-state">
            This text differs from the version submitted at {clock(props.submitted.submittedAt, true)}. Only the submitted version is judged
            {live ? ": submit again to replace it." : "."}
          </p>
        )
      ) : live ? (
        <p className="text-sm text-slate-600" data-testid="submitted-state">
          Not submitted yet. Only a submitted version is judged; you can submit again until the deadline.
        </p>
      ) : null}

      {live ? (
        <div>
          {problem ? (
            <p className="mb-2 text-sm text-slate-700" data-testid="submit-problem">
              Cannot submit yet: {problem.message}
            </p>
          ) : null}
          <div className="flex flex-wrap items-start gap-2">
            <button type="submit" disabled={!dirty || choosing || pending || submitting} className={buttonClass.secondary}>
              {pending ? "Saving…" : dirty ? "Save draft" : "Saved"}
            </button>
            <ActionButton
              variant="primary"
              action={submit}
              confirm={confirm}
              disabled={choosing || pending || submitting || problem !== null || (isSubmitted && !dirty)}
            >
              {isSubmitted && !dirty ? "Submitted" : dirty ? "Save and submit" : "Submit"}
            </ActionButton>
          </div>
          <ResultMessage result={saveResult} />
        </div>
      ) : null}
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
  savedBy: string;
  onKeep: () => void;
  onUseTheirs: () => void;
}) {
  const text = (t: string) => (t.trim() === "" ? <span className="text-slate-400">— (empty)</span> : t);
  return (
    <div id={props.id} className="mt-2 rounded-md bg-amber-50 p-3 sm:col-span-2 text-sm text-amber-950 ring-1 ring-inset ring-amber-200" data-testid={props.testId}>
      <p className="font-semibold">{props.label} was changed here and in version {props.version}: which text do you keep?</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <div className="min-w-0 rounded bg-white p-2 ring-1 ring-inset ring-amber-200" data-testid="conflict-mine">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Your text (not saved)</p>
          <p className="mt-1 whitespace-pre-wrap break-words text-slate-900">{text(props.mine)}</p>
        </div>
        <div className="min-w-0 rounded bg-white p-2 ring-1 ring-inset ring-amber-200" data-testid="conflict-theirs">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Their text (version {props.version}, saved by {props.savedBy})
          </p>
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
      <p className="mt-1 text-xs">Keep my text: your next save replaces theirs in this section. Use their text: yours is set aside, so you can put it back.</p>
    </div>
  );
}
