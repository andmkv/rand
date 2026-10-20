import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAccess } from "./Access";
import { api, ApiFailure } from "./api";
import { hostedCopy } from "../shared/copy";
import {
  reportReasons,
  type ReportQueue,
  type ReportQueueItem,
} from "../shared/reports";
import type { Locale } from "./i18n";
export function ReportControl({
  code,
  locale,
}: {
  code: string;
  locale: Locale;
}) {
  const access = useAccess(),
    c = (key: string) => hostedCopy(key, locale),
    dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [sent, setSent] = useState(false);
  async function send(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const fields = new FormData(e.currentTarget);
    try {
      await api(`/shared/${code}/report`, "POST", {
        reason: fields.get("reason"),
        detail: fields.get("detail"),
      });
      setSent(true);
    } catch (e) {
      setError(e instanceof ApiFailure ? e.code : "UNAVAILABLE");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        onClick={() => {
          setSent(false);
          setError("");
          dialog.current?.showModal();
        }}
      >
        {c("reportProject")}
      </button>
      <dialog
        ref={dialog}
        className="account-dialog"
        aria-label={c("reportProject")}
      >
        <div className="dialog-heading">
          <h2>{c("reportProject")}</h2>
          <button onClick={() => dialog.current?.close()}>{c("close")}</button>
        </div>
        <p>{c("reportPolicy")}</p>
        {sent ? (
          <p role="status">{c("reportSent")}</p>
        ) : access.principal?.verified && access.principal.active ? (
          <form className="class-form" onSubmit={send}>
            <label>
              {c("reportReason")}
              <select name="reason" aria-label={c("reportReason")}>
                {reportReasons.map((r) => (
                  <option key={r} value={r}>
                    {c(`reportReason_${r}`)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {c("reportDetail")}
              <textarea name="detail" maxLength={500} />
            </label>
            {error && <p role="alert">{c(`error_${error}`)}</p>}
            <button disabled={busy}>
              {c(busy ? "working" : "sendReport")}
            </button>
          </form>
        ) : (
          <button
            onClick={() => {
              dialog.current?.close();
              access.requestAuthentication();
            }}
          >
            {c("reportSignIn")}
          </button>
        )}
      </dialog>
    </>
  );
}
export function ReportQueueView({ locale }: { locale: Locale }) {
  const c = (key: string) => hostedCopy(key, locale);
  const [state, setState] = useState("open"),
    [reports, setReports] = useState<ReportQueueItem[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0);
  const generation = useRef(0);
  const fail = (e: unknown) =>
    setError(e instanceof ApiFailure ? e.code : "UNAVAILABLE");
  async function load(next?: string, epoch = generation.current) {
    const r = await api<ReportQueue>(
      `/admin/reports?state=${state}${next ? `&cursor=${encodeURIComponent(next)}` : ""}`,
    );
    if (epoch !== generation.current) return;
    setReports((old) => (next ? [...old, ...r.reports] : r.reports));
    setCursor(r.nextCursor);
  }
  useEffect(() => {
    const epoch = ++generation.current;
    setReports([]);
    setError("");
    setCursor(null);
    void load(undefined, epoch).catch((e) => {
      if (epoch === generation.current) fail(e);
    });
    return () => {
      generation.current++;
    };
  }, [state, refresh]);
  async function review(e: FormEvent<HTMLFormElement>, id: string) {
    e.preventDefault();
    const fields = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      await api(`/admin/reports/${id}/review`, "POST", {
        action: fields.get("action"),
        reason: fields.get("reason"),
      });
      setRefresh((n) => n + 1);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label={c("reports")}>
      <label>
        {c("reportState")}
        <select
          aria-label={c("reportState")}
          value={state}
          onChange={(e) => setState(e.target.value)}
        >
          {["open", "dismissed", "resolved"].map((s) => (
            <option key={s} value={s}>
              {c(`reportState_${s}`)}
            </option>
          ))}
        </select>
      </label>
      <p className="muted">{c("reportQueueHint")}</p>
      {error && (
        <p role="alert">
          {c(`error_${error}`)}{" "}
          <button onClick={() => setRefresh((n) => n + 1)}>{c("retry")}</button>
        </p>
      )}
      {!reports.length && <p>{c("noReports")}</p>}
      <div className="admin-grid">
        {reports.map((r) => (
          <article className="class-card" key={r.id}>
            <h3>{r.project.title}</h3>
            <p>
              {c("byAuthor")} {r.owner.displayName}
            </p>
            <p>
              {c(`reportReason_${r.reason}`)} · {c(`reportState_${r.state}`)} ·{" "}
              {new Date(r.createdAt).toLocaleString(locale)}
            </p>
            <p>
              {c("openReportCount")}: {r.openCount}
            </p>
            <p className="plain-prose">{r.detail}</p>
            <div className="actions">
              <a href={`/admin/projects/${r.project.id}`}>{c("viewSource")}</a>
              <a href={`/admin?q=${encodeURIComponent(r.owner.id)}`}>
                {c("adminUserDetail")}
              </a>
            </div>
            {r.state === "open" && (
              <form
                className="class-form"
                onSubmit={(e) => void review(e, r.id)}
              >
                <label>
                  {c("reportReviewAction")}
                  <select name="action" aria-label={c("reportReviewAction")}>
                    <option value="dismiss">{c("dismissReport")}</option>
                    <option value="resolve">{c("resolveReport")}</option>
                  </select>
                </label>
                <label>
                  {c("adminReason")}
                  <textarea name="reason" maxLength={2000} required />
                </label>
                <button disabled={busy}>{c("saveReportReview")}</button>
              </form>
            )}
          </article>
        ))}
      </div>
      {cursor && (
        <button disabled={busy} onClick={() => void load(cursor).catch(fail)}>
          {c("loadMore")}
        </button>
      )}
    </section>
  );
}
