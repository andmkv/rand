/**
 * The Randomize USR Handbook reader: /book, /book/<chapter>, /book/print.
 *
 * Public, no account. Text comes from book/<locale>/*.md (see book/README.md); this file only renders
 * it. Everything is rendered as React elements from a parsed tree, never as injected HTML.
 */
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import "./book.css";
import { useLocale } from "./useLocale";
import { locales, type Locale } from "./i18n";
import { bookText, type BookUiKey } from "./book/ui";
import {
  bookAssets,
  bookInfo,
  loadBook,
  order,
  partIds,
  partTitle,
  translatedCount,
  type Chapter,
} from "./book/content";
import {
  headings as headingsOf,
  type Block,
  type Inline,
} from "./book/markdown";
import { commands, functions, methods } from "./runtime/engine";
import type { ProjectAssetManifestV1 } from "../shared/assets";
import { scanBasicLine } from "./editor/tokens";
import {
  downloadProject,
  inspectLocalWork,
  openExample,
  type LocalWork,
} from "./book/sandbox";
import { searchBook, type Hit } from "./book/search";

const KEYWORDS = new Set(
  "FOR TO STEP NEXT IF THEN ELSE END DO LOOP AND OR NOT LET INPUT TRUE FALSE".split(" "),
);
const COMMANDS = new Set<string>(commands);
const FUNCTIONS = new Set<string>(functions);
const METHODS = new Set(methods.map((m) => "." + m));

function highlight(code: string): ReactNode[] {
  return code.split("\n").map((line, row) => {
    const out: ReactNode[] = [];
    let at = 0;
    scanBasicLine(line).forEach((tok, n) => {
      if (tok.from > at) out.push(line.slice(at, tok.from));
      let cls = "";
      const upper = tok.text.toUpperCase();
      if (tok.kind === "comment") cls = "tk-comment";
      else if (tok.kind === "string") cls = "tk-string";
      else if (tok.kind === "number") cls = "tk-number";
      else if (tok.kind === "property")
        cls = METHODS.has(upper) ? "tk-method" : "tk-prop";
      else if (tok.kind === "word") {
        if (KEYWORDS.has(upper)) cls = "tk-keyword";
        else if (COMMANDS.has(upper)) cls = "tk-command";
        else if (FUNCTIONS.has(upper)) cls = "tk-function";
      } else if (tok.kind === "operator") cls = "tk-operator";
      out.push(
        cls ? (
          <span key={n} className={cls}>
            {tok.text}
          </span>
        ) : (
          tok.text
        ),
      );
      at = tok.to;
    });
    if (at < line.length) out.push(line.slice(at));
    return (
      <Fragment key={row}>
        {out}
        {row < code.split("\n").length - 1 ? "\n" : ""}
      </Fragment>
    );
  });
}

function Inlines({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.t) {
          case "text":
            return <Fragment key={i}>{n.v}</Fragment>;
          case "code":
            return <code key={i}>{n.v}</code>;
          case "strong":
            return (
              <strong key={i}>
                <Inlines nodes={n.c} />
              </strong>
            );
          case "em":
            return (
              <em key={i}>
                <Inlines nodes={n.c} />
              </em>
            );
          case "link": {
            const external = /^https?:/i.test(n.href);
            return (
              <a
                key={i}
                href={n.href}
                {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              >
                <Inlines nodes={n.c} />
              </a>
            );
          }
        }
      })}
    </>
  );
}

const calloutKey = {
  note: "calloutNote",
  tip: "calloutTip",
  warning: "calloutWarning",
  important: "calloutImportant",
} as const;
type Say = (key: BookUiKey, params?: Record<string, string | number>) => string;

