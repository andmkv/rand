import { useEffect, useState, type FormEvent } from "react";
import { api, ApiFailure } from "./api";
import { useAccess } from "./Access";
import { hostedCopy } from "../shared/copy";
import { cloudLinkKey } from "./cloudStorage";
import { useLocale } from "./useLocale";
import { locales, t, type Locale } from "./i18n";
import type { PolicyConfiguration } from "../shared/policy";
export function PolicyLinks({ locale }: { locale: Locale }) {
  const c = (key: string) => hostedCopy(key, locale);
  return (
    <nav className="actions" aria-label={c("privacyAndTerms")}>
      <a href="/privacy">{c("privacy")}</a>
      <a href="/terms">{c("terms")}</a>
    </nav>
  );
}
export function ClosedTestNotice({ locale }: { locale: Locale }) {
  const c = (key: string) => hostedCopy(key, locale);
  return (
    <section className="class-card" aria-label={c("closedTestNotice")}>
      <h3>{c("closedTestNotice")}</h3>
      <p>{c("closedTestOnly")}</p>
      <p>{c("testDataNotice")}</p>
      <p>{c("operationalDataNotice")}</p>
      <p>{c("testContactNotice")}</p>
    </section>
  );
}
export default function PolicyPage({ kind }: { kind: "privacy" | "terms" }) {
  const { locale, chooseLocale } = useLocale(),
    c = (key: string) => hostedCopy(key, locale);
  const [config, setConfig] = useState<PolicyConfiguration | null>(null),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    void api<PolicyConfiguration>("/auth/policy")
      .then((r) => {
        if (active) setConfig(r);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    document.title = `${c(kind)} · Randomize USR`;
  }, [kind, locale]);
  const url = kind === "privacy" ? config?.privacyUrl : config?.termsUrl,
    version =
      kind === "privacy" ? config?.privacyVersion : config?.termsVersion;
  return (
    <main className="public-home">
      <div className="home-content">
        <header className="home-header">
          <h1>{c(kind)}</h1>
          <a href="/">{c("home")}</a>
          <a href="/create">{c("openEditor")}</a>
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
        </header>
        <PolicyLinks locale={locale} />
        {config && !config.publicRegistrationEnabled && (
          <ClosedTestNotice locale={locale} />
        )}
        {failed ? (
          <p role="alert">{c("error_UNAVAILABLE")}</p>
        ) : !config ? (
          <p>{c("working")}</p>
        ) : url && version ? (
          <section>
            <p>
              {c("policyVersion")}: {version}
            </p>
            <a href={url} rel="noreferrer" target="_blank">
              {c("readReviewedPolicy")}
            </a>
          </section>
        ) : (
          <p role="status">{c("policyPlaceholder")}</p>
        )}
        <section className="class-card">
          <h2>{c("currentDataPractices")}</h2>
          <p>{c("dataPractices")}</p>
          <p>{c("storagePractices")}</p>
          <p>{c("operationalDataNotice")}</p>
          <p>{c("retentionPractices")}</p>
          <p>{c("agePolicyPending")}</p>
        </section>
        <section>
          <h2>{c("supportContact")}</h2>
          {config?.supportEmail ? (
            <a href={`mailto:${config.supportEmail}`}>{config.supportEmail}</a>
          ) : (
            <p>{c("supportNotConfigured")}</p>
          )}
        </section>
      </div>
    </main>
  );
}
export function AccountLifecycle({
  locale,
  onDeleted,
}: {
  locale: Locale;
  onDeleted: () => void;
}) {
  const access = useAccess(),
    c = (key: string) => hostedCopy(key, locale);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function remove(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!confirm(c("selfDeleteConfirm"))) return;
    const fields = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      await api("/account/delete", "POST", {
        currentPassword: fields.get("currentPassword"),
        confirmEmail: fields.get("confirmEmail"),
      });
      try {
        localStorage.removeItem(cloudLinkKey);
      } catch {
        /* browser work remains local */
      }
      await access.refresh();
      onDeleted();
    } catch (e) {
      setError(e instanceof ApiFailure ? e.code : "UNAVAILABLE");
    } finally {
      setBusy(false);
    }
  }
  return (
    <details>
      <summary>{c("accountData")}</summary>
      <p>{c("exportDataHint")}</p>
      <a
        className="button-link"
        href="/api/v1/account/export"
        download="randomize-usr-account.ndjson"
        target="_blank"
        rel="noreferrer"
      >
        {c("exportAccount")}
      </a>
      <details>
        <summary>{c("deleteAccount")}</summary>
        <p>{c("selfDeleteHint")}</p>
        <p className="muted">{c("localWorkAfterDelete")}</p>
        <form className="class-form" onSubmit={remove}>
          <label>
            {c("confirmAccountEmail")}
            <input
              name="confirmEmail"
              type="email"
              maxLength={320}
              required
              autoComplete="email"
            />
          </label>
          <label>
            {c("currentPassword")}
            <input
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              maxLength={128}
              required
            />
          </label>
          {error && <p role="alert">{c(`error_${error}`)}</p>}
          <button className="danger" disabled={busy}>
            {c("deleteMyAccount")}
          </button>
        </form>
      </details>
    </details>
  );
}
