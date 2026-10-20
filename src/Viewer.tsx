import { useEffect, useState } from "react";
import App from "./App";
import { ReportControl } from "./Reports";
import { ModerationControl } from "./Moderation";
import { ShareControl } from "./Share";
import { Menu } from "./Menu";
import { can } from "../shared/permissions";
import { useAccess } from "./Access";
import { examples } from "./content/examples";
import { readLocale, useLocale } from "./useLocale";
import { content, exampleInstructions, t, locales, type Locale } from "./i18n";
import { api, ApiFailure } from "./api";
import {
  parseProject,
  projectKey,
  freshProject,
  type Project,
} from "./project";
import { cloudLinkKey } from "./Cloud";
import { hostedCopy } from "../shared/copy";
import type { CloudProject, SharedProject } from "../shared/project";
function HowToPlay({ text, locale }: { text: string; locale: Locale }) {
  if (!text.trim()) return null;
  return (
    <div className="how-to-play">
      <h3>{t("howToPlay", locale)}</h3>
      <p>{text}</p>
    </div>
  );
}
// Same friendly page for unknown, malformed, private, unpublished and expired links: it never reveals which.
function Unavailable({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  const { locale, chooseLocale } = useLocale();
  const c = (key: string) => hostedCopy(key, locale);
  return (
    <main className="public-loading unavailable">
      <header>
        <h1>
          <a className="brand-link" href="/">
            {t("brand", locale)}
          </a>
        </h1>
        <select
          aria-label={t("locale", locale)}
          value={locale}
          onChange={(e) => chooseLocale(e.target.value as Locale)}
        >
          {locales.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
      </header>
      <section className="unavailable-body">
        <h2>{title}</h2>
        <p role="alert">{body}</p>
        <div className="actions">
          <a className="button-link primary-link" href="/#examples">
            {c("browseExamples")}
          </a>
          <a className="button-link" href="/create">
            {c("openEditor")}
          </a>
          <a className="button-link" href="/">
            {c("home")}
          </a>
        </div>
      </section>
    </main>
  );
}
export function PublicViewer({ code }: { code: string }) {
  const access = useAccess();
  const { locale } = useLocale();
  const [data, setData] = useState<SharedProject | null>(null),
    [snapshot, setSnapshot] = useState<Project | null>(null),
    [error, setError] = useState(""),
    [remixError, setRemixError] = useState(""),
    [refresh, setRefresh] = useState(0),
    [busy, setBusy] = useState(false),
    [copyId, setCopyId] = useState("");
  useEffect(() => {
    if (!access.ready) return;
    let active = true;
    void api<SharedProject>(`/shared/${encodeURIComponent(code)}`)
      .then((result) => {
        if (!active) return;
        const project = parseProject(JSON.stringify(result.snapshot));
        setData(result);
        setError("");
        setSnapshot(project);
        document.title = `${result.title} · Randomize USR`;
        let robots = document.querySelector<HTMLMetaElement>(
          'meta[name="robots"]',
        );
        if (!robots) {
          robots = document.createElement("meta");
          robots.name = "robots";
          document.head.append(robots);
        }
        robots.content =
          result.demo || result.visibility !== "public"
            ? "noindex, nofollow"
            : "index, follow";
      })
      .catch((e) => {
        if (active)
          setError(e instanceof ApiFailure ? e.code : "UNAVAILABLE");
      });
    return () => {
      active = false;
    };
  }, [
    code,
    refresh,
    access.ready,
    access.principal?.id,
    access.principal?.verified,
  ]);
  async function remix() {
    if (!can(access.principal, "remix")) {
      access.requestAuthentication();
      return;
    }
    setBusy(true);
    setRemixError("");
    try {
      const copy = await api<CloudProject>(
        `/shared/${encodeURIComponent(code)}/remix`,
        "POST",
        {
          title: hostedCopy("remixOf", locale, {
            title: data?.title ?? "",
          }).slice(0, 120),
        },
      );
      setCopyId(copy.id);
    } catch (e) {
      // A failed Remix must not replace the project the visitor is reading.
      setRemixError(e instanceof ApiFailure ? e.code : "UNAVAILABLE");
    } finally {
      setBusy(false);
    }
  }
  if (error === "DEMO_EXPIRED")
    return (
      <Unavailable
        title={hostedCopy("demoExpiredTitle", locale)}
        body={hostedCopy("demoExpiredBody", locale)}
      />
    );
  const hidden =
    data?.visibility === "private" &&
    (!access.principal?.verified || data.author.id !== access.principal.id);
  if (
    ["NOT_FOUND", "INVALID_INPUT", "FORBIDDEN"].includes(error) ||
    (data && hidden)
  )
    return (
      <Unavailable
        title={hostedCopy("projectUnavailableTitle", locale)}
        body={hostedCopy("projectUnavailable", locale)}
      />
    );
  if (error)
    return (
      <Unavailable
        title={hostedCopy("projectUnavailableTitle", locale)}
        body={hostedCopy(`error_${error}`, locale)}
      />
    );
  if (!data || !snapshot)
    return (
      <main className="public-loading">
        <h1>{t("brand", locale)}</h1>
        <p role="status">{hostedCopy("working", locale)}</p>
      </main>
    );
  const foreignDemo = !!data.demo && data.remixable === false;
  return (
    <App
      key={data.revisionId ?? "private"}
      initialProject={snapshot}
      poster={data.previewUrl}
      viewOnly
      viewerHeader={(locale) => {
        const c = (key: string) => hostedCopy(key, locale);
        function openLocal() {
          if (!confirm(c("openProjectConfirm"))) return;
          try {
            localStorage.setItem(projectKey, JSON.stringify(snapshot));
            localStorage.removeItem(cloudLinkKey);
            location.assign("/create");
          } catch {
            setError("UNAVAILABLE");
          }
        }
        return (
          <>
            <h2>{data.title}</h2>
            <p className="viewer-meta">
              {c("byAuthor")} {data.author.displayName} · {c(data.visibility)}
              {data.publishedAt && (
                <>
                  {" · "}
                  <time dateTime={data.publishedAt}>
                    {new Date(data.publishedAt).toLocaleDateString(locale)}
                  </time>
                </>
              )}
              {data.tags.length > 0 &&
                " · " + data.tags.map((tag) => c(`tag_${tag}`)).join(" · ")}
            </p>
            {data.description && (
              <p className="viewer-description">{data.description}</p>
            )}
            <HowToPlay text={snapshot.instructions ?? ""} locale={locale} />
            {data.demo && (
              <p className="demo-shared-note">{c("demoSharedNotice")}</p>
            )}
            <div className="actions">
              {data.ownerProjectId && (
                <a
                  className="button-link primary-link"
                  href={`/create?project=${data.ownerProjectId}`}
                >
                  {c("editOriginal")}
                </a>
              )}
              {/* Visitors: Remix first. Owners: their draft first; copies go to More. */}
              {!data.ownerProjectId && data.revisionId && !foreignDemo && (
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => void remix()}
                >
                  {c(busy ? "working" : "remix")}
                </button>
              )}
              {!data.ownerProjectId && (
                <button onClick={openLocal}>{c("openEditor")}</button>
              )}
              {(data.ownerProjectId ||
                (data.visibility !== "private" && !data.demo) ||
                (can(access.principal, "administer") &&
                  data.revisionId &&
                  !data.demo)) && (
                <Menu id="viewer-more" label={t("more", locale)}>
                  {data.ownerProjectId && (
                    <>
                      {data.revisionId && !foreignDemo && (
                        <button disabled={busy} onClick={() => void remix()}>
                          {c(busy ? "working" : "remix")}
                        </button>
                      )}
                      <button onClick={openLocal}>{c("openEditor")}</button>
                      <ShareControl
                        id={data.ownerProjectId}
                        locale={locale}
                        onChanged={async () => {
                          setData(null);
                          setSnapshot(null);
                          setRefresh((n) => n + 1);
                        }}
                      />
                    </>
                  )}
                  {data.visibility !== "private" && !data.demo && (
                    <ReportControl code={code} locale={locale} />
                  )}
                  {can(access.principal, "administer") &&
                    data.revisionId &&
                    !data.demo && (
                      <ModerationControl
                        code={code}
                        revisionId={data.revisionId}
                        locale={locale}
                        onChanged={() => {
                          setData(null);
                          setSnapshot(null);
                          setRefresh((n) => n + 1);
                        }}
                      />
                    )}
                </Menu>
              )}
            </div>
            <div className="viewer-notes">
              {foreignDemo && (
                <p className="muted">{c("error_DEMO_FOREIGN_REMIX")}</p>
              )}
              {copyId && (
                <p role="status">
                  {c("remixSaved")}{" "}
                  <a href={`/create?project=${copyId}`}>{c("openEditor")}</a> ·{" "}
                  <a href="/me/projects">{c("myProjects")}</a>
                </p>
              )}
              {remixError && <p role="alert">{c(`error_${remixError}`)}</p>}
            </div>
          </>
        );
      }}
    />
  );
}

export function BuiltinViewer({ id }: { id: string }) {
  const [error, setError] = useState("");
  const selected = examples.find((example) => example.id === id);
  if (!selected)
    return (
      <main className="public-loading">
        <p>{hostedCopy("error_NOT_FOUND", readLocale())}</p>
        <a href="/">{hostedCopy("home", readLocale())}</a>
      </main>
    );
  const locale = readLocale();
  const localized = content("examples", examples, locale).find(
    (example) => example.id === id,
  )!;
  const snapshot: Project = {
    ...freshProject(),
    title: localized.title,
    mode: "sandbox",
    sourceCode: localized.code,
    instructions: exampleInstructions(id, locale),
    exampleId: id,
  };
  function openLocal(language: string) {
    if (!confirm(hostedCopy("openProjectConfirm", language))) return;
    try {
      localStorage.setItem(projectKey, JSON.stringify(snapshot));
      localStorage.removeItem(cloudLinkKey);
      location.assign("/create");
    } catch {
      setError("UNAVAILABLE");
    }
  }
  return (
    <App
      initialProject={snapshot}
      viewOnly
      viewerHeader={(language) => {
        const ex = content("examples", examples, language).find(
          (example) => example.id === id,
        )!;
        const c = (key: string) => hostedCopy(key, language);
        return (
          <>
            <h2>{ex.title}</h2>
            {ex.game && <p className="viewer-meta">{t("playable", language)}</p>}
            <p className="viewer-description">{ex.description}</p>
            <HowToPlay text={exampleInstructions(id, language)} locale={language} />
            <div className="actions">
              <button className="primary" onClick={() => openLocal(language)}>
                {c("openEditor")}
              </button>
            </div>
            {error && <p role="alert">{c(`error_${error}`)}</p>}
          </>
        );
      }}
    />
  );
}
