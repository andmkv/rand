import { useCallback, useEffect, useRef, useState } from "react";
import { PolicyLinks } from "./Privacy";
import { AccountControl } from "./Account";
import { useAccess } from "./Access";
import { useLocale } from "./useLocale";
import { api, ApiFailure } from "./api";
import { examples } from "./content/examples";
import { content, locales, t, type Locale } from "./i18n";
import { hostedCopy } from "../shared/copy";
import { can } from "../shared/permissions";
import { projectTagIds } from "../shared/tags";
import type { GalleryPage, GalleryProject } from "../shared/project";
import { ExamplePreview, PixelPreview, ProjectPreview } from "./Preview";
import { bookText } from "./book/ui";
export function Home() {
  const { locale, chooseLocale } = useLocale(),
    access = useAccess();
  const [rows, setRows] = useState<GalleryProject[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [query, setQuery] = useState(""),
    [search, setSearch] = useState(""),
    [tag, setTag] = useState(""),
    [sort, setSort] = useState("recent"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const c = (key: string) => hostedCopy(key, locale);
  const demo = !!access.principal?.demo;
  const load = useCallback(
    async (next?: string) => {
      if (!access.ready) return;
      const request = ++generation.current;
      setBusy(true);
      try {
        const params = new URLSearchParams({
          sort,
          ...(search ? { q: search } : {}),
          ...(tag ? { tag } : {}),
          ...(next ? { cursor: next } : {}),
        });
        const page = await api<GalleryPage>(`/gallery?${params}`);
        if (request !== generation.current) return;
        setRows((old) => (next ? [...old, ...page.projects] : page.projects));
        setCursor(page.nextCursor);
        setError("");
      } catch (e) {
        if (request !== generation.current) return;
        setError(e instanceof ApiFailure ? e.code : "UNAVAILABLE");
      } finally {
        if (request === generation.current) setBusy(false);
      }
    },
    [search, tag, sort, access.ready, access.principal?.demo],
  );
  useEffect(() => {
    if (!access.ready) return;
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 30000);
    return () => {
      clearInterval(timer);
      generation.current++;
    };
  }, [load, access.ready]);
  useEffect(() => {
    document.title = `Randomize USR · ${hostedCopy("home", locale)}`;
    let meta = document.querySelector<HTMLMetaElement>(
      'meta[name="description"]',
    );
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "description";
      document.head.append(meta);
    }
    meta.content = hostedCopy("homeIntro", locale);
  }, [locale]);
  async function feature(p: GalleryProject) {
    try {
      await api(`/admin/featured/${p.shortCode}`, "PATCH", {
        featured: !p.featured,
        revisionId: p.revisionId,
      });
      await load();
    } catch (e) {
      setError(e instanceof ApiFailure ? e.code : "UNAVAILABLE");
    }
  }
  return (
    <main className="public-home">
      <div className="home-content">
        <header className="home-header">
          <div>
            <h1>{t("brand", locale)}</h1>
            <p>{c("homeIntro")}</p>
          </div>
          <nav className="actions">
            <a href="/book">{bookText(locale, "title")}</a>
            {can(access.principal, "cloudProjects") && (
              <a href="/me/projects">{c("myProjects")}</a>
            )}
            {can(access.principal, "administer") && (
              <a href="/admin">{c("adminConsole")}</a>
            )}
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
        <section className="home-hero" aria-label={c("startHere")}>
          <a className="hero-start" href="/create?mode=story">
            <span>{c("startStory")}</span>
            <small>{c("startStoryHint")}</small>
          </a>
          <a className="hero-sandbox button-link" href="/create?mode=sandbox">
            {c("openSandbox")}
          </a>
          <a className="hero-sandbox button-link" href="/book">
            {bookText(locale, "title")}
          </a>
        </section>
        <section
          className="home-section"
          id="examples"
          aria-label={t("examples", locale)}
        >
          <div className="section-heading">
            <h2>{t("examples", locale)}</h2>
            <p>{c("examplesIntro")}</p>
          </div>
          {[true, false].map((games) => (
            <div key={String(games)}>
              <h3 className="example-group">
                {t(games ? "games" : "toys", locale)}
              </h3>
              <div className="gallery-grid">
                {content("examples", examples, locale)
                  .filter((ex) => !!ex.game === games)
                  .map((ex) => (
                    <article className="gallery-card" key={ex.id}>
                      <a className="preview-link" href={`/examples/${ex.id}`}>
                        <ExamplePreview
                          id={ex.id}
                          title={ex.title}
                          assetId={ex.code.match(/SPAWN\("([a-z0-9-]+)"/i)?.[1]}
                        />
                      </a>
                      <div className="gallery-card-copy">
                        <h3>{ex.title}</h3>
                        {ex.game && (
                          <span className="eyebrow">{t("playable", locale)}</span>
                        )}
                        <p>{ex.description}</p>
                        <a className="button-link" href={`/examples/${ex.id}`}>
                          {c("tryExample")}
                        </a>
                      </div>
                    </article>
                  ))}
              </div>
            </div>
          ))}
        </section>
        <section
          className="home-section"
          aria-label={c(demo ? "demoGalleryTitle" : "communityGallery")}
        >
          <div className="section-heading">
            <h2>{c(demo ? "demoGalleryTitle" : "communityGallery")}</h2>
            <p>{c(demo ? "demoGalleryIntro" : "galleryIntro")}</p>
          </div>
          {(rows.length > 0 || search || tag || sort !== "recent") && (
            <>
          <form
            className="gallery-search actions"
            onSubmit={(e) => {
              e.preventDefault();
              setSearch(query);
            }}
          >
            <label>
              {c("searchProjects")}
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                maxLength={120}
              />
            </label>
            <label>
              {c("tags")}
              <select
                aria-label={c("tags")}
                value={tag}
                onChange={(e) => setTag(e.target.value)}
              >
                <option value="">{c("allTags")}</option>
                {projectTagIds.map((t) => (
                  <option key={t} value={t}>
                    {c(`tag_${t}`)}
                  </option>
                ))}
              </select>
            </label>
            <button>{c("search")}</button>
          </form>
          <nav className="actions gallery-order" aria-label={c("galleryOrder")}>
            <button
              aria-pressed={sort === "recent"}
              onClick={() => setSort("recent")}
            >
              {c("recent")}
            </button>
            <button
              aria-pressed={sort === "featured"}
              onClick={() => setSort("featured")}
            >
              {c("featured")}
            </button>
          </nav>
            </>
          )}
          {error && (
            <p role="alert">
              {c("galleryUnavailable")}{" "}
              <button onClick={() => void load()}>{c("retry")}</button>
            </p>
          )}
          {!busy && !error && !rows.length && (
            <div className="gallery-empty">
              <PixelPreview title={c("galleryEmptyTitle")} seed="gallery" />
              <div>
                <h3>{c("galleryEmptyTitle")}</h3>
                <p>{c(search || tag ? "emptyGallery" : "galleryEmptyBody")}</p>
                <a className="button-link primary-link" href="/create">
                  {c("galleryEmptyCta")}
                </a>
              </div>
            </div>
          )}
          <div className={"gallery-grid" + (rows.length < 5 ? " few" : "")}>
            {rows.map((p) => (
              <article className="gallery-card" key={p.shortCode}>
                <a className="preview-link" href={`/p/${p.shortCode}`}>
                  {demo && <span className="demo-tag">{c("demoBadge")}</span>}
                  <ProjectPreview
                    title={p.title}
                    seed={p.shortCode}
                    url={p.previewUrl}
                  />
                </a>
                <div className="gallery-card-copy">
                  <h3>{p.title}</h3>
                  <p className="muted">
                    {c("byAuthor")} {p.author} ·{" "}
                    {new Date(p.publishedAt).toLocaleDateString(locale)}
                  </p>
                  <p>{p.description}</p>
                  <p className="eyebrow">
                    {p.tags.map((tag) => c(`tag_${tag}`)).join(" · ")}
                  </p>
                  <div className="actions">
                    <a className="button-link" href={`/p/${p.shortCode}`}>
                      {c("viewRun")}
                    </a>
                    {can(access.principal, "administer") && (
                      <button onClick={() => void feature(p)}>
                        {c(p.featured ? "unfeature" : "feature")}
                      </button>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
          {cursor && (
            <button disabled={busy} onClick={() => void load(cursor)}>
              {c("loadMore")}
            </button>
          )}
        </section>
        <PolicyLinks locale={locale} />
      </div>
    </main>
  );
}
