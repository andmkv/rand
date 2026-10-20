import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiFailure } from "./api";
import { hostedCopy } from "../shared/copy";
import type { Locale } from "./i18n";
import type { AdminInvitation, InvitationPage, InvitationStatus } from "../shared/admin";
const statuses: InvitationStatus[] = ["active", "used", "expired", "revoked"];
export function InvitationsView({ locale }: { locale: Locale }) {
  const c = (key: string, params?: Record<string, string>) =>
    hostedCopy(key, locale, params);
  const [status, setStatus] = useState<InvitationStatus>("active"),
    [rows, setRows] = useState<AdminInvitation[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false);
  // A status change starts a new listing epoch; a slow earlier response must not overwrite it.
  const generation = useRef(0),
    pendingNotice = useRef<string | null>(null);
  const fail = (e: unknown) =>
    setError(e instanceof ApiFailure ? e.code : "UNAVAILABLE");
  const errorCopy = (code: string) =>
    c(
      code === "ACCOUNT_EXISTS"
        ? "invitationAccountExists"
        : code === "MAIL_UNAVAILABLE"
          ? "invitationMailFailed"
          : `error_${code}`,
    );
  const date = (value: string) =>
    new Date(value).toLocaleDateString(locale, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  async function load(next?: string) {
    const epoch = generation.current,
      query = new URLSearchParams({
        status,
        ...(next ? { cursor: next } : {}),
      }),
      page = await api<InvitationPage>(`/admin/invitations?${query}`);
    if (epoch !== generation.current) return;
    setRows((old) => (next ? [...old, ...page.invitations] : page.invitations));
    setCursor(page.nextCursor);
    setLoaded(true);
  }
  useEffect(() => {
    const epoch = ++generation.current;
    setLoaded(false);
    setRows([]);
    setError("");
    setNotice("");
    void load()
      .then(() => {
        if (epoch !== generation.current || !pendingNotice.current) return;
        setNotice(pendingNotice.current);
        pendingNotice.current = null;
      })
      .catch((e) => {
        if (epoch !== generation.current) return;
        fail(e);
        setLoaded(true);
      });
    return () => {
      generation.current++;
    };
  }, [status]);
  async function act(work: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
      await load();
      setNotice(message);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget,
      data = new FormData(form),
      email = String(data.get("email") ?? "").trim(),
      // The server only accepts a truthful adult-tester confirmation; never send it unchecked.
      adultTester = data.get("adult") === "on";
    if (!email || !adultTester) return;
    const wasActive = status === "active";
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api("/admin/invitations", "POST", { email, adultTester, locale });
      form.reset();
      if (wasActive) {
        await load();
        setNotice("invitationSent");
      } else {
        // The new invitation belongs to the Active tab; keep the notice across that reload.
        pendingNotice.current = "invitationSent";
        setStatus("active");
      }
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="admin-invitations" aria-label={c("adminInvitations")}>
      <div className="invite-head">
        <h2>{c("inviteByEmail")}</h2>
        <p>{c("invitationsIntro")}</p>
      </div>
      <form className="invite-form" onSubmit={invite}>
        <label className="invite-field">
          <span>{c("email")}</span>
          <input
            name="email"
            type="email"
            required
            maxLength={320}
            autoComplete="off"
            disabled={busy}
          />
        </label>
        <label className="invite-adult">
          <input name="adult" type="checkbox" required disabled={busy} />
          <span>{c("invitationAdultTester")}</span>
        </label>
        <div className="invite-form-foot">
          <p className="invite-note">{c("invitationsNote")}</p>
          <button className="primary" disabled={busy}>
            {c("sendInvitation")}
          </button>
        </div>
      </form>
      {error && (
        <p className="invite-feedback invite-error" role="alert">
          {errorCopy(error)}
        </p>
      )}
      {notice && (
        <p className="invite-feedback invite-notice" role="status">
          {c(notice)}
        </p>
      )}
      <div className="invite-tabs" role="group" aria-label={c("invitationStatus")}>
        {statuses.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={status === s}
            onClick={() => setStatus(s)}
          >
            {c(`invitation_${s}`)}
          </button>
        ))}
      </div>
      <div className="invite-list" aria-busy={!loaded} aria-live="polite">
        {!loaded && <p className="invite-empty">{c("invitationsLoading")}</p>}
        {!error && loaded && !rows.length && (
          <div className="invite-empty">
            <p>{c("noInvitations")}</p>
            <p className="invite-empty-hint">{c("invitationsEmptyHint")}</p>
          </div>
        )}
        {rows.map((r) => (
          <article className="invite-row" key={r.id}>
            <div className="invite-row-main">
              <h3>{r.email}</h3>
              <p className="invite-meta">
                <span className={`invite-badge invite-${r.status}`}>
                  {c(`invitation_${r.status}`)}
                </span>
                <span>
                  {c("invitationCreated")}{" "}
                  <time dateTime={r.createdAt}>{date(r.createdAt)}</time>
                </span>
                <span>
                  {c("invitationExpires")}{" "}
                  <time dateTime={r.expiresAt}>{date(r.expiresAt)}</time>
                </span>
              </p>
            </div>
            {r.status !== "used" && (
              <div className="invite-row-actions">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void act(
                      () => api(`/admin/invitations/${r.id}/resend`, "POST", { locale }),
                      "invitationSent",
                    )
                  }
                >
                  {c("resendInvitation")}
                </button>
                {r.status === "active" && (
                  <button
                    type="button"
                    className="danger"
                    disabled={busy}
                    onClick={() =>
                      confirm(c("confirmRevokeInvitation", { email: r.email })) &&
                      void act(
                        () => api(`/admin/invitations/${r.id}/revoke`, "POST", {}),
                        "invitationRevoked",
                      )
                    }
                  >
                    {c("revokeInvitation")}
                  </button>
                )}
              </div>
            )}
          </article>
        ))}
      </div>
      {cursor && (
        <button
          type="button"
          className="invite-more"
          disabled={busy}
          onClick={() => void load(cursor).catch(fail)}
        >
          {c("loadMore")}
        </button>
      )}
    </section>
  );
}
