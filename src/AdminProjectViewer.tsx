import { useEffect, useState, type FormEvent } from "react";
import App from "./App";
import { AccountControl } from "./Account";
import { useAccess } from "./Access";
import { useLocale } from "./useLocale";
import { api, ApiFailure } from "./api";
import { hostedCopy } from "../shared/copy";
import { can } from "../shared/permissions";
import { parseProject } from "./project";
import type {
  AdminProjectDetail,
  ModerationPage,
  AdminReportPage,
} from "../shared/admin";
export default function AdminProjectViewer({ id }: { id: string }) {
  const access = useAccess(),
    { locale } = useLocale(),
    c = (k: string) => hostedCopy(k, locale),
    [data, setData] = useState<AdminProjectDetail | null>(null),
    [version, setVersion] = useState<"draft" | "published">("published"),
    [history, setHistory] = useState<ModerationPage["actions"]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [reportCursor, setReportCursor] = useState<string | null>(null),
    [reports, setReports] = useState<AdminReportPage["reports"]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0);
  const fail = (e: unknown) =>
      setError(e instanceof ApiFailure ? e.code : "UNAVAILABLE"),
    permitted = can(access.principal, "administer");
  useEffect(() => {
    let active = true;
    if (!data || data.id !== id || !permitted) setData(null);
    if (permitted)
      void (async () => {
        try {
          const [p, h, r] = await Promise.all([
            api<AdminProjectDetail>(`/admin/projects/${id}`),
            api<ModerationPage>(`/admin/projects/${id}/history`),
            api<AdminReportPage>(`/admin/projects/${id}/reports`),
          ]);
          if (active) {
            parseProject(JSON.stringify(p.snapshot));
            setData(p);
            setHistory(h.actions);
            setCursor(h.nextCursor);
            setReports(r.reports);
            setReportCursor(r.nextCursor ?? null);
            setError("");
            document.title = `${p.title} · ${c("adminConsole")}`;
          }
        } catch (e) {
          if (active) fail(e);
        }
      })();
    return () => {
      active = false;
    };
  }, [id, permitted, access.principal?.id, refresh]);
  async function moderate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (
      !data ||
      !confirm(hostedCopy("confirmAdminAction", locale, { target: data.title }))
    )
      return;
    const fields = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      await api(`/admin/projects/${id}/moderate`, "POST", {
        version: data.version,
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
  async function feature() {
    if (!data?.revisionId) return;
    setBusy(true);
    try {
      await api(`/admin/featured/${data.shortCode}`, "PATCH", {
        revisionId: data.revisionId,
        featured: !data.featured,
      });
      setRefresh((n) => n + 1);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function moreHistory() {
    try {
      const r = await api<ModerationPage>(
        `/admin/projects/${id}/history?cursor=${encodeURIComponent(cursor!)}`,
      );
      setHistory((old) => [...old, ...r.actions]);
      setCursor(r.nextCursor);
    } catch (e) {
      fail(e);
    }
  }
  async function moreReports() {
    try {
      const r = await api<AdminReportPage>(
        `/admin/projects/${id}/reports?cursor=${encodeURIComponent(reportCursor!)}`,
      );
      setReports((old) => [...old, ...r.reports]);
      setReportCursor(r.nextCursor ?? null);
    } catch (e) {
      fail(e);
    }
  }
  if (!data || !permitted)
    return (
      <main className="public-home">
        <div className="home-content">
          <h1>{c("adminConsole")}</h1>
          <AccountControl locale={locale} />
          <p role="alert">
            {c(
              error
                ? `error_${error}`
                : permitted
                  ? "working"
                  : "error_FORBIDDEN",
            )}
          </p>
          <a href="/admin">{c("adminConsole")}</a>
        </div>
      </main>
    );
  const effectiveVersion = data.publishedSnapshot ? version : "draft";
  const snapshot =
    effectiveVersion === "published" && data.publishedSnapshot
      ? data.publishedSnapshot
      : data.snapshot;
  return (
    <App
      key={`${data.version}-${effectiveVersion}-${data.moderationState}`}
      initialProject={parseProject(JSON.stringify(snapshot))}
      viewOnly
      viewerCaption={(language) => hostedCopy("adminSourceCaption", language)}
      viewerHeader={(language) => {
        const copy = (k: string) => hostedCopy(k, language);
        return (
          <>
            <h2>
              {snapshot.title || data.title} · {data.owner.displayName}
            </h2>
            <p>
              {copy(data.visibility)} ·{" "}
              {copy(
                data.moderationState === "active"
                  ? "sharingActive"
                  : "sharingBlocked",
              )}
            </p>
            <div className="actions">
              <a href="/admin?tab=projects">{copy("adminConsole")}</a>
              <button
                aria-pressed={effectiveVersion === "draft"}
                onClick={() => setVersion("draft")}
              >
                {copy("draftVersion")}
              </button>
              {data.publishedSnapshot && (
                <button
                  aria-pressed={effectiveVersion === "published"}
                  onClick={() => setVersion("published")}
                >
                  {copy("publishedVersion")}
                </button>
              )}
              {data.visibility === "public" &&
                data.revisionId &&
                data.moderationState === "active" &&
                !data.deleted && (
                  <button disabled={busy} onClick={() => void feature()}>
                    {copy(data.featured ? "unfeature" : "feature")}
                  </button>
                )}
            </div>
            {!data.deleted && (
              <details>
                <summary>{copy("moderation")}</summary>
                <form className="class-form" onSubmit={moderate}>
                  <label>
                    {copy("moderationAction")}
                    <select name="action" aria-label={copy("moderationAction")}>
                      <option value="unpublish">
                        {copy("unpublishProject")}
                      </option>
                      <option value="block">{copy("blockProject")}</option>
                      <option value="unblock">{copy("unblockProject")}</option>
                    </select>
                  </label>
                  <label>
                    {copy("adminReason")}
                    <textarea name="reason" maxLength={2000} required />
                  </label>
                  <button disabled={busy}>{copy("applyModeration")}</button>
                </form>
              </details>
            )}
            <details>
              <summary>{copy("moderationHistory")}</summary>
              {history.map((h) => (
                <p className="plain-prose" key={h.id}>
                  {new Date(h.createdAt).toLocaleString(language)} · {h.action}{" "}
                  · {h.reason}
                </p>
              ))}
              {cursor && (
                <button onClick={() => void moreHistory()}>
                  {copy("loadMore")}
                </button>
              )}
            </details>
            <details>
              <summary>{copy("reports")}</summary>
              {!reports.length && <p>{copy("noReports")}</p>}
              {reports.map((r) => (
                <p className="plain-prose" key={r.id}>
                  {copy(`reportReason_${r.reason}`)} ·{" "}
                  {copy(`reportState_${r.state}`)} · {r.detail}
                </p>
              ))}
              {reportCursor && (
                <button onClick={() => void moreReports()}>
                  {copy("loadMore")}
                </button>
              )}
            </details>
            {error && <p role="alert">{copy(`error_${error}`)}</p>}
          </>
        );
      }}
    />
  );
}