function CodeBlock({
  block,
  chapter,
  say,
  askOpen,
  interactive,
}: {
  block: Extract<Block, { t: "code" }>;
  chapter: Chapter;
  say: Say;
  askOpen: (code: string, title: string, assets?: ProjectAssetManifestV1) => void;
  interactive: boolean;
}) {
  const [copied, setCopied] = useState<"" | "ok" | "fail">("");
  const basic = block.lang === "basic";
  const fragment = !!block.attrs.fragment;
  const title =
    typeof block.attrs.title === "string" ? block.attrs.title : chapter.title;
  async function copy() {
    try {
      await navigator.clipboard.writeText(block.code);
      setCopied("ok");
    } catch {
      setCopied("fail");
    }
    setTimeout(() => setCopied(""), 2500);
  }
  return (
    <figure className={"code-block" + (basic ? " basic" : "")}>
      {basic && (
        <figcaption>
          <span className="code-lang">BASIC</span>
          <span className="code-note">{fragment ? say("fragment") : say("checked")}</span>
          {block.attrs.assets && <span className="code-note">{say("assetsNote")}</span>}
        </figcaption>
      )}
      <pre tabIndex={0} aria-label={basic ? `BASIC · ${title}` : block.lang}>
        <code>{basic ? highlight(block.code) : block.code}</code>
      </pre>
      {interactive && (
        <div className="code-actions">
          <button type="button" onClick={() => void copy()}>
            {copied === "ok" ? say("copied") : say("copy")}
          </button>
          {basic && !fragment && (
            <button
              type="button"
              className="primary"
              onClick={() =>
                askOpen(
                  block.code,
                  title,
                  typeof block.attrs.assets === "string" ? bookAssets(block.attrs.assets) : undefined,
                )
              }
            >
              {say("openSandbox")}
            </button>
          )}
          <span role="status" className="code-status">
            {copied === "fail" ? say("copyFailed") : ""}
          </span>
        </div>
      )}
    </figure>
  );
}

