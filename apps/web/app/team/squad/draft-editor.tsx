"use client";

// The squad's draft of one submission (pitch card, rescue plan or flash answer), edited from several screens: the
// template's fields with a word counter per field and in total, Save (one click: a draft can be changed until the
// deadline) and Submit (two clicks: it replaces the version that will be judged). Every save names the version it
// was based on; a version saved elsewhere meanwhile never overwrites what was typed here (see lib/team/editor.ts).
// The form hard-closes at the deadline by the server clock; the database refuses late saves anyway.

import { useEffect, useId, useReducer, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { TEMPLATES, type SubmissionType } from "@msim/engine";
import { clock } from "@/lib/format";
import { useServerNow } from "@/lib/live/clock";
import {
  MAX_CONTENT_CHARS,
  backupOf,
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
  submitProblem,
  wordStats,
  type DraftSnapshot,
  type Fields,
} from "@/lib/team/editor";
import { SUBMISSION_LABELS, deadlinePassed, otherSaver, whoLabel, type SquadTeams } from "@/lib/team/squad";
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

  // A page refresh brings the latest saved version: shown at once if nothing was typed here, offered otherwise.
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
  const handle = (r: DraftResult) => {
    if (r.ok && r.draft) dispatch({ type: "saved", draft: r.draft });
    else if (r.code === "VERSION_CONFLICT" && r.draft) dispatch({ type: "conflict", draft: r.draft });
    else dispatch({ type: "failed" });
  };
  const payload = draftPayload(type, state.fields);
  const save = () => {
    if (!live || !dirty || state.theirs || pending) return;
    const sent = payload;
    const base = state.base.version;
    dispatch({ type: "saving", fields: sent });
    start(async () => {
      const r = (await safely(() => saveDraft(type, sent, base))) as DraftResult;
      handle(r);
      setSaveResult(r);
      router.refresh();
    });
  };
  const submit = async () => {
    const sent = dirty ? payload : null;
    if (sent) dispatch({ type: "saving", fields: sent });
    const r = (await safely(() => submitDraft(type, sent, state.base.version))) as DraftResult;
    handle(r);
    setSaveResult(null);
    return r;
  };

  const stats = wordStats(type, state.fields);
  const problem = submitProblem(type, state.fields);
  const tooBig = contentChars(payload) > MAX_CONTENT_CHARS;
  const isSubmitted = !!props.submitted && sameFields(type, fieldsOf(type, props.submitted.content), state.fields);
  const ticker = state.fields.ticker ?? "";
  const confirm = `Click again to ${dirty ? "save and " : ""}submit ${words(stats.total)}${type === "PITCH" && ticker ? ` as ${ticker}` : ""}`;
  const who = (teamId: string | null) => whoLabel(squad, me, teamId);
  const fieldClass = (readOnly: boolean) => `${inputClass} ${readOnly ? "bg-slate-50 text-slate-700" : ""}`;

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
        {state.base.version > 0 ? (
          <span>
            Version {state.base.version} · saved by <strong className="text-slate-900">{who(state.base.updatedBy)}</strong> at{" "}
            <span className="font-mono">{clock(state.base.updatedAt, true)}</span>
          </span>
        ) : (
          <span>Not saved yet.</span>
        )}
        {dirty && live ? <Badge tone="amber">Unsaved changes</Badge> : null}
      </p>

      {!live ? (
        <Notice tone={editable ? "amber" : "slate"}>
          {editable ? `${SUBMISSION_LABELS[type]} closed at ${clock(deadline, true)}.` : props.closedNote}
          {dirty && editable ? " Your unsaved changes were not saved." : ""}
        </Notice>
      ) : null}

      {state.theirs ? (
        <div role="alert" className="rounded-md bg-amber-50 p-3 text-sm text-amber-950 ring-1 ring-inset ring-amber-200" data-testid="draft-conflict">
          <p className="font-semibold">
            {otherSaver(squad, me, state.theirs.updatedBy)} saved version {state.theirs.version} at {clock(state.theirs.updatedAt, true)} while you were
            editing.
          </p>
          <p className="mt-1">
            Your text is still here and has not been saved. Load their version (your text is set aside, so you can put it back), or keep your text (your
            next save replaces their version).
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={buttonClass.secondary} onClick={() => dispatch({ type: "loadTheirs" })}>
              Load their version
            </button>
            <button type="button" className={buttonClass.secondary} onClick={() => dispatch({ type: "keepMine" })}>
              Keep my text
            </button>
          </div>
          <details className="mt-2">
            <summary className="cursor-pointer font-medium">See their version</summary>
            <FieldsText type={type} fields={fieldsOf(type, state.theirs.content)} />
          </details>
        </div>
      ) : null}

      {state.stash ? (
        <div className="rounded-md bg-slate-50 p-3 text-sm ring-1 ring-inset ring-slate-200" data-testid="draft-stash">
          <p className="font-semibold text-slate-900">
            {state.stash.why === "loaded"
              ? "Your text from before you loaded the newer version is set aside here."
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
            <FieldsText type={type} fields={state.stash.fields} />
          </details>
        </div>
      ) : null}

      {state.notice ? (
        <div role="status" className="flex flex-wrap items-start justify-between gap-2 rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-900 ring-1 ring-inset ring-sky-200">
          <span>
            {state.notice.kind === "updated"
              ? `Updated to version ${state.notice.draft.version}, saved by ${who(state.notice.draft.updatedBy)} at ${clock(state.notice.draft.updatedAt, true)}.`
              : state.notice.kind === "loaded"
                ? `Showing version ${state.notice.draft.version}, saved by ${who(state.notice.draft.updatedBy)} at ${clock(state.notice.draft.updatedAt, true)}.`
                : state.notice.kind === "kept"
                  ? `You kept your text: your next save replaces version ${state.notice.draft.version}.`
                  : "Restored the unsaved text you typed on this device. Save it to keep it."}
          </span>
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
              value={state.fields.company_name ?? ""}
              onChange={(e) => dispatch({ type: "edit", key: "company_name", value: e.target.value })}
              readOnly={!live}
              maxLength={60}
              autoComplete="off"
              className={fieldClass(!live)}
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
              aria-describedby={`${uid}-ticker-hint`}
              className={`${fieldClass(!live)} font-mono uppercase`}
            />
          </div>
          <p id={`${uid}-ticker-hint`} className="text-xs text-slate-500 sm:col-span-2">
            The ticker is 3 or 4 capital letters and must be unique; it is claimed when you submit. The name and ticker are not counted in the word limit.
          </p>
        </div>
      ) : null}

      {TEMPLATES[type].map((f) => {
        const id = `${uid}-${f.key}`;
        const n = stats.perField[f.key] ?? 0;
        const text = state.fields[f.key] ?? "";
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
              aria-describedby={`${id}-words`}
              className={`${fieldClass(!live)} resize-y`}
            />
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
            <button type="submit" disabled={!dirty || !!state.theirs || pending} className={buttonClass.secondary}>
              {pending ? "Saving…" : dirty ? "Save draft" : "Saved"}
            </button>
            <ActionButton
              variant="primary"
              action={submit}
              confirm={confirm}
              disabled={!!state.theirs || pending || problem !== null || (isSubmitted && !dirty)}
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

/** Text shown read-only, field by field (their version, or the set-aside text). */
function FieldsText({ type, fields }: { type: SubmissionType; fields: Fields }) {
  return (
    <dl className="mt-2 space-y-2">
      {fieldSpecs(type).map((f) => (
        <div key={f.key}>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{f.label}</dt>
          <dd className="whitespace-pre-wrap text-slate-900">{(fields[f.key] ?? "").trim() === "" ? <span className="text-slate-400">—</span> : fields[f.key]}</dd>
        </div>
      ))}
    </dl>
  );
}
