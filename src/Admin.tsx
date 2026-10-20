import { useEffect, useRef, useState, type FormEvent } from "react";
import { ReportQueueView } from "./Reports";
import { ProductHealth } from "./ProductHealth";
import { InvitationsView } from "./Invitations";
import { AccountControl } from "./Account";
import { useAccess } from "./Access";
import { useLocale } from "./useLocale";
import { api, ApiFailure } from "./api";
import { hostedCopy } from "../shared/copy";
import { can } from "../shared/permissions";
import { locales, t, type Locale } from "./i18n";
import type {
  AdminUser,
  AdminUserDetail,
  AdminUserPage,
  AdminProject,
  AdminProjectPage,
  AuditEvent,
  AuditPage,
} from "../shared/admin";
type Section =
  | "users"
  | "invitations"
  | "projects"
  | "audit"
  | "reports"
  | "metrics";
const standalone = ["reports", "metrics", "invitations"];
export default function AdminPage() {
  const access = useAccess(),
    { locale, chooseLocale } = useLocale(),
    c = (k: string, params: Record<string, string> = {}) =>
      hostedCopy(k, locale, params),
    initial = new URLSearchParams(location.search),
    initialSection = initial.get("tab");
  const [section, setSection] = useState<Section>(
      ["projects", "audit", "reports", "metrics", "invitations"].includes(
        initialSection ?? "",
      )
        ? (initialSection as Section)
        : "users",
    ),
    [filters, setFilters] = useState<Record<string, string>>(
      initial.get("q") ? { q: initial.get("q")! } : {},
    ),
    [users, setUsers] = useState<AdminUser[]>([]),
    [projects, setProjects] = useState<AdminProject[]>([]),
    [events, setEvents] = useState<AuditEvent[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [user, setUser] = useState<AdminUserDetail | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0);
  const generation = useRef(0),
    userForm = useRef<HTMLFormElement>(null),
    fail = (e: unknown) =>
      setError(e instanceof ApiFailure ? e.code : "UNAVAILABLE");
  const permitted = can(access.principal, "administer");
  async function load(next?: string, epoch = generation.current) {
    const query = new URLSearchParams({
      ...filters,
      ...(next ? { cursor: next } : {}),
    });
    const result = await api<
      AdminUserPage | AdminProjectPage | AuditPage
    >(`/admin/${section}?${query}`);
    if (epoch !== generation.current) return;
    if ("users" in result)
      setUsers((old) => (next ? [...old, ...result.users] : result.users));
    if ("projects" in result)
      setProjects((old) =>
        next ? [...old, ...result.projects] : result.projects,
      );
    if ("events" in result)
      setEvents((old) => (next ? [...old, ...result.events] : result.events));
    setCursor(result.nextCursor);
  }
  useEffect(() => {
    const epoch = ++generation.current;
    setUser(null);
    setError("");
    setNotice("");
    setUsers([]);
    setProjects([]);
    setEvents([]);
    setCursor(null);
    if (permitted && !standalone.includes(section))
      void load(undefined, epoch).catch((e) => {
        if (epoch === generation.current) fail(e);
      });
    return () => {
      generation.current++;
    };
  }, [section, filters, permitted, access.principal?.id, refresh]);
  useEffect(() => {
    document.title = `${c("adminConsole")} · Randomize USR`;
  }, [locale]);
  function search(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const entries = [...new FormData(e.currentTarget)]
      .filter(([, v]) => String(v))
      .map(([k, v]) => [
        k,
        k === "after" || k === "before"
          ? new Date(String(v)).toISOString()
          : String(v),
      ]);
    setFilters(Object.fromEntries(entries));
  }

  async function inspectUser(id: string) {
    setBusy(true);
    setError("");
    try {
      setUser(await api<AdminUserDetail>(`/admin/users/${id}`));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function userAction(
    action: "state" | "admin" | "logout" | "verify" | "reset" | "delete",
  ) {
    if (!user || !userForm.current?.reportValidity()) return;
    const fields = new FormData(userForm.current),
      reason = String(fields.get("reason")),
      currentPassword = String(fields.get("currentPassword"));
    if ((action === "admin" || action === "delete") && !currentPassword) {
      setError("INVALID_INPUT");
      userForm.current
        ?.querySelector<HTMLInputElement>('[name="currentPassword"]')
        ?.focus();
      return;
    }
    if (
      !confirm(
        c(action === "delete" ? "confirmDeleteAccount" : "confirmAdminAction", {
          target: user.email,
        }),
      )
    )
      return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api(
        `/admin/users/${user.id}/${action === "verify" || action === "reset" ? "mail" : action}`,
        "POST",
        {
          reason,
          ...(action === "state"
            ? { state: user.state === "suspended" ? "active" : "suspended" }
            : {}),
          ...(action === "admin"
            ? { enabled: !user.isAdmin, currentPassword }
            : {}),
          ...(action === "delete" ? { currentPassword } : {}),
          ...(action === "verify" || action === "reset"
            ? { kind: action }
            : {}),
        },
      );
      if (userForm.current) {
        const password = userForm.current.querySelector<HTMLInputElement>(
          '[name="currentPassword"]',
        );
        if (password) password.value = "";
      }
      setNotice("adminSaved");
      await access.refresh();
      if (
        user.id !== access.principal?.id ||
        (action !== "state" && action !== "admin" && action !== "delete")
      )
        await inspectUser(user.id);
      await load();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="public-home">
      <div className="home-content">
        <header className="home-header">
          <h1>{c("adminConsole")}</h1>
          <nav className="actions">
            <a href="/">{c("home")}</a>
            <a href="/create">{c("openEditor")}</a>
            <AccountControl locale={locale} />
            <select
              aria-label={t("locale", locale)}
              value={locale}
              onChange={(e) => chooseLocale(e.target.value as Locale)}
            >
              {locales.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </nav>
        </header>
        {!permitted ? (
          <section aria-label={c("notAdministrator")}>
            <p role="alert">
              {c(access.principal ? "notAdministrator" : "error_AUTH_REQUIRED")}
            </p>
            {access.principal && <p>{c("notAdministratorHelp")}</p>}
          </section>
        ) : (
          <>
            <nav className="actions" aria-label={c("adminSections")}>
              <a
                href="/api/v1/admin/operations"
                target="_blank"
                rel="noreferrer"
              >
                {c("operationsStatus")}
              </a>
              {(
                ["users", "invitations", "projects", "audit", "reports", "metrics"] as const
              ).map((s) => (
                <button
                  key={s}
                  aria-pressed={section === s}
                  onClick={() => {
                    setSection(s);
                    setFilters({});
                  }}
                >
                  {c(
                    s === "metrics"
                      ? "productHealth"
                      : s === "users"
                        ? "adminUsers"
                        : s === "invitations"
                          ? "adminInvitations"
                        : s === "projects"
                          ? "adminProjects"
                          : s === "reports"
                            ? "reports"
                            : "auditLog",
                  )}
                </button>
              ))}
            </nav>
            {error && (
              <p role="alert">
                {c(`error_${error}`)}{" "}
                <button onClick={() => setRefresh((n) => n + 1)}>
                  {c("retry")}
                </button>
              </p>
            )}
            {notice && <p role="status">{c(notice)}</p>}
            {section === "reports" && <ReportQueueView locale={locale} />}
            {section === "metrics" && <ProductHealth locale={locale} />}
            {section === "invitations" && <InvitationsView locale={locale} />}
            {!standalone.includes(section) && (
              <form
                className="admin-filters actions"
                key={section}
                onSubmit={search}
              >
                {section !== "audit" ? (
                  <label>
                    {c("search")}
                    <input
                      name="q"
                      defaultValue={filters.q ?? ""}
                      maxLength={120}
                    />
                  </label>
                ) : (
                  <>
                    <label>
                      {c("targetId")}
                      <input name="targetId" maxLength={36} />
                    </label>
                    <label>
                      {c("auditAction")}
                      <input name="action" maxLength={64} />
                    </label>
                  </>
                )}
                {section === "users" && (
                  <>
                    <label>
                      {c("verificationStatus")}
                      <select
                        name="verified"
                        aria-label={c("verificationStatus")}
                      >
                        <option value="">{c("allRecords")}</option>
                        <option value="true">{c("verifiedShort")}</option>
                        <option value="false">{c("unverifiedShort")}</option>
                      </select>
                    </label>
                    <label>
                      {c("userState")}
                      <select name="state" aria-label={c("userState")}>
                        <option value="">{c("allRecords")}</option>
                        {["active", "suspended", "deleted"].map((s) => (
                          <option value={s} key={s}>
                            {c(`userState_${s}`)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      {c("createdAfter")}
                      <input
                        type="datetime-local"
                        name="after"
                        onChange={(e) => {
                          e.currentTarget.dataset.iso = e.currentTarget.value
                            ? new Date(e.currentTarget.value).toISOString()
                            : "";
                        }}
                      />
                    </label>
                    <label>
                      {c("createdBefore")}
                      <input
                        type="datetime-local"
                        name="before"
                        onChange={(e) => {
                          e.currentTarget.dataset.iso = e.currentTarget.value
                            ? new Date(e.currentTarget.value).toISOString()
                            : "";
                        }}
                      />
                    </label>
                  </>
                )}
                {section === "projects" && (
                  <>
                    <label>
                      {c("visibility")}
                      <select name="visibility" aria-label={c("visibility")}>
                        <option value="">{c("allVisibility")}</option>
                        {["private", "unlisted", "public"].map((v) => (
                          <option key={v} value={v}>
                            {c(v)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      {c("moderationState")}
                      <select
                        name="moderation"
                        aria-label={c("moderationState")}
                      >
                        <option value="">{c("allRecords")}</option>
                        <option value="active">{c("sharingActive")}</option>
                        <option value="blocked">{c("sharingBlocked")}</option>
                      </select>
                    </label>
                  </>
                )}
                <button>{c("search")}</button>
              </form>
            )}
            {section === "users" && (
              <>
                <div className="admin-grid">
                  {users.map((u) => (
                    <article className="class-card" key={u.id}>
                      <h3>{u.displayName}</h3>
                      <p>{u.email}</p>
                      <p>
                        {c(`userState_${u.state}`)} ·{" "}
                        {c(u.verified ? "verifiedShort" : "unverifiedShort")}{" "}
                        {u.isAdmin && `· ${c("systemAdmin")}`}
                      </p>
                      <button
                        disabled={busy}
                        onClick={() => void inspectUser(u.id)}
                      >
                        {c("open")}
                      </button>
                    </article>
                  ))}
                </div>
                {!users.length && <p>{c("noAdminResults")}</p>}
                {user && (
                  <section
                    className="admin-detail"
                    aria-label={c("adminUserDetail")}
                  >
                    <div className="dialog-heading">
                      <h2>
                        {user.displayName} · {user.email}
                      </h2>
                      <button onClick={() => setUser(null)}>
                        {c("close")}
                      </button>
                    </div>
                    <p className="muted">
                      {user.id} · {c("joined")}:{" "}
                      {new Date(user.createdAt).toLocaleString(locale)}
                    </p>
                    <dl className="admin-stats">
                      {(
                        [
                          ["projectCount", user.projectCount],
                          ["publicProjectCount", user.publicCount],
                          ["activeSessions", user.activeSessions],
                        ] as const
                      ).map(([label, value]) => (
                        <div key={label}>
                          <dt>{c(label)}</dt>
                          <dd>{value}</dd>
                        </div>
                      ))}
                    </dl>
                    <p>
                      {c("lastSession")}:{" "}
                      {user.lastSessionAt
                        ? new Date(user.lastSessionAt).toLocaleString(locale)
                        : "—"}
                    </p>
                    <form
                      ref={userForm}
                      className="class-form"
                      key={user.id + user.updatedAt}
                      onSubmit={(e) => e.preventDefault()}
                    >
                      <fieldset disabled={busy || user.state === "deleted"}>
                        <label>
                          {c("adminReason")}
                          <textarea name="reason" maxLength={2000} required />
                        </label>
                        <label>
                          {c("currentPassword")}
                          <input
                            name="currentPassword"
                            type="password"
                            autoComplete="current-password"
                            maxLength={128}
                          />
                        </label>
                        <p className="muted">{c("adminPasswordHint")}</p>
                        <div className="actions">
                          <button
                            type="button"
                            onClick={() => void userAction("state")}
                          >
                            {c(
                              user.state === "suspended"
                                ? "unsuspendUser"
                                : "suspendUser",
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => void userAction("logout")}
                          >
                            {c("revokeSessions")}
                          </button>
                          <button
                            type="button"
                            disabled={user.verified}
                            onClick={() => void userAction("verify")}
                          >
                            {c("resend")}
                          </button>
                          <button
                            type="button"
                            onClick={() => void userAction("reset")}
                          >
                            {c("sendReset")}
                          </button>
                          <button
                            type="button"
                            onClick={() => void userAction("admin")}
                          >
                            {c(user.isAdmin ? "revokeAdmin" : "grantAdmin")}
                          </button>
                          <button
                            type="button"
                            className="danger"
                            onClick={() => void userAction("delete")}
                          >
                            {c("deleteAccount")}
                          </button>
                        </div>
                      </fieldset>
                    </form>
                  </section>
                )}
              </>
            )}
            {section === "projects" && (
              <>
                <div className="admin-grid">
                  {projects.map((p) => (
                    <article className="class-card" key={p.id}>
                      <h3>{p.title}</h3>
                      <p>
                        {p.owner.displayName} · {c(p.visibility)} ·{" "}
                        {c(
                          p.moderationState === "active"
                            ? "sharingActive"
                            : "sharingBlocked",
                        )}
                      </p>
                      <a href={`/admin/projects/${p.id}`}>{c("viewSource")}</a>
                    </article>
                  ))}
                </div>
                {!projects.length && <p>{c("noAdminResults")}</p>}
              </>
            )}
            {section === "audit" && (
              <>
                <div className="audit-list">
                  {events.map((e) => (
                    <article className="class-card" key={e.id}>
                      <p>
                        <time dateTime={e.createdAt}>
                          {new Date(e.createdAt).toLocaleString(locale)}
                        </time>{" "}
                        · <code>{e.action}</code>
                      </p>
                      <p>
                        {c("actorId")}: {e.actorId ?? "—"} · {c("targetId")}:{" "}
                        {e.targetId ?? "—"}
                      </p>
                      <pre>{JSON.stringify(e.metadata, null, 2)}</pre>
                    </article>
                  ))}
                </div>
                {!events.length && <p>{c("noAdminResults")}</p>}
              </>
            )}
            {cursor && (
              <button
                disabled={busy}
                onClick={() => void load(cursor).catch(fail)}
              >
                {c("loadMore")}
              </button>
            )}
          </>
        )}
      </div>
    </main>
  );
}
