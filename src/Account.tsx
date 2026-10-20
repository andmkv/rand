import { ServerLimits } from "./ServerLimits";
import { trackUsage } from "./Analytics";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAccess } from "./Access";
import { AccountLifecycle, PolicyLinks, ClosedTestNotice } from "./Privacy";
import type { PolicyConfiguration } from "../shared/policy";
import { authLinkToken } from "./authLink";
import { api, ApiFailure, setDemoMode } from "./api";
import { backupLocalProject, exitDemo } from "./demoSession";
import { hostedCopy } from "../shared/copy";
import { locales, type Locale } from "./i18n";
type View =
  | "login"
  | "register"
  | "inviteRequest"
  | "forgot"
  | "verify"
  | "reset"
  | "account";
export function AccountControl({ locale }: { locale: Locale }) {
  const access = useAccess();
  const initial =
    location.pathname === "/verify"
      ? "verify"
      : location.pathname === "/reset-password"
        ? "reset"
        : location.pathname === "/invite"
          ? authLinkToken
            ? "register"
            : "inviteRequest"
          : "login";
  const [view, setView] = useState<View>(initial);
  const [open, setOpen] = useState(
    initial !== "login" || location.pathname === "/settings",
  );
  const [token] = useState(authLinkToken);
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const [policy, setPolicy] = useState<PolicyConfiguration | null>(null);
  const [fieldError, setFieldError] = useState<{
    name: string;
    key: string;
  } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const c = (key: string) => hostedCopy(key, locale);
  useEffect(() => {
    if (open && view === "register") void trackUsage("signup_started");
  }, [open, view]);
  useEffect(() => {
    if (open) {
      dialog.current?.showModal();
      void api<PolicyConfiguration>("/auth/policy")
        .then(setPolicy)
        .catch(() => {});
    } else dialog.current?.close();
  }, [open]);
  useEffect(() => {
    if (location.pathname === "/settings" && access.account) setView("account");
  }, [access.account?.id]);
  useEffect(() => {
    if (access.authRequest) {
      setOpen(true);
      setView(access.account ? "account" : "login");
    }
  }, [access.authRequest]);
  function change(next: View) {
    setView(next);
    setNotice("");
    setFieldError(null);
  }
  async function startDemo() {
    setBusy(true);
    setNotice("");
    try {
      await api("/auth/demo", "POST", { locale });
      backupLocalProject();
      setDemoMode(true);
      location.assign("/create");
    } catch (error) {
      setNotice(
        `error_${error instanceof ApiFailure ? error.code : "UNAVAILABLE"}`,
      );
    } finally {
      setBusy(false);
    }
  }
  // Native validation bubbles use the browser language; ours follow the product locale.
  function validate(form: HTMLFormElement) {
    for (const el of Array.from(form.elements)) {
      if (
        !(el instanceof HTMLInputElement) ||
        el.type === "hidden" ||
        el.checkValidity()
      )
        continue;
      setFieldError({
        name: el.name || el.type,
        key: el.validity.valueMissing ? "requiredField" : "invalidField",
      });
      el.focus();
      return false;
    }
    return true;
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validate(event.currentTarget)) return;
    setFieldError(null);
    setBusy(true);
    setNotice("");
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      if (view === "login") {
        if (String(data.email) === "demo" && String(data.password) === "demo") {
          await api("/auth/demo", "POST", {
            username: "demo",
            password: "demo",
            locale,
          });
          backupLocalProject();
          setDemoMode(true);
          location.assign("/create");
          return;
        }
        await api("/auth/login", "POST", {
          email: data.email,
          password: data.password,
        });
        await access.refresh();
        setView("account");
      }
      if (view === "register") {
        await api("/auth/register", "POST", {
          email: data.email,
          password: data.password,
          displayName: data.displayName,
          locale,
          ...(token && location.pathname === "/invite"
            ? { inviteToken: token }
            : {}),
          ...(data.testNoticeAcknowledged && policy?.closedTestNoticeVersion
            ? { testNoticeVersion: policy.closedTestNoticeVersion }
            : {}),
          ...(policy?.termsVersion
            ? { termsVersion: policy.termsVersion }
            : {}),
          ...(policy?.privacyVersion
            ? { privacyVersion: policy.privacyVersion }
            : {}),
        });
        await access.refresh();
        setView("account");
        setNotice("checkEmail");
      }
      if (view === "forgot") {
        await api("/auth/forgot", "POST", { email: data.email });
        setNotice("resetSent");
      }
      if (view === "verify") {
        await api("/auth/verify", "POST", { token });
        await access.refresh();
        setNotice("verified");
        history.replaceState(null, "", "/create");
      }
      if (view === "reset") {
        await api("/auth/reset", "POST", { token, password: data.password });
        await access.refresh();
        setView("login");
        setNotice("passwordReset");
        history.replaceState(null, "", "/create");
      }
    } catch (error) {
      setNotice(
        `error_${error instanceof ApiFailure ? error.code : "UNAVAILABLE"}`,
      );
      await access.refresh();
    } finally {
      setBusy(false);
    }
  }
  async function action(path: string, success: string) {
    setBusy(true);
    setNotice("");
    try {
      await api(path, "POST", {});
      await access.refresh();
      setNotice(success);
      if (path.endsWith("logout") || path.endsWith("sign-out-all"))
        setView("login");
    } catch (error) {
      setNotice(
        `error_${error instanceof ApiFailure ? error.code : "UNAVAILABLE"}`,
      );
    } finally {
      setBusy(false);
    }
  }
  async function requestInvite() {
    setBusy(true);
    setNotice("");
    try {
      await api("/auth/bootstrap-invite", "POST", {});
      setNotice("inviteRequestSent");
    } catch (error) {
      setNotice(
        `error_${error instanceof ApiFailure ? error.code : "UNAVAILABLE"}`,
      );
    } finally {
      setBusy(false);
    }
  }
  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await api("/account", "PATCH", data);
      await access.refresh();
      setNotice("profileSaved");
    } catch (error) {
      setNotice(
        `error_${error instanceof ApiFailure ? error.code : "UNAVAILABLE"}`,
      );
    } finally {
      setBusy(false);
    }
  }
  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await api("/account/password", "POST", data);
      await access.refresh();
      setView("login");
      setNotice("passwordReset");
    } catch (error) {
      setNotice(
        `error_${error instanceof ApiFailure ? error.code : "UNAVAILABLE"}`,
      );
    } finally {
      setBusy(false);
    }
  }
  const account = access.account;
  const demoAccount = view === "account" && !!account && !!access.principal?.demo;
  const fieldProps = (name: string) =>
    fieldError?.name === name
      ? { "aria-invalid": true, "aria-describedby": "auth-field-error" }
      : {};
  return (
    <>
      <button
        className="account-button"
        onClick={() => {
          change(account ? "account" : "login");
          setOpen(true);
        }}
      >
        {account ? c("account") : c("login")}
      </button>
      <dialog
        ref={dialog}
        className="account-dialog"
        aria-label={c(view)}
        onCancel={() => setOpen(false)}
        onClose={() => setOpen(false)}
      >
        <div className="dialog-heading">
          <h2>{c(view)}</h2>
          <button type="button" onClick={() => setOpen(false)}>
            {c("close")}
          </button>
        </div>
        {!demoAccount && <p>{c("accountBenefit")}</p>}
        {!demoAccount &&
          policy &&
          !policy.publicRegistrationEnabled &&
          view !== "register" && <p>{c("closedTestAccount")}</p>}
        {view === "account" && account && access.principal?.demo ? (
          <section>
            <h3>{c("demoMode")}</h3>
            <p>{c("demoAccountBody")}</p>
            <p>{c("demoNotice")}</p>
            <button disabled={busy} onClick={() => void exitDemo()}>
              {c("demoExit")}
            </button>
          </section>
        ) : view === "account" && account ? (
          <section>
            <h3>
              <span className="account-avatar" aria-hidden="true">
                {Array.from(account.displayName)
                  .slice(0, 2)
                  .join("")
                  .toUpperCase()}
              </span>{" "}
              {account.displayName}
            </h3>
            <p>
              {c("joined")}{" "}
              <time dateTime={account.createdAt}>
                {new Date(account.createdAt).toLocaleDateString(locale)}
              </time>
            </p>
            <form
              onSubmit={saveProfile}
              key={`${account.id}-${account.locale}`}
            >
              <label>
                {c("displayName")}
                <input
                  name="displayName"
                  defaultValue={account.displayName}
                  maxLength={80}
                  required
                />
              </label>
              <label>
                {c("preferredLanguage")}
                <select
                  name="locale"
                  aria-label={c("preferredLanguage")}
                  defaultValue={account.locale}
                >
                  {locales.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
              <button disabled={busy}>{c("saveProfile")}</button>
            </form>
            <details>
              <summary>{c("changePassword")}</summary>
              <form onSubmit={changePassword}>
                <label>
                  {c("currentPassword")}
                  <input
                    name="currentPassword"
                    type="password"
                    autoComplete="current-password"
                    minLength={12}
                    maxLength={128}
                    required
                  />
                </label>
                <label>
                  {c("newPassword")}
                  <input
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    minLength={12}
                    maxLength={128}
                    required
                  />
                </label>
                <button disabled={busy}>{c("savePassword")}</button>
              </form>
            </details>
            <ServerLimits locale={locale} />
            <AccountLifecycle
              locale={locale}
              onDeleted={() => {
                setView("login");
                setNotice("accountDeleted");
              }}
            />
            <PolicyLinks locale={locale} />
            <button
              disabled={busy}
              onClick={() => void action("/account/sign-out-all", "loggedOut")}
            >
              {c("signOutAll")}
            </button>
            <p className="account-email">{account.email}</p>
            <p>{c(account.verified ? "verified" : "unverified")}</p>
            {!account.verified && (
              <button
                disabled={busy}
                onClick={() => void action("/auth/resend", "checkEmail")}
              >
                {c("resend")}
              </button>
            )}
            {policy?.demoEnabled && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void startDemo()}
              >
                {c("tryDemo")}
              </button>
            )}
            <button
              disabled={busy}
              onClick={() => void action("/auth/logout", "loggedOut")}
            >
              {c("logout")}
            </button>
          </section>
        ) : view === "inviteRequest" ? (
          <section>
            <p>{c("inviteRequestBody")}</p>
            <button
              type="button"
              disabled={busy}
              onClick={() => void requestInvite()}
            >
              {c("inviteRequestButton")}
            </button>
          </section>
        ) : (
          <form key={view} onSubmit={submit} noValidate>
            {["login", "register", "forgot"].includes(view) && (
              <label>
                {c("email")}
                <input
                  name="email"
                  type={view === "login" ? "text" : "email"}
                  autoComplete={view === "login" ? "username" : "email"}
                  maxLength={320}
                  required
                  {...fieldProps("email")}
                />
              </label>
            )}
            {view === "register" && token && (
              <p className="muted">{c("inviteUseEmail")}</p>
            )}
            {["login", "register", "reset"].includes(view) && (
              <label>
                {c("password")}
                <input
                  name="password"
                  aria-label={c("password")}
                  aria-describedby="auth-password-hint"
                  type="password"
                  autoComplete={
                    view === "login" ? "current-password" : "new-password"
                  }
                  minLength={view === "login" ? undefined : 12}
                  maxLength={128}
                  required
                />
                <small id="auth-password-hint">{c("passwordHint")}</small>
              </label>
            )}
            {view === "register" && (
              <>
                <label>
                  {c("displayName")}
                  <input
                    name="displayName"
                    autoComplete="nickname"
                    maxLength={80}
                    required
                  />
                </label>
                <PolicyLinks locale={locale} />
                {!policy?.publicRegistrationEnabled && (
                  <>
                    <ClosedTestNotice locale={locale} />
                    <label className="checkbox-label">
                      <input
                        name="testNoticeAcknowledged"
                        type="checkbox"
                        required
                      />
                      {c("testNoticeAcknowledge")}
                    </label>
                  </>
                )}
                {(policy?.termsVersion || policy?.privacyVersion) && (
                  <label className="checkbox-label">
                    <input type="checkbox" required />
                    {c("acceptPolicies")}{" "}
                    <a href="/terms" target="_blank" rel="noreferrer">
                      {c("terms")}
                    </a>{" "}
                    ·{" "}
                    <a href="/privacy" target="_blank" rel="noreferrer">
                      {c("privacy")}
                    </a>
                  </label>
                )}
              </>
            )}
            {fieldError && (
              <small id="auth-field-error" className="account-error" role="alert">
                {c(fieldError.key)}
              </small>
            )}
            {view === "verify" && <p>{c("verifyPrompt")}</p>}
            <button
              disabled={
                busy ||
                (view === "register" &&
                  (!policy || (!policy.publicRegistrationEnabled && !token))) ||
                ((view === "verify" || view === "reset") && !token)
              }
              type="submit"
            >
              {c(
                busy
                  ? "working"
                  : view === "forgot"
                    ? "sendReset"
                    : view === "verify"
                      ? "verifyAction"
                      : view === "reset"
                        ? "savePassword"
                        : view,
              )}
            </button>
          </form>
        )}
        {view === "login" && policy?.demoEnabled && (
          <section className="demo-entry">
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => void startDemo()}
            >
              {c("tryDemo")}
            </button>
            <p>{c("demoIntro")}</p>
            <p className="muted">{c("demoCredentialsHint")}</p>
          </section>
        )}
        {notice && (
          <p
            className={
              notice.startsWith("error_") ? "account-error" : "account-notice"
            }
            role="alert"
          >
            {c(notice)}
          </p>
        )}
        {notice === "error_REGISTRATION_CLOSED" && (
          <button
            type="button"
            disabled={busy}
            onClick={() => change("inviteRequest")}
          >
            {c("inviteRequestButton")}
          </button>
        )}
        <nav className="actions" hidden={demoAccount}>
          {(["login", "register", "forgot"] as View[])
            .filter(
              (v) =>
                v !== view &&
                (v !== "register" ||
                  policy?.publicRegistrationEnabled ||
                  (location.pathname === "/invite" && token)),
            )
            .map((v) => (
              <button
                key={v}
                disabled={busy}
                type="button"
                onClick={() => change(v)}
              >
                {c(v)}
              </button>
            ))}
        </nav>
      </dialog>
    </>
  );
}
