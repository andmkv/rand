import { useRef, useState, type FormEvent } from "react";
import { api, ApiFailure } from "./api";
import { hostedCopy } from "../shared/copy";
import type { Locale } from "./i18n";
import { projectTagIds } from "../shared/tags";
import { isUniformFrame } from "../shared/preview";
import type { RemixCredit } from "../shared/project";
interface ShareState {
  version: number;
  visibility: "private" | "unlisted" | "public";
  title: string;
  description: string;
  tags: string[];
  url: string;
  shortCode: string;
  previewUrl?: string | null;
  remixedFrom?: RemixCredit | null;
}
type Visibility = ShareState["visibility"];
const tiles: { value: Visibility; title: string; hint: string }[] = [
  { value: "private", title: "shareTilePrivate", hint: "shareHintPrivate" },
  { value: "unlisted", title: "shareTileUnlisted", hint: "shareHintUnlisted" },
  { value: "public", title: "shareTilePublic", hint: "shareHintPublic" },
];
export function ShareControl({
  id,
  locale,
  ready = true,
  onChanged,
  capture,
  screenshot,
}: {
  id: string;
  locale: Locale;
  ready?: boolean;
  onChanged: (id: string) => Promise<void>;
  /** Current SCREEN as palette indices; only sent when the child chooses it. */
  capture?: () => string;
  /** Current SCREEN as an image for the picture choice. */
  screenshot?: () => string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, setState] = useState<ShareState | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [visibility, setVisibility] = useState<Visibility>("private"),
    [picture, setPicture] = useState<"saved" | "current">("saved"),
    [frame, setFrame] = useState<{ blank: boolean; image: string } | null>(null);
  const c = (key: string, params?: Record<string, string>) =>
    hostedCopy(key, locale, params);
  async function load() {
    const next = await api<ShareState>(`/projects/${id}/share`);
    setState(next);
    setVisibility(next.visibility);
    return next;
  }
  function look(next: ShareState | null) {
    if (!capture) return setFrame(null);
    try {
      const blank = isUniformFrame(capture());
      setFrame({ blank, image: blank ? "" : (screenshot?.() ?? "") });
      // Without a saved picture the current SCREEN is the natural first choice.
      setPicture(!blank && !next?.previewUrl ? "current" : "saved");
    } catch {
      setFrame(null);
    }
  }
  async function show() {
    dialog.current?.showModal();
    setError("");
    setNotice("");
    setState(null);
    setBusy(true);
    try {
      look(await load());
    } catch (e) {
      setError(e instanceof ApiFailure ? e.code : "UNAVAILABLE");
    } finally {
      setBusy(false);
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!state) return;
    setError("");
    setNotice("");
    const data = new FormData(event.currentTarget);
    if (visibility !== "private" && !String(data.get("title")).trim()) {
      setError("REQUIRED_TITLE");
      return;
    }
    setBusy(true);
    try {
      await api(`/projects/${id}/share`, "POST", {
        version: state.version,
        visibility,
        ...(visibility !== "private"
          ? {
              title: String(data.get("title")),
              description: String(data.get("description")),
              tags: data.getAll("tags"),
              // Visibility changes alone never touch the picture.
              ...(capture && picture === "current" && frame && !frame.blank
                ? { previewPixels: capture() }
                : {}),
            }
          : {}),
      });
      await onChanged(id);
      const next = await load();
      setNotice(
        next.visibility === "public"
          ? "shareNowPublic"
          : next.visibility === "unlisted"
            ? "shareNowUnlisted"
            : "shareNowPrivate",
      );
      setPicture("saved");
    } catch (e) {
      setError(e instanceof ApiFailure ? e.code : "UNAVAILABLE");
    } finally {
      setBusy(false);
    }
  }
  async function rotate() {
    if (!state || !confirm(c("confirmRotate"))) return;
    setBusy(true);
    try {
      await api(`/projects/${id}/share/rotate`, "POST", {
        version: state.version,
      });
      await onChanged(id);
      await load();
      setNotice("linkRotated");
    } catch (e) {
      setError(e instanceof ApiFailure ? e.code : "UNAVAILABLE");
    } finally {
      setBusy(false);
    }
  }
  async function copyLink() {
    if (!state) return;
    try {
      await navigator.clipboard.writeText(state.url);
      setNotice("linkCopied");
    } catch {
      setNotice("copyManually");
    }
  }
  const credit = state?.remixedFrom;
  return (
    <>
      <button onClick={() => void show()}>{c("share")}</button>
      <dialog
        ref={dialog}
        className="account-dialog share-dialog"
        aria-label={c("share")}
      >
        <div className="dialog-heading">
          <h2>{c("share")}</h2>
          <button onClick={() => dialog.current?.close()}>{c("close")}</button>
        </div>
        <p className="share-lead">{c("shareSimple")}</p>
        {!ready && <p>{c("waitForSave")}</p>}
        {state && (
          <form
            key={`${state.version}-${state.visibility}`}
            onSubmit={submit}
            noValidate
          >
            <fieldset className="visibility-tiles">
              <legend>{c("visibility")}</legend>
              {tiles.map((tile) => (
                <label
                  key={tile.value}
                  className={visibility === tile.value ? "tile selected" : "tile"}
                >
                  <input
                    type="radio"
                    name="visibility"
                    value={tile.value}
                    checked={visibility === tile.value}
                    onChange={() => setVisibility(tile.value)}
                  />
                  <strong>{c(tile.title)}</strong>
                  <span>{c(tile.hint)}</span>
                </label>
              ))}
            </fieldset>
            {state.visibility !== "private" && (
              <div className="share-link">
                <label>
                  {c("shareLink")}
                  <input
                    value={state.url}
                    readOnly
                    onFocus={(e) => e.target.select()}
                  />
                </label>
                <div className="actions">
                  <button type="button" onClick={() => void copyLink()}>
                    {c("copyLink")}
                  </button>
                  <a
                    href={`/p/${state.shortCode}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {c("viewShared")}
                  </a>
                  {state.visibility === "unlisted" && (
                    <button
                      type="button"
                      disabled={busy || !ready}
                      onClick={() => void rotate()}
                    >
                      {c("rotateLink")}
                    </button>
                  )}
                </div>
              </div>
            )}
            {visibility !== "private" && (
              <fieldset className="picture-choice">
                <legend>{c("sharePicture")}</legend>
                <label className="picture-option">
                  <input
                    type="radio"
                    name="picture"
                    checked={picture === "saved"}
                    onChange={() => setPicture("saved")}
                  />
                  {state.previewUrl ? (
                    <img src={state.previewUrl} alt="" width="128" height="96" />
                  ) : (
                    <span className="picture-empty" aria-hidden="true" />
                  )}
                  <span>{c(state.previewUrl ? "pictureKeep" : "pictureNone")}</span>
                </label>
                {frame && !frame.blank && (
                  <label className="picture-option">
                    <input
                      type="radio"
                      name="picture"
                      checked={picture === "current"}
                      onChange={() => setPicture("current")}
                    />
                    <img src={frame.image} alt="" width="128" height="96" />
                    <span>{c("pictureCurrent")}</span>
                  </label>
                )}
                {frame?.blank && <small>{c("pictureBlank")}</small>}
              </fieldset>
            )}
            {visibility !== "private" && (
              <details open={!state.title.trim()}>
                <summary>{c("shareDetails")}</summary>
                <label>
                  {c("cloudTitle")}
                  <input
                    name="title"
                    defaultValue={state.title}
                    maxLength={120}
                  />
                </label>
                <label>
                  {c("description")}
                  <textarea
                    name="description"
                    defaultValue={state.description}
                    maxLength={2000}
                  />
                </label>
                <fieldset>
                  <legend>{c("tags")}</legend>
                  {projectTagIds.map((tag) => (
                    <label className="checkbox-label" key={tag}>
                      <input
                        type="checkbox"
                        name="tags"
                        value={tag}
                        defaultChecked={state.tags.includes(tag)}
                      />
                      {c(`tag_${tag}`)}
                    </label>
                  ))}
                </fieldset>
                <small>{c("publicationPrivacyHint")}</small>
              </details>
            )}
            {credit && (
              <small>
                {credit.title
                  ? c("remixCredit", {
                      title: credit.title,
                      author: credit.author ?? "",
                    })
                  : c("remixCreditGone")}
              </small>
            )}
            <details>
              <summary>{c("shareMore")}</summary>
              <p>{c("shareHelp")}</p>
              <p>{c(capture ? "previewCaptureHint" : "previewFromEditor")}</p>
            </details>
            <div className="share-footer">
              <button className="primary" disabled={busy || !ready}>
                {c(busy ? "working" : "updatePublication")}
              </button>
              {notice && (
                <span role="status" className="account-notice">
                  {c(notice)}
                </span>
              )}
              {error && (
                <span role="alert" className="account-error">
                  {c(error === "REQUIRED_TITLE" ? "requiredField" : `error_${error}`)}
                </span>
              )}
            </div>
          </form>
        )}
        {!state && error && <p role="alert">{c(`error_${error}`)}</p>}
      </dialog>
    </>
  );
}
