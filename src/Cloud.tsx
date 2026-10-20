import { cloudLinkKey } from "./cloudStorage";
import { ProjectPreview } from "./Preview";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAccess } from "./Access";
import { ShareControl } from "./Share";
import { isUniformFrame } from "../shared/preview";
import { HistoryControl } from "./History";
import { api, ApiFailure } from "./api";
import { parseProject, projectKey, type Project } from "./project";
import {
  adoptOpenedProject,
  noModeIntent,
  type ModeIntent,
} from "./mode-intent";
import { cloudProjectSignature as signature } from "./cloudSignature";
import { hostedCopy } from "../shared/copy";
import type { Locale } from "./i18n";
import type {
  CloudProject,
  ProjectPage,
  CloudSummary,
  RemixCredit,
} from "../shared/project";
type Link = { id: string; ownerId: string; version: number; saved: string };
export { cloudLinkKey } from "./cloudStorage";
// Editors that do not pass an intent ref simply keep each snapshot's own mode.
const untrackedModeIntent: { current: ModeIntent } = { current: noModeIntent };
export function useCloudProject(
  project: Project,
  onOpen: (p: Project) => void,
  enabled = true,
  onSync: (p: Project) => void = onOpen,
  modeIntent: { current: ModeIntent } = untrackedModeIntent,
) {
  const access = useAccess();
  const [link, setLink] = useState<Link | null>(() => {
    if (!enabled) return null;
    try {
      parseProject(localStorage.getItem(projectKey) ?? "");
      const raw = JSON.parse(localStorage.getItem(cloudLinkKey) ?? "null");
      return raw &&
        typeof raw.id === "string" &&
        typeof raw.ownerId === "string" &&
        Number.isInteger(raw.version) &&
        typeof raw.saved === "string"
        ? raw
        : null;
    } catch {
      return null;
    }
  });
  const [status, setStatus] = useState("localOnly"),
    [failure, setFailure] = useState("");
  const [opening, setOpening] = useState(false);
  const [credit, setCredit] = useState<RemixCredit | null>(null);
  const openRequest = useRef<AbortController | null>(null);
  const currentOwner = useRef(access.principal?.id);
  currentOwner.current = access.principal?.id;
  const [checked, setCheckedState] = useState(false),
    [busy, setBusy] = useState(false),
    [retry, setRetry] = useState(0);
  const readyToSave = useRef(false);
  function setChecked(value: boolean) {
    // Reject stale passive effects immediately when a save/check fails, before React commits state.
    readyToSave.current = value;
    setCheckedState(value);
  }
  const generation = useRef(0),
    saving = useRef(false),
    checking = useRef<string | null>(null);
  const current = useRef(project);
  current.current = project;
  const store = useCallback((value: Link | null) => {
    setLink(value);
    try {
      value
        ? localStorage.setItem(cloudLinkKey, JSON.stringify(value))
        : localStorage.removeItem(cloudLinkKey);
    } catch {
      setFailure("UNAVAILABLE");
    }
  }, []);
  const detach = useCallback(() => {
    openRequest.current?.abort();
    setOpening(false);
    generation.current++;
    checking.current = null;
    setChecked(false);
    store(null);
    setCredit(null);
    setStatus("localOnly");
    setFailure("");
  }, [store]);
  useEffect(() => {
    generation.current++;
    openRequest.current?.abort();
    setOpening(false);
    setBusy(false);
    checking.current = null;
    setChecked(false);
    return () => {
      generation.current++;
      openRequest.current?.abort();
    };
  }, [access.principal?.id]);
  useEffect(() => {
    if (!link || !access.principal || link.ownerId !== access.principal.id) {
      setChecked(false);
      return;
    }
    const key = `${link.ownerId}:${link.id}`;
    if (checking.current === key) return;
    checking.current = key;
    const epoch = ++generation.current;
    void api<CloudProject>(`/projects/${link.id}`)
      .then((remote) => {
        if (epoch !== generation.current) return;
        if (
          remote.version !== link.version ||
          signature(current.current) !== link.saved
        ) {
          setStatus("conflict");
          setChecked(false);
        } else {
          setChecked(true);
          setStatus("cloudSaved");
        }
      })
      .catch((error) => {
        if (epoch === generation.current) {
          checking.current = null;
          setFailure(error instanceof ApiFailure ? error.code : "UNAVAILABLE");
          setStatus("cloudOffline");
        }
      });
  }, [link?.id, link?.ownerId, access.principal?.id, retry]);
  useEffect(() => {
    if (
      !link ||
      !checked ||
      !readyToSave.current ||
      !access.principal?.verified ||
      link.ownerId !== access.principal.id ||
      link.saved === signature(project) ||
      saving.current
    )
      return;
    setStatus("cloudSaving");
    const capture = project;
    const epoch = generation.current;
    const timer = window.setTimeout(() => {
      saving.current = true;
      setBusy(true);
      setStatus("cloudSaving");
      void api<CloudProject>(`/projects/${link.id}`, "PUT", {
        version: link.version,
        snapshot: capture,
      })
        .then((saved) => {
          if (epoch !== generation.current) return;
          store({ ...link, version: saved.version, saved: signature(capture) });
          setStatus("cloudSaved");
          setFailure("");
        })
        .catch((error) => {
          if (epoch !== generation.current) return;
          const code = error instanceof ApiFailure ? error.code : "UNAVAILABLE";
          setFailure(code);
          setStatus(code === "VERSION_CONFLICT" ? "conflict" : "cloudOffline");
          setChecked(false);
          checking.current = null;
        })
        .finally(() => {
          saving.current = false;
          setBusy(false);
        });
    }, 750);
    return () => clearTimeout(timer);
  }, [
    project,
    link,
    checked,
    access.principal?.id,
    access.principal?.verified,
    busy,
  ]);
  useEffect(() => {
    const online = () => {
      checking.current = null;
      setRetry((n) => n + 1);
    };
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, []);
  async function createCopy() {
    if (!access.principal?.verified) {
      access.requestAuthentication();
      return;
    }
    setBusy(true);
    const capture = current.current;
    try {
      const remote = await api<CloudProject>("/projects", "POST", {
        snapshot: capture,
      });
      generation.current++;
      checking.current = `${access.principal.id}:${remote.id}`;
      store({
        id: remote.id,
        ownerId: access.principal.id,
        version: remote.version,
        saved: signature(capture),
      });
      setChecked(true);
      setStatus("cloudSaved");
      setFailure("");
    } catch (error) {
      setFailure(error instanceof ApiFailure ? error.code : "UNAVAILABLE");
    } finally {
      setBusy(false);
    }
  }
  async function open(
    id: string,
    // Default: a mode clicked after this request started wins. Deep links pass 0
    // so any explicit choice made since the editor opened also wins.
    intentSince = modeIntent.current.version,
  ) {
    const ownerId = access.principal?.id;
    if (!ownerId || !access.principal?.verified) return;
    openRequest.current?.abort();
    const controller = new AbortController();
    openRequest.current = controller;
    const epoch = ++generation.current;
    setOpening(true);
    setBusy(true);
    setChecked(false);
    checking.current = null;
    setStatus("cloudLoading");
    try {
      const remote = await api<CloudProject>(
        `/projects/${id}`,
        "GET",
        undefined,
        controller.signal,
      );
      if (epoch !== generation.current || ownerId !== currentOwner.current)
        return;
      const stored = parseProject(JSON.stringify(remote.snapshot));
      const snapshot = adoptOpenedProject(
        stored,
        modeIntent.current,
        intentSince,
      );
      checking.current = `${ownerId}:${remote.id}`;
      setCredit(remote.remixedFrom ?? null);
      onOpen(snapshot);
      store({
        id: remote.id,
        ownerId,
        version: remote.version,
        // Compare against the stored snapshot so a preserved mode is autosaved.
        saved: signature(stored),
      });
      setChecked(!remote.archived);
      setStatus(remote.archived ? "archived" : "cloudSaved");
      setFailure("");
    } catch (error) {
      if (epoch !== generation.current || ownerId !== currentOwner.current)
        return;
      setFailure(error instanceof ApiFailure ? error.code : "INVALID_INPUT");
      setStatus("cloudOffline");
    } finally {
      if (epoch === generation.current) {
        openRequest.current = null;
        setOpening(false);
        setBusy(false);
      }
    }
  }
  // After sharing/renaming the server version moves on; keep the program and SCREEN running as they are.
  async function sync(id: string) {
    const ownerId = access.principal?.id;
    if (!link || link.id !== id || !ownerId) return open(id);
    const remote = await api<CloudProject>(`/projects/${id}`);
    if (ownerId !== currentOwner.current) return;
    const snapshot = parseProject(JSON.stringify(remote.snapshot));
    const local = current.current;
    let savedSnapshot: Project;
    try {
      savedSnapshot = parseProject(link.saved);
    } catch {
      return open(id);
    }
    const localHasChanges = signature(local) !== link.saved;
    const localInstructions = local.instructions ?? "";
    const savedInstructions = savedSnapshot.instructions ?? "";
    const remoteInstructions = snapshot.instructions ?? "";
    const localInstructionsChanged = localInstructions !== savedInstructions;
    const remoteInstructionsChanged = remoteInstructions !== savedInstructions;
    const remoteProgramChanged =
      snapshot.sourceCode !== local.sourceCode ||
      snapshot.mode !== local.mode ||
      snapshot.sceneId !== local.sceneId;
    if (
      (remoteProgramChanged && localHasChanges) ||
      (localInstructionsChanged &&
        remoteInstructionsChanged &&
        localInstructions !== remoteInstructions)
    ) {
      // Keep the local draft intact when both sides changed since the saved base.
      setFailure("VERSION_CONFLICT");
      setStatus("conflict");
      setChecked(false);
      return;
    }
    if (remote.archived || remoteProgramChanged) return open(id);
    const merged = {
      ...local,
      title: local.title === savedSnapshot.title ? snapshot.title : local.title,
      instructions: localInstructionsChanged
        ? localInstructions
        : remoteInstructions,
      updatedAt: snapshot.updatedAt,
    };
    onSync(merged);
    store({
      ...link,
      version: remote.version,
      saved: localHasChanges ? link.saved : signature(merged),
    });
    setStatus("cloudSaved");
    setFailure("");
  }
  function rename(title: string) {
    onSync({ ...current.current, title, updatedAt: new Date().toISOString() });
  }
  function cancelOpen() {
    openRequest.current?.abort();
    openRequest.current = null;
    generation.current++;
    setOpening(false);
    setBusy(false);
    setFailure("");
    checking.current = null;
    setStatus(link ? "cloudOffline" : "localOnly");
    if (link) setRetry((n) => n + 1);
  }
  const retrySave = () => {
    checking.current = null;
    setFailure("");
    setRetry((n) => n + 1);
  };
  const saveRecovered = async () => {
    if (!link || !access.principal || link.ownerId !== access.principal.id)
      return;
    setBusy(true);
    const capture = current.current;
    try {
      const remote = await api<CloudProject>(`/projects/${link.id}`, "PUT", {
        version: link.version,
        snapshot: capture,
      });
      store({ ...link, version: remote.version, saved: signature(capture) });
      setChecked(true);
      setStatus("cloudSaved");
      setFailure("");
    } catch (error) {
      setFailure(error instanceof ApiFailure ? error.code : "UNAVAILABLE");
      setStatus("conflict");
    } finally {
      setBusy(false);
    }
  };
  return {
    opening,
    cancelOpen,
    link: link?.ownerId === access.principal?.id ? link : null,
    status,
    failure,
    busy,
    detach,
    createCopy,
    open,
    sync,
    rename,
    credit,
    retrySave,
    saveRecovered,
  };
}
export function CloudControls({
  cloud,
  locale,
  capture,
  screenshot,
  menuHost,
  statusHost,
}: {
  cloud: ReturnType<typeof useCloudProject>;
  locale: Locale;
  capture: () => string;
  screenshot: () => string;
  /** Secondary actions (My projects, History, Update picture) render inside the editor's Project menu. */
  menuHost: HTMLElement | null;
  /** The save state sits next to the project title. */
  statusHost: HTMLElement | null;
}) {
  const access = useAccess(),
    dialog = useRef<HTMLDialogElement>(null),
    recoveryDialog = useRef<HTMLDialogElement>(null),
    loadingDialog = useRef<HTMLDialogElement>(null),
    guestDialog = useRef<HTMLDialogElement>(null);
  const [rows, setRows] = useState<CloudSummary[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [query, setQuery] = useState(""),
    [mode, setMode] = useState(""),
    [visibility, setVisibility] = useState(""),
    [archived, setArchived] = useState(false),
    [renaming, setRenaming] = useState<{ id: string; title: string } | null>(
      null,
    ),
    [error, setError] = useState("");
  const [previewBusy, setPreviewBusy] = useState(false),
    [previewNotice, setPreviewNotice] = useState(""),
    [previewError, setPreviewError] = useState("");
  const c = (key: string) => hostedCopy(key, locale);
  async function updatePreview() {
    if (!cloud.link) return;
    setPreviewError("");
    setPreviewNotice("");
    let pixels = "";
    try {
      pixels = capture();
    } catch {
      setPreviewError("UNAVAILABLE");
      return;
    }
    if (isUniformFrame(pixels)) {
      setPreviewError("BLANK_FRAME");
      return;
    }
    setPreviewBusy(true);
    try {
      await api(`/projects/${cloud.link.id}/preview`, "POST", {
        version: cloud.link.version,
        pixels,
      });
      setPreviewNotice("previewUpdated");
    } catch (e) {
      setPreviewError(e instanceof ApiFailure ? e.code : "UNAVAILABLE");
    } finally {
      setPreviewBusy(false);
    }
  }
  useEffect(() => {
    if (cloud.opening) loadingDialog.current?.showModal();
    else loadingDialog.current?.close();
  }, [cloud.opening]);
  useEffect(() => {
    const id = new URLSearchParams(location.search).get("project");
    if (location.pathname !== "/create" || !id || !access.principal?.verified)
      return;
    history.replaceState(null, "", "/create");
    if (/^[a-f0-9-]{36}$/i.test(id) && confirm(c("openCloudConfirm"))) {
      let active = true;
      // Start after the parent's identity effects finish invalidating old requests.
      queueMicrotask(() => {
        // 0: every explicit mode choice made since the editor opened is newer
        // than this automatic restore, so STORY survives a slow session check.
        if (active) void cloud.open(id, 0);
      });
      return () => {
        active = false;
      };
    }
  }, [access.principal?.id, access.principal?.verified]);
  useEffect(() => {
    if (cloud.status !== "conflict") recoveryDialog.current?.close();
  }, [cloud.status]);
  async function list(next?: string) {
    try {
      const params = new URLSearchParams({
        q: query,
        archived: String(archived),
        ...(mode ? { mode } : {}),
        ...(visibility ? { visibility } : {}),
        ...(next ? { cursor: next } : {}),
      });
      const result = await api<ProjectPage>(`/projects?${params}`);
      setRows((old) => (next ? [...old, ...result.projects] : result.projects));
      setCursor(result.nextCursor);
      setError("");
    } catch (e) {
      setError(e instanceof ApiFailure ? e.code : "UNAVAILABLE");
    }
  }
  useEffect(() => {
    if (location.pathname !== "/me/projects" || !access.ready) return;
    if (access.principal?.verified) {
      guestDialog.current?.close();
      dialog.current?.showModal();
      void list();
    } else if (!guestDialog.current?.open) guestDialog.current?.showModal();
  }, [access.principal?.id, access.principal?.verified, access.ready]);
  function leaveLibraryRoute() {
    guestDialog.current?.close();
    if (location.pathname === "/me/projects")
      history.replaceState(null, "", "/create");
  }
  async function library() {
    if (!access.principal?.verified) {
      access.requestAuthentication();
      return;
    }
    dialog.current?.showModal();
    await list();
  }
  async function act(
    row: CloudSummary,
    action: "duplicate" | "rename" | "archive" | "delete",
  ) {
    try {
      if (action === "duplicate")
        await api(`/projects/${row.id}/duplicate`, "POST", {
          version: row.version,
          title: hostedCopy("copyOf", locale, {
            title: row.title || c("untitledCloud"),
          }).slice(0, 120),
        });
      if (action === "archive")
        await api(`/projects/${row.id}`, "PATCH", {
          version: row.version,
          archived: !row.archived,
        });
      if (action === "delete") {
        if (!confirm(c("confirmCloudDelete"))) return;
        await api(`/projects/${row.id}`, "DELETE", { version: row.version });
        if (cloud.link?.id === row.id) cloud.detach();
      }
      await list();
    } catch (e) {
      setError(e instanceof ApiFailure ? e.code : "UNAVAILABLE");
    }
  }
  const menuItems = (
    <>
      <button onClick={() => void library()}>{c("myProjects")}</button>
      {cloud.link && (
        <HistoryControl
          id={cloud.link.id}
          locale={locale}
          canRestore={cloud.status === "cloudSaved" && !cloud.busy}
          onRestored={cloud.open}
        />
      )}
      {cloud.link && (
        <button
          disabled={previewBusy || cloud.busy || cloud.status !== "cloudSaved"}
          onClick={() => void updatePreview()}
          title={c("previewFromEditor")}
        >
          {c("updatePreview")}
        </button>
      )}
    </>
  );
  const status = (
    <>
      {cloud.link && (
        <span className="cloud-status" aria-live="polite">
          {c(cloud.status)}
        </span>
      )}
      {previewNotice && (
        <span role="status" className="header-note">
          {c(previewNotice)}
        </span>
      )}
      {previewError && (
        <span role="alert" className="header-note account-error">
          {c(`error_${previewError}`)}
        </span>
      )}
    </>
  );
  // Rename happens inline: window.prompt is blocked or missing in some embedded browsers.
  async function saveRename(row: CloudSummary) {
    const title = renaming?.title.trim() ?? "";
    if (!title) {
      setError("INVALID_INPUT");
      return;
    }
    try {
      if (cloud.link?.id === row.id) {
        // The open project keeps its program running; autosave persists the new title.
        cloud.rename(title);
        setRows((old) =>
          old.map((r) => (r.id === row.id ? { ...r, title } : r)),
        );
      } else {
        const full = await api<CloudProject>(`/projects/${row.id}`);
        await api(`/projects/${row.id}`, "PUT", {
          version: full.version,
          snapshot: {
            ...full.snapshot,
            title,
            updatedAt: new Date().toISOString(),
          },
        });
        await list();
      }
      setRenaming(null);
      setError("");
    } catch (e) {
      setError(e instanceof ApiFailure ? e.code : "UNAVAILABLE");
    }
  }
  return (
    <>
      <dialog
        ref={loadingDialog}
        className="account-dialog"
        aria-label={c("cloudLoading")}
        onCancel={() => cloud.cancelOpen()}
      >
        <p role="status">{c("cloudLoading")}</p>
        <button onClick={() => cloud.cancelOpen()}>
          {c("cancelCloudOpen")}
        </button>
      </dialog>
      <dialog
        ref={guestDialog}
        className="account-dialog"
        aria-label={c("libraryNeedsAccount")}
        onClose={() => {
          if (location.pathname === "/me/projects")
            history.replaceState(null, "", "/create");
        }}
      >
        <div className="dialog-heading">
          <h2>{c("libraryNeedsAccount")}</h2>
        </div>
        <p>{c("libraryNeedsAccountBody")}</p>
        <div className="actions">
          <button
            className="primary"
            onClick={() => {
              leaveLibraryRoute();
              access.requestAuthentication();
            }}
          >
            {c("login")}
          </button>
          <button onClick={leaveLibraryRoute}>{c("backToEditor")}</button>
        </div>
      </dialog>
      {menuHost && createPortal(menuItems, menuHost)}
      {statusHost && createPortal(status, statusHost)}
      {!cloud.link && (
        <button
          className="save-cloud"
          disabled={cloud.busy}
          onClick={() => void cloud.createCopy()}
        >
          {c("saveCloud")}
        </button>
      )}
      {cloud.link && (
        <ShareControl
          id={cloud.link.id}
          locale={locale}
          ready={cloud.status === "cloudSaved" && !cloud.busy}
          onChanged={cloud.sync}
          capture={capture}
          screenshot={screenshot}
        />
      )}
      {cloud.link && cloud.status === "cloudOffline" && (
        <button onClick={cloud.retrySave}>{c("retry")}</button>
      )}
      {cloud.link && cloud.status === "conflict" && (
        <button onClick={() => recoveryDialog.current?.showModal()}>
          {c("conflict")}
        </button>
      )}
      <dialog
        ref={recoveryDialog}
        className="account-dialog"
        aria-label={c("conflict")}
      >
        <div className="dialog-heading">
          <h2>{c("conflict")}</h2>
          <button onClick={() => recoveryDialog.current?.close()}>
            {c("close")}
          </button>
        </div>
        <p>{c("conflictHelp")}</p>
        <button disabled={cloud.busy} onClick={() => void cloud.createCopy()}>
          {c("saveCopy")}
        </button>
        <button
          disabled={cloud.busy}
          onClick={() => void cloud.saveRecovered()}
        >
          {c("retryLocal")}
        </button>
        <button
          disabled={cloud.busy}
          onClick={() => {
            if (confirm(c("openCloudConfirm"))) void cloud.open(cloud.link!.id);
          }}
        >
          {c("loadCloud")}
        </button>
      </dialog>
      {cloud.failure && (
        <small className="account-error" role="alert">
          {c(`error_${cloud.failure}`)}
        </small>
      )}
      <dialog
        ref={dialog}
        className="account-dialog library-dialog"
        aria-label={c("myProjects")}
      >
        <div className="dialog-heading">
          <h2>{c("myProjects")}</h2>
          <button onClick={() => dialog.current?.close()}>{c("close")}</button>
        </div>
        <p>{c("libraryIntro")}</p>
        <button
          disabled={cloud.busy}
          onClick={() => void cloud.createCopy().then(() => list())}
        >
          {c("saveCopy")}
        </button>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void list();
          }}
          className="library-filters"
        >
          <label>
            {c("searchProjects")}
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              maxLength={120}
            />
          </label>
          <select
            aria-label={c("cloudMode")}
            value={mode}
            onChange={(e) => setMode(e.target.value)}
          >
            <option value="">{c("allModes")}</option>
            <option value="story">{c("storyMode")}</option>
            <option value="sandbox">{c("sandboxMode")}</option>
          </select>
          <select
            aria-label={c("visibility")}
            value={visibility}
            onChange={(e) => setVisibility(e.target.value)}
          >
            <option value="">{c("allVisibility")}</option>
            {["private", "unlisted", "public"].map((v) => (
              <option key={v} value={v}>
                {c(v)}
              </option>
            ))}
          </select>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={archived}
              onChange={(e) => setArchived(e.target.checked)}
            />
            {c("archived")}
          </label>
          <button>{c("search")}</button>
        </form>
        {error && <p role="alert">{c(`error_${error}`)}</p>}
        {!rows.length && <p>{c("noProjects")}</p>}
        {rows.map((row) => (
          <article className="library-card" key={row.id}>
            <div className="project-preview">
              <ProjectPreview
                title={row.title || c("untitledCloud")}
                seed={row.id}
                url={row.previewUrl}
              />
            </div>
            {renaming?.id === row.id ? (
              <form
                className="rename-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void saveRename(row);
                }}
              >
                <label>
                  {c("cloudTitle")}
                  <input
                    autoFocus
                    value={renaming.title}
                    maxLength={120}
                    onChange={(e) =>
                      setRenaming({ id: row.id, title: e.target.value })
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        e.stopPropagation();
                        setRenaming(null);
                      }
                    }}
                  />
                </label>
                <div className="actions">
                  <button className="primary">{c("saveTitle")}</button>
                  <button type="button" onClick={() => setRenaming(null)}>
                    {c("cancel")}
                  </button>
                </div>
              </form>
            ) : (
              <h3>{row.title || c("untitledCloud")}</h3>
            )}
            <p>
              {c(row.mode === "story" ? "storyMode" : "sandboxMode")} ·{" "}
              {c(row.visibility)} ·{" "}
              {new Date(row.updatedAt).toLocaleDateString(locale)}
            </p>
            <div className="actions">
              <button
                onClick={() => {
                  if (confirm(c("openCloudConfirm")))
                    void cloud.open(row.id).then(() => dialog.current?.close());
                }}
              >
                {c("open")}
              </button>
              <ShareControl
                id={row.id}
                locale={locale}
                ready={
                  !row.archived &&
                  (cloud.link?.id !== row.id ||
                    (cloud.status === "cloudSaved" && !cloud.busy))
                }
                onChanged={async (id) => {
                  if (cloud.link?.id === id) await cloud.sync(id);
                  await list();
                }}
              />
              <HistoryControl
                id={row.id}
                locale={locale}
                canRestore={
                  !row.archived &&
                  (cloud.link?.id !== row.id ||
                    (cloud.status === "cloudSaved" && !cloud.busy))
                }
                onRestored={async (id) => {
                  if (cloud.link?.id === id) await cloud.open(id);
                  await list();
                }}
              />
              <button
                onClick={() => setRenaming({ id: row.id, title: row.title })}
              >
                {c("rename")}
              </button>
              <button onClick={() => void act(row, "duplicate")}>
                {c("duplicate")}
              </button>
              <button onClick={() => void act(row, "archive")}>
                {c(row.archived ? "unarchive" : "archive")}
              </button>
              <button onClick={() => void act(row, "delete")}>
                {c("delete")}
              </button>
            </div>
          </article>
        ))}
        {cursor && (
          <button onClick={() => void list(cursor)}>{c("loadMore")}</button>
        )}
      </dialog>
    </>
  );
}