function Blocks({
  blocks,
  ...ctx
}: {
  blocks: Block[];
  chapter: Chapter;
  say: Say;
  askOpen: (code: string, title: string, assets?: ProjectAssetManifestV1) => void;
  interactive: boolean;
  anchors: boolean;
}) {
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.t) {
          case "heading": {
            const Tag = `h${Math.min(6, b.level)}` as "h2";
            if (b.level === 1) return null;
            return (
              <Tag key={i} id={ctx.anchors ? b.id : undefined} tabIndex={-1}>
                <Inlines nodes={b.c} />
                {ctx.anchors && (
                  <a
                    className="anchor"
                    href={`#${b.id}`}
                    aria-label={`${ctx.say("sectionLink")}: ${b.text}`}
                  >
                    #
                  </a>
                )}
              </Tag>
            );
          }
          case "para":
            return (
              <p key={i}>
                <Inlines nodes={b.c} />
              </p>
            );
          case "list": {
            const List = b.ordered ? "ol" : "ul";
            return (
              <List key={i}>
                {b.items.map((item, n) => (
                  <li key={n}>
                    {item.length === 1 && item[0].t === "para" ? (
                      <Inlines nodes={item[0].c} />
                    ) : (
                      <Blocks blocks={item} {...ctx} />
                    )}
                  </li>
                ))}
              </List>
            );
          }
          case "quote":
            return (
              <div key={i} role="note" className={"callout " + (b.kind ?? "quote")}>
                {b.kind && (
                  <strong className="callout-kind">
                    {bookText(ctx.chapter.language as Locale, calloutKey[b.kind])}
                  </strong>
                )}
                <Blocks blocks={b.blocks} {...ctx} />
              </div>
            );
          case "code":
            return (
              <CodeBlock
                key={i}
                block={b}
                chapter={ctx.chapter}
                say={ctx.say}
                askOpen={ctx.askOpen}
                interactive={ctx.interactive}
              />
            );
          case "table":
            return (
              <div className="table-wrap" key={i} tabIndex={0} role="region" aria-label={ctx.chapter.title}>
                <table>
                  <thead>
                    <tr>
                      {b.head.map((c, n) => (
                        <th key={n}>
                          <Inlines nodes={c} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((row, r) => (
                      <tr key={r}>
                        {row.map((c, n) => (
                          <td key={n}>
                            <Inlines nodes={c} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "details":
            return (
              <details key={i} className="hint" open={!ctx.interactive || undefined}>
                <summary>
                  <Inlines nodes={b.summary} />
                </summary>
                <Blocks blocks={b.blocks} {...ctx} />
              </details>
            );
          case "hr":
            return <hr key={i} />;
        }
      })}
    </>
  );
}

function SandboxDialog({
  pending,
  work,
  say,
  onClose,
}: {
  pending: { code: string; title: string; assets?: ProjectAssetManifestV1 };
  work: LocalWork;
  say: Say;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    // The safe choice gets the focus; Escape and Cancel both leave everything untouched.
    cancel.current?.focus();
  }, []);
  return (
    <dialog
      ref={ref}
      className="book-dialog"
      aria-labelledby="sandbox-title"
      onClose={onClose}
      onCancel={onClose}
    >
      <h2 id="sandbox-title">{say("sandboxTitle")}</h2>
      <p>
        {say("sandboxBody", {
          title: work.project.title || say("untitled"),
          lines: work.lines,
        })}
      </p>
      {failed && <p role="alert">{say("loadFailed")}</p>}
      <div className="actions">
        <button type="button" onClick={() => downloadProject(work.project)}>
          {say("sandboxDownload")}
        </button>
        <button
          type="button"
          className="primary"
          onClick={() => {
            try {
              openExample(pending.code, pending.title, pending.assets);
            } catch {
              setFailed(true);
            }
          }}
        >
          {say("sandboxReplace")}
        </button>
        <button type="button" ref={cancel} onClick={onClose}>
          {say("cancel")}
        </button>
      </div>
    </dialog>
  );
}

function Toc({
  chapters,
  current,
  locale,
  say,
}: {
  chapters: Chapter[];
  current?: string;
  locale: Locale;
  say: Say;
}) {
  return (
    <nav aria-label={say("chapters")} className="toc">
      <a className={"toc-home" + (!current ? " current" : "")} href="/book" aria-current={!current ? "page" : undefined}>
        {say("home")}
      </a>
      {partIds.map((part) => {
        const list = chapters.filter((c) => c.part === part);
        if (!list.length) return null;
        return (
          <section key={part}>
            <p className="toc-part">{partTitle(part, locale)}</p>
            <ol start={list[0].number}>
              {list.map((c) => (
                <li key={c.slug}>
                  <a
                    href={`/book/${c.slug}`}
                    className={current === c.slug ? "current" : ""}
                    aria-current={current === c.slug ? "page" : undefined}
                  >
                    {c.title}
                    {c.fallback && <span className="fb"> · EN</span>}
                  </a>
                </li>
              ))}
            </ol>
          </section>
        );
      })}
    </nav>
  );
}

function Results({ hits, query, say }: { hits: Hit[]; query: string; say: Say }) {
  return (
    <div className="results" role="region" aria-label={say("search")}>
      <p role="status" className="results-status">
        {hits.length
          ? say("searchResults", { q: query, n: hits.length })
          : say("searchEmpty", { q: query })}
      </p>
      <ol>
        {hits.map((h) => (
          <li key={h.slug + h.id}>
            <a href={`/book/${h.slug}${h.id ? "#" + h.id : ""}`}>
              <strong>{h.chapter}</strong>
              {h.heading && h.heading !== h.chapter && <span> › {h.heading}</span>}
            </a>
            <p>
              {h.before}
              <mark>{h.match}</mark>
              {h.after}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}

function downloadMarkdown(chapters: Chapter[], locale: Locale) {
  const language = chapters.every((c) => c.language === locale) ? locale : "en";
  const text = chapters
    .map((c) => c.source.trim())
    .join("\n\n---\n\n")
    .concat("\n");
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `randomize-usr-handbook-${language}.md`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Book() {
  const { locale, chooseLocale } = useLocale();
  const say: Say = useCallback(
    (key, params) => bookText(locale, key, params),
    [locale],
  );
  const path = location.pathname.replace(/\/+$/, "");
  const slug = path.split("/")[2] ?? "";
  const printAll = slug === "print";
  const [chapters, setChapters] = useState<Chapter[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [tocOpen, setTocOpen] = useState(false);
  const [pending, setPending] = useState<{ code: string; title: string; assets?: ProjectAssetManifestV1 } | null>(null);
  const [work, setWork] = useState<LocalWork | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    setFailed(false);
    setChapters(null);
    loadBook(locale).then(setChapters, () => setFailed(true));
  }, [locale]);
  useEffect(load, [load]);

  const index = chapters?.findIndex((c) => c.slug === slug) ?? -1;
  const chapter = chapters && index >= 0 ? chapters[index] : undefined;
  const isHome = slug === "";
  const unknown = chapters && !isHome && !printAll && !chapter;

  useEffect(() => {
    document.documentElement.lang = chapter?.fallback ? "en" : locale;
    const base = `Randomize USR · ${say("title")}`;
    document.title = chapter ? `${chapter.title} · ${base}` : base;
  }, [chapter, locale, say]);

  // Land on the chapter heading (or the requested section) so keyboard and screen-reader users start at the text.
  useEffect(() => {
    if (!chapters) return;
    const id = decodeURIComponent(location.hash.slice(1));
    const target = id ? document.getElementById(id) : null;
    if (target) {
      target.scrollIntoView();
      target.focus({ preventScroll: true });
    } else if (!printAll) {
      // Never take the focus away from someone who has already started typing in the search box.
      const active = document.activeElement;
      if (!active || active === document.body) titleRef.current?.focus({ preventScroll: true });
      pageRef.current?.scrollTo(0, 0);
    }
  }, [chapters, slug, printAll]);

  const hits = useMemo(
    () => (chapters && query.trim().length > 1 ? searchBook(chapters, query.trim()) : null),
    [chapters, query],
  );

  const askOpen = useCallback((code: string, title: string, assets?: ProjectAssetManifestV1) => {
    const local = inspectLocalWork(code);
    if (!local.worthKeeping) {
      try {
        openExample(code, title, assets);
        return;
      } catch {
        /* storage is blocked: fall through to the dialog, which reports it */
      }
    }
    setWork(local);
    setPending({ code, title, assets });
  }, []);

  const translated = translatedCount(locale);
  const language = locales.find((l) => l.id === locale)?.name ?? locale;

  const prev = index > 0 ? chapters![index - 1] : undefined;
  const next = chapters && index >= 0 && index < chapters.length - 1 ? chapters[index + 1] : undefined;

  const body = (
    <>
      {chapter && (
        <article className="chapter" lang={chapter.language}>
          <nav className="crumbs" aria-label="Breadcrumb">
            <a href="/book">{say("title")}</a>
            <span aria-hidden="true"> › </span>
            <span>{partTitle(chapter.part, locale)}</span>
          </nav>
          {chapter.fallback && (
            <p className="fallback" role="note">
              {say("fallbackNotice", { language })}
            </p>
          )}
          <p className="eyebrow">
            {partTitle(chapter.part, locale)} · {chapter.number}/{order.length}
          </p>
          <h1 ref={titleRef} tabIndex={-1}>
            {chapter.title}
          </h1>
          <p className="lede">{chapter.summary}</p>
          <details className="on-page">
            <summary>{say("onThisPage")}</summary>
            <ul>
              {headingsOf(chapter.doc.blocks)
                .filter((h) => h.level === 2)
                .map((h) => (
                  <li key={h.id}>
                    <a href={`#${h.id}`}>{h.text}</a>
                  </li>
                ))}
            </ul>
          </details>
          <Blocks
            blocks={chapter.doc.blocks}
            chapter={chapter}
            say={say}
            askOpen={askOpen}
            interactive
            anchors
          />
          <nav className="pager" aria-label={say("chapters")}>
            {prev ? (
              <a rel="prev" href={`/book/${prev.slug}`}>
                <small>← {say("prev")}</small>
                <span>{prev.title}</span>
              </a>
            ) : (
              <a rel="prev" href="/book">
                <small>← {say("home")}</small>
              </a>
            )}
            {next && (
              <a rel="next" href={`/book/${next.slug}`}>
                <small>{say("next")} →</small>
                <span>{next.title}</span>
              </a>
            )}
          </nav>
        </article>
      )}
      {isHome && chapters && (
        <article className="chapter home">
          <p className="eyebrow">{say("subtitle")}</p>
          <h1 ref={titleRef} tabIndex={-1}>
            {say("title")}
          </h1>
          <p className="lede">{say("intro")}</p>
          <div className="callout tip" role="note">
            <strong className="callout-kind">{say("startHere")}</strong>
            <p>{say("startHereBody")}</p>
            <p>
              <a className="button-link primary-link" href={`/book/${chapters[0].slug}`}>
                {chapters[0].title} →
              </a>
            </p>
          </div>
          {locale !== "en" && translated < order.length && (
            <p className="fallback" role="note">
              {say("fallbackHome", { done: translated, total: order.length, language })}
            </p>
          )}
          {partIds.map((part) => (
            <section key={part} className="home-part">
              <h2>{partTitle(part, locale)}</h2>
              <ol start={chapters.find((c) => c.part === part)!.number}>
                {chapters
                  .filter((c) => c.part === part)
                  .map((c) => (
                    <li key={c.slug}>
                      <a href={`/book/${c.slug}`}>{c.title}</a>
                      {c.fallback && <span className="fb"> · EN</span>}
                      <p>{c.summary}</p>
                    </li>
                  ))}
              </ol>
            </section>
          ))}
          <section className="home-part offline-home">
            <h2>{say("offline")}</h2>
            <div className="actions">
              <button type="button" onClick={() => downloadMarkdown(chapters, locale)}>
                {say("download")}
              </button>
              <a className="button-link" href="/book/print">
                {say("printAll")}
              </a>
            </div>
          </section>
          <p className="muted version">
            {say("version", {
              version: bookInfo.version,
              date: bookInfo.updated,
              build: bookInfo.build,
            })}
          </p>
        </article>
      )}
      {printAll &&
        chapters?.map((c) => (
          <article className="chapter print-chapter" key={c.slug} lang={c.language}>
            <p className="eyebrow">
              {partTitle(c.part, locale)} · {c.number}/{order.length}
            </p>
            <h1>{c.title}</h1>
            <p className="lede">{c.summary}</p>
            <Blocks
              blocks={c.doc.blocks}
              chapter={c}
              say={say}
              askOpen={askOpen}
              interactive={false}
              anchors={false}
            />
          </article>
        ))}
      {unknown && (
        <article className="chapter">
          <h1 ref={titleRef} tabIndex={-1}>
            {say("notFound")}
          </h1>
          <p>{say("notFoundBody")}</p>
          <p>
            <a className="button-link" href="/book">
              {say("home")}
            </a>
          </p>
        </article>
      )}
    </>
  );

  return (
    <div className="book-page" ref={pageRef}>
      <a className="skip" href="#book-main">
        {say("skip")}
      </a>
      <header className="book-header">
        <a className="brand" href="/book">
          Randomize USR <span>{say("title")}</span>
        </a>
        <nav className="book-tools" aria-label={say("nav")}>
          <a href="/">{say("homePage")}</a>
          <a href="/create?mode=sandbox">{say("openEditor")}</a>
          <label className="lang">
            <span className="sr-only">{say("language")}</span>
            <select
              aria-label={say("language")}
              value={locale}
              onChange={(e) => chooseLocale(e.target.value as Locale)}
            >
              {locales.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
        </nav>
      </header>
      <div className={"book-layout" + (printAll ? " print-all" : "")}>
        {!printAll && (
          <aside className="book-side">
            <form role="search" onSubmit={(e) => e.preventDefault()}>
              <label htmlFor="book-search">{say("search")}</label>
              <div className="search-row">
                <input
                  id="book-search"
                  type="search"
                  value={query}
                  placeholder={say("searchPlaceholder")}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setQuery("");
                  }}
                  autoComplete="off"
                />
                {query && (
                  <button type="button" onClick={() => setQuery("")}>
                    {say("clearSearch")}
                  </button>
                )}
              </div>
            </form>
            {hits ? (
              <Results hits={hits} query={query.trim()} say={say} />
            ) : (
              <>
                <button
                  type="button"
                  className="toc-toggle"
                  aria-expanded={tocOpen}
                  aria-controls="book-toc"
                  onClick={() => setTocOpen(!tocOpen)}
                >
                  {say("contents")}
                </button>
                <div id="book-toc" className={"toc-wrap" + (tocOpen ? " open" : "")}>
                  {chapters && (
                    <Toc chapters={chapters} current={chapter?.slug} locale={locale} say={say} />
                  )}
                  {chapters && (
                    <div className="offline">
                      <p className="toc-part">{say("offline")}</p>
                      <button type="button" onClick={() => downloadMarkdown(chapters, locale)}>
                        {say("download")}
                      </button>
                      <a className="button-link" href="/book/print">
                        {say("printAll")}
                      </a>
                    </div>
                  )}
                </div>
              </>
            )}
          </aside>
        )}
        <main id="book-main" className="book-main">
          {printAll && (
            <div className="print-bar">
              <button type="button" className="primary" onClick={() => window.print()}>
                {say("print")}
              </button>
              <a href="/book">{say("home")}</a>
            </div>
          )}
          {!chapters && !failed && <p role="status">{say("loading")}</p>}
          {failed && (
            <p role="alert">
              {say("loadFailed")} <button onClick={load}>{say("retry")}</button>
            </p>
          )}
          {body}
          {chapter && (
            <p className="print-link">
              <button type="button" onClick={() => window.print()}>
                {say("print")}
              </button>
            </p>
          )}
        </main>
      </div>
      {pending && work && (
        <SandboxDialog
          pending={pending}
          work={work}
          say={say}
          onClose={() => {
            setPending(null);
            setWork(null);
          }}
        />
      )}
    </div>
  );
}
