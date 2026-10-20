import { useRef, useState } from "react";
import { api, ApiFailure } from "./api";
import { hostedCopy } from "../shared/copy";
import type { Locale } from "./i18n";
import type { CloudProject, ProjectSnapshot } from "../shared/project";
interface Revision {
  id: string;
  number: number;
  createdAt: string;
  actorName: string | null;
  summary: string;
}
export function HistoryControl({
  id,
  locale,
  onRestored,
  canRestore = true,
}: {
  id: string;
  locale: Locale;
  onRestored: (id: string) => Promise<void>;
  canRestore?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [rows, setRows] = useState<Revision[]>([]),
    [next, setNext] = useState<number | null>(null),
    [selected, setSelected] = useState<{
      id: string;
      number: number;
      snapshot: ProjectSnapshot;
    } | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [currentVersion, setCurrentVersion] = useState(0);
  const c = (key: string) => hostedCopy(key, locale);
  async function list(before?: number) {
    const [result, p] = await Promise.all([
      api<{ revisions: Revision[]; nextBefore: number | null }>(
        `/projects/${id}/revisions${before ? `?before=${before}` : ""}`,
      ),
      api<CloudProject>(`/projects/${id}`),
    ]);
    setRows((old) =>
      before ? [...old, ...result.revisions] : result.revisions,
    );
    setNext(result.nextBefore);
    setCurrentVersion(p.version);
  }
  async function show() {
    setError("");
    setNotice("");
    setSelected(null);
    dialog.current?.showModal();
    try {
      await list();
    } catch (e) {
      setError(e instanceof ApiFailure ? e.code : "UNAVAILABLE");
    }
  }
  async function preview(revisionId: string) {
    setBusy(true);
    try {
      setSelected(await api(`/projects/${id}/revisions/${revisionId}`));
      setError("");
    } catch (e) {
      setError(e instanceof ApiFailure ? e.code : "UNAVAILABLE");
    } finally {
      setBusy(false);
    }
  }
  async function action(type: "restore" | "copy") {
    if (!selected) return;
    if (type === "restore" && !confirm(c("confirmRestore"))) return;
    setBusy(true);
    try {
      await api(
        `/projects/${id}/revisions/${selected.id}/${type}`,
        "POST",
        type === "restore" ? { version: currentVersion } : {},
      );
      if (type === "restore") {
        await onRestored(id);
        setSelected(null);
        await list();
        setNotice("restored");
      } else setNotice("copyCreated");
      setError("");
    } catch (e) {
      setError(e instanceof ApiFailure ? e.code : "UNAVAILABLE");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button onClick={() => void show()}>{c("history")}</button>
      <dialog
        ref={dialog}
        className="account-dialog library-dialog"
        aria-label={c("history")}
      >
        <div className="dialog-heading">
          <h2>{c("history")}</h2>
          <button onClick={() => dialog.current?.close()}>{c("close")}</button>
        </div>
        <p>{c("historyIntro")}</p>
        {!canRestore && <p>{c("waitForSave")}</p>}
        {error && <p role="alert">{c(`error_${error}`)}</p>}
        {notice && <p role="status">{c(notice)}</p>}
        {selected ? (
          <section>
            <h3>
              {c("revision")} {selected.number}
            </h3>
            <pre className="revision-source" aria-label={c("readOnlySource")}>
              {selected.snapshot.sourceCode}
            </pre>
            <div className="actions">
              <button
                disabled={busy || !canRestore}
                onClick={() => void action("restore")}
              >
                {c("restore")}
              </button>
              <button disabled={busy} onClick={() => void action("copy")}>
                {c("copyRevision")}
              </button>
              <button onClick={() => setSelected(null)}>
                {c("backToHistory")}
              </button>
            </div>
          </section>
        ) : (
          <>
            {rows.map((r) => (
              <article className="library-card" key={r.id}>
                <button disabled={busy} onClick={() => void preview(r.id)}>
                  {c("revision")} {r.number}
                </button>
                <p>
                  {new Date(r.createdAt).toLocaleString(locale)} ·{" "}
                  {r.actorName ?? c("pastAuthor")}
                </p>
                <code className="revision-summary">{r.summary}</code>
              </article>
            ))}
            {next && (
              <button
                onClick={() =>
                  void list(next).catch((e) =>
                    setError(e instanceof ApiFailure ? e.code : "UNAVAILABLE"),
                  )
                }
              >
                {c("loadMore")}
              </button>
            )}
          </>
        )}
      </dialog>
    </>
  );
}
