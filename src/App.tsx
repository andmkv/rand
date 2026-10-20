import { trackUsage } from "./Analytics";
import { capturePreview, frameDataUrl } from "./previewFrame";
import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
const Editor = lazy(() =>
  import("./Editor").then((m) => ({ default: m.Editor })),
);
const PixelEditor = lazy(() =>
  import("./PixelEditor").then((m) => ({ default: m.PixelEditor })),
);
const SoundEditor = lazy(() =>
  import("./SoundEditor").then((m) => ({ default: m.SoundEditor })),
);
import { soundDraftAdapter } from "./sound-adapter";
import type { SoundEditorAsset } from "./SoundEditor";
import type { UserSoundSummary } from "./sound-draft";
import { Engine } from "./runtime/engine";
import { useCloudProject, CloudControls } from "./Cloud";
import { useLocale } from "./useLocale";
import { useAccess } from "./Access";
import { AccountControl } from "./Account";
import { Inventory } from "./Inventory";
import { soundPreviewAdapter } from "./runtime/audio";
import { soundAssets } from "./runtime/assets";
import { World, palette } from "./runtime/world";
import { SpellError } from "./runtime/language";
import { examples } from "./content/examples";
import { spells } from "./content/spellbook";
import { bookText } from "./book/ui";
import { scenes, storyTitle, sceneSatisfied } from "./content/story";
import {
  freshProject,
  loadProject,
  readChapterCode,
  writeChapterCode,
  clearChapterCode,
  sandboxStarter,
  projectKey,
  type Mode,
  type Project,
  readProjectFile,
  serializeProject,
  projectFilename,
} from "./project";
import {
  noModeIntent,
  recordModeIntent,
  type ModeIntent,
} from "./mode-intent";
import { hostedCopy } from "../shared/copy";
import { instructionsMax } from "../shared/limits";
import { useWorkspaceLayout } from "./layout";
import { can } from "../shared/permissions";
import type { AnimationDraftV1 } from "./animation-draft";
import type {
  IndexedSpriteV1,
  UserSpriteAsset,
  UserSpriteAssetSummary,
} from "../shared/assets";
import {
  bindSpriteToProject,
  bindSoundToProject,
  spriteAssetAdapter,
  soundAssetAdapter,
  soundInsertSnippet,
  spriteSpawnSnippet,
} from "./assets";
import { animationAssetAdapter } from "./animation-persistence";
import { Menu } from "./Menu";
import { ProjectInfo } from "./ProjectInfo";
import {
  t,
  message,
  content,
  exampleInstructions,
  locales,
  isLocale,
  type Locale,
} from "./i18n";
export default function App({
  initialProject,
  viewOnly = false,
  viewerHeader,
  viewerCaption,
  poster,
}: {
  poster?: string | null;
  initialProject?: Project;
  viewOnly?: boolean;
  viewerHeader?: (locale: Locale) => ReactNode;
  viewerCaption?: (locale: Locale) => string;
} = {}) {
  const { locale, chooseLocale } = useLocale();
  const access = useAccess();
  // Home's "Start the story" / "Open sandbox" choose a mode without touching the code.
  const requestedMode = (() => {
    if (viewOnly || initialProject) return null;
    const wanted = new URLSearchParams(location.search).get("mode");
    return location.pathname === "/create" &&
      (wanted === "story" || wanted === "sandbox")
      ? (wanted as Mode)
      : null;
  })();
  // Versioned so an async project load can tell whether the child chose a mode after it was requested.
  const modeIntent = useRef<ModeIntent>(
    requestedMode ? { version: 1, mode: requestedMode } : noModeIntent,
  );
  const [project, setProject] = useState(() => {
    if (initialProject) return initialProject;
    const loaded = loadProject();
    return requestedMode ? { ...loaded, mode: requestedMode } : loaded;
  }),
    [status, setStatus] = useState("ready"),
    [error, setError] = useState<SpellError | null>(null),
    [focusLine, setFocusLine] = useState<number>(),
    [running, setRunning] = useState(false),
    [output, setOutput] = useState<string[]>([]),
    [drawer, setDrawer] = useState<
      "spellbook" | "examples" | "inventory" | null
    >(null),
    [spriteEditor, setSpriteEditor] = useState<{
      asset?: UserSpriteAsset;
    } | null>(null),
    [soundEditor, setSoundEditor] = useState<{
      asset?: SoundEditorAsset;
    } | null>(null),
    [userSounds, setUserSounds] = useState<UserSoundSummary[]>([]),
    [userAssets, setUserAssets] = useState<UserSpriteAssetSummary[]>([]),
    [userAssetsState, setUserAssetsState] = useState<
      "idle" | "loading" | "ready" | "error"
    >("idle"),
    [focusAssetId, setFocusAssetId] = useState<string | null>(null),
    [query, setQuery] = useState(""),
    [category, setCategory] = useState("ALL"),
    [focusSpell, setFocusSpell] = useState<string | null>(null),
    [saved, setSaved] = useState(true),
    [input, setInput] = useState<{
      prompt: string;
      resolve: (s: string) => void;
    } | null>(null),
    [answer, setAnswer] = useState(""),
    [border, setBorder] = useState(palette[9]);
  const [idle, setIdle] = useState(true),
    [infoOpen, setInfoOpen] = useState(false),
    [menuSlot, setMenuSlot] = useState<HTMLElement | null>(null),
    [statusSlot, setStatusSlot] = useState<HTMLElement | null>(null);
  const workspace = useRef<HTMLDivElement>(null);
  const inventorySoundPreviewRun = useRef(0);
  function cancelSoundPreview() {
    inventorySoundPreviewRun.current++;
    soundPreviewAdapter.stop();
  }
  const placement = useWorkspaceLayout(
    workspace,
    !viewOnly && project.mode === "story",
    !viewOnly && project.mode === "story",
    viewOnly,
  );
  const editorInsert = useRef<((text: string) => void) | null>(null);
  const drawerOpener = useRef<HTMLButtonElement | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null),
    world = useRef<World | null>(null),
    engine = useRef<Engine | null>(null),
    generation = useRef(0);
  const cloud = useCloudProject(
    project,
    (p) => {
      reset();
      setProject(p);
      setDrawer(null);
    },
    !viewOnly,
    (p) => setProject(p),
    modeIntent,
  );
  const copy = (key: Parameters<typeof t>[0]) => t(key, locale);
  const [notice, setNotice] = useState("");
  const noticeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  function announce(text: string) {
    clearTimeout(noticeTimer.current);
    setNotice(text);
    noticeTimer.current = setTimeout(() => setNotice(""), 4000);
  }
  useEffect(() => () => clearTimeout(noticeTimer.current), []);
  // Code that ships with the product (starters, examples, spells) is safe to replace silently.
  const disposable = useMemo(() => {
    const out = new Set<string>();
    for (const l of new Set(["en", locale] as Locale[])) {
      for (const sc of content("scenes", scenes, l))
        out.add(sc.starter.trim()).add(sc.example.trim());
      for (const ex of content("examples", examples, l)) out.add(ex.code.trim());
      for (const sp of content("spells", spells, l)) out.add(sp.code.trim());
    }
    out.add(sandboxStarter.trim());
    return out;
  }, [locale]);
  const isDisposable = (source: string) =>
    !source.trim() || disposable.has(source.trim());
  function confirmReplace(next: string) {
    const source = project.sourceCode;
    return (
      isDisposable(source) ||
      source.trim() === next.trim() ||
      window.confirm(copy("confirmReplace"))
    );
  }
  useEffect(() => {
    const w = new World(canvas.current!);
    w.onChange = () => setBorder(palette[w.border + w.bright * 8]);
    w.onPrint = (s) => setOutput((old) => [...old.slice(-29), s]);
    w.ask = (prompt, signal) =>
      new Promise((resolve, reject) => {
        const abort = () => {
          setInput(null);
          reject(new SpellError("stopped"));
        };
        signal.addEventListener("abort", abort, { once: true });
        setAnswer("");
        setInput({
          prompt,
          resolve: (s) => {
            signal.removeEventListener("abort", abort);
            setInput(null);
            resolve(s);
          },
        });
        if (signal.aborted) abort();
      });
    world.current = w;
    w.reset();
    w.startup(
      900,
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    );
    return () => {
      engine.current?.stop();
      w.stop();
      cancelSoundPreview();
      void w.audio.context?.close();
    };
  }, []);
  useEffect(() => {
    if (!viewOnly && new URLSearchParams(location.search).has("mode"))
      history.replaceState(null, "", location.pathname);
  }, []);
  useEffect(() => {
    if (viewOnly) return;
    try {
      localStorage.setItem(projectKey, JSON.stringify(project));
      setSaved(true);
    } catch {
      setSaved(false);
    }
  }, [project, viewOnly]);
  useEffect(() => {
    if (!viewOnly && canUseAssets) {
      void loadUserAssets();
      void loadUserSounds();
    }
  }, [access.principal?.id, viewOnly]);
  const update = (patch: Partial<typeof project>) =>
    setProject((p) => ({
      ...p,
      ...patch,
      updatedAt: new Date().toISOString(),
    }));
  function stop() {
    cancelSoundPreview();
    generation.current++;
    engine.current?.stop();
    setInput(null);
    setRunning(false);
    setStatus("stopped");
  }
  async function run(source = project.sourceCode, fromExample = false) {
    cancelSoundPreview();
    engine.current?.stop();
    const current = ++generation.current;
    const w = world.current;
    if (!w) return;
    void trackUsage(
      location.pathname.startsWith("/p/")
        ? "public_project_run"
        : fromExample ||
            (project.mode === "sandbox" && project.exampleId) ||
            location.pathname.startsWith("/examples/")
          ? "example_run"
          : "program_run",
    );
    setError(null);
    setOutput([]);
    setIdle(false);
    setNotice("");
    setStatus("running");
    setRunning(true);
    try {
      w.setProjectAssets(project.assetManifest);
      w.audio.unlock();
      const e = new Engine(w);
      engine.current = e;
      await e.run(source);
      if (current !== generation.current) return;
      setStatus("finished");
      if (
        !viewOnly &&
        project.mode === "story" &&
        sceneSatisfied(scenes[project.sceneId], w)
      )
        update({ unlocked: Math.max(project.unlocked, project.sceneId + 1) });
    } catch (err) {
      if (current !== generation.current) return;
      const e = err instanceof SpellError ? err : new SpellError("internal");
      if (e.code !== "stopped") {
        setError(e);
        setFocusLine(e.loc.line);
        setStatus("error");
      } else setStatus("stopped");
    } finally {
      if (current === generation.current) {
        w.releaseKeys?.();
        w.keys.clear();
        setRunning(false);
      }
    }
  }
  function load(source: string, patch: Partial<typeof project> = {}) {
    if (patch.exampleId) void trackUsage("example_opened");
    stop();
    setError(null);
    setOutput([]);
    world.current?.reset();
    update({ sourceCode: source, ...patch });
    setStatus("ready");
    setIdle(true);
    setDrawer(null);
  }
  function reset() {
    stop();
    setError(null);
    setOutput([]);
    world.current?.reset();
    setStatus("ready");
    setIdle(true);
  }
  function insert(code: string) {
    stop();
    setDrawer(null);
    update({
      sourceCode: project.sourceCode + (project.sourceCode ? "\n" : "") + code,
    });
  }
  /** Inventory writes at the caret and keeps the running SCREEN; it never replaces the program. */
  function insertAtCaret(code: string) {
    setDrawer(null);
    setFocusAssetId(null);
    if (editorInsert.current) editorInsert.current(code);
    else insert(code);
  }
  function closeDrawer() {
    const opener = drawerOpener.current;
    setDrawer(null);
    setFocusAssetId(null);
    requestAnimationFrame(() => opener?.focus());
  }
  const soundOpener = useRef<HTMLElement | null>(null);
  function stopPreviewSound() {
    cancelSoundPreview();
  }
  const canUseAssets = can(access.principal, "cloudProjects");
  async function loadUserAssets() {
    if (!canUseAssets) return;
    setUserAssetsState("loading");
    try {
      setUserAssets(await spriteAssetAdapter.list());
      setUserAssetsState("ready");
    } catch {
      setUserAssetsState("error");
    }
  }
  async function loadUserSounds() {
    if (!canUseAssets) return;
    try {
      setUserSounds(await soundDraftAdapter(canUseAssets).list());
    } catch {
      setUserSounds([]);
    }
  }
  async function openUserSound(soundId: string, opener?: HTMLElement) {
    cancelSoundPreview();
    soundOpener.current = opener ?? null;
    try {
      setSoundEditor({ asset: await soundDraftAdapter(canUseAssets).load(soundId) });
    } catch (e) {
      setError(e instanceof SpellError ? e : new SpellError("assetUnavailable"));
    }
  }
  async function openUserAsset(assetId: string) {
    try {
      const asset = await spriteAssetAdapter.load(assetId);
      setSpriteEditor({ asset });
    } catch (e) {
      setError(e instanceof SpellError ? e : new SpellError("assetUnavailable"));
    }
  }
  async function saveSprite(input: {
    name: string;
    sprite: IndexedSpriteV1;
    animation: AnimationDraftV1;
  }) {
    const editing = spriteEditor?.asset;
    let saved: UserSpriteAsset;
    if (input.animation.frames.length > 1) {
      saved = await animationAssetAdapter.save({
        name: input.name,
        animation: input.animation,
        existing: editing
          ? { id: editing.id, baseVersion: editing.selectedVersion.number }
          : undefined,
      });
    } else {
      saved = editing
        ? await spriteAssetAdapter.saveVersion(editing.id, {
            baseVersion: editing.selectedVersion.number,
            sprite: input.sprite,
          })
        : await spriteAssetAdapter.create({
            name: input.name,
            sprite: input.sprite,
          });
    }
    if (saved.name !== input.name) {
      await spriteAssetAdapter.rename(saved.id, input.name);
      saved = { ...saved, name: input.name };
    }
    setProject((current) =>
      bindSpriteToProject(current, { ...saved, name: input.name }),
    );
    setSpriteEditor(null);
    setFocusAssetId(saved.alias);
    await loadUserAssets();
  }
  async function insertUserAsset(assetId: string) {
    try {
      const asset = await spriteAssetAdapter.load(assetId);
      setProject((current) => bindSpriteToProject(current, asset));
      insertAtCaret(spriteSpawnSnippet(asset.alias));
    } catch (e) {
      setError(e instanceof SpellError ? e : new SpellError("assetUnavailable"));
    }
  }
  async function insertUserSound(assetId: string) {
    try {
      const asset = await soundAssetAdapter.load(assetId);
      setProject((current) => bindSoundToProject(current, asset));
      insertAtCaret(soundInsertSnippet(asset));
    } catch (e) {
      setError(e instanceof SpellError ? e : new SpellError("assetUnavailable"));
    }
  }
  function previewSound(id: string) {
    inventorySoundPreviewRun.current++;
    const asset = soundAssets.find((item) => item.id === id);
    if (!asset) return;
    void soundPreviewAdapter.preview({ recipe: asset.recipe }).catch(() =>
      setError(new SpellError("audio")),
    );
  }
  async function previewUserSoundFromInventory(assetId: string): Promise<void> {
    // Invoke resume synchronously while still inside the Preview click's user gesture.
    const mine = ++inventorySoundPreviewRun.current;
    try {
      const unlocked = soundPreviewAdapter.unlock();
      if (!(await unlocked)) throw new Error("AUDIO_BLOCKED");
      if (mine !== inventorySoundPreviewRun.current) return;
      const adapter = soundDraftAdapter(canUseAssets);
      const sound = await adapter.load(assetId);
      if (mine !== inventorySoundPreviewRun.current) return;
      await adapter.preview(sound.draft);
    } catch (error) {
      if (mine === inventorySoundPreviewRun.current) {
        setError(new SpellError("audio"));
        throw error;
      }
    }
  }
  function newProject() {
    if (!window.confirm(copy("confirmNew"))) return;
    reset();
    cloud.detach();
    clearChapterCode();
    setProject({
      ...freshProject(),
      mode: "sandbox",
      sourceCode: "",
      exampleId: null,
    });
  }
  // Reset keeps the current mode: Story restarts the story, Sandbox gets a small starter.
  function resetProject() {
    const story = project.mode === "story";
    if (!window.confirm(copy(story ? "confirmRestartStory" : "confirmResetSandbox")))
      return;
    reset();
    cloud.detach();
    clearChapterCode();
    const p = freshProject();
    setProject(
      story
        ? p
        : { ...p, mode: "sandbox", sourceCode: sandboxStarter, exampleId: null },
    );
  }
  function loadGuarded(
    source: string,
    patch: Partial<typeof project> = {},
  ): boolean {
    if (!confirmReplace(source)) return false;
    load(source, patch);
    return true;
  }
  function goChapter(id: number) {
    if (id === project.sceneId) return;
    if (project.mode === "story")
      writeChapterCode(
        project.sceneId,
        isDisposable(project.sourceCode) ? null : project.sourceCode,
      );
    load(readChapterCode(id) ?? localScenes[id].starter, {
      sceneId: id,
      exampleId: null,
    });
  }
  function changeMode(mode: Mode) {
    // An explicit STORY/Sandbox click is the newest intent; a slow project open must not undo it.
    modeIntent.current = recordModeIntent(modeIntent.current, mode);
    stop();
    setError(null);
    update({ mode });
  }
  function download() {
    const url = URL.createObjectURL(
      new Blob([serializeProject(project)], {
        type: "application/json;charset=utf-8",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = projectFilename(project);
    a.click();
    announce(copy("fileSaved").replace("{file}", a.download));
    void trackUsage("file_exported");
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function openFile(file: File) {
    try {
      const imported = await readProjectFile(file);
      if (!window.confirm(copy("confirmImport"))) return;
      reset();
      cloud.detach();
      setProject(imported);
      void trackUsage("file_imported");
      setDrawer(null);
      world.current?.startup(
        450,
        window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      );
    } catch (e) {
      setError(e instanceof SpellError ? e : new SpellError("importInvalid"));
      setStatus("error");
    }
  }
  const localScenes = content("scenes", scenes, locale),
    scene = localScenes[project.sceneId],
    gallery = content("examples", examples, locale),
    reference = content("spells", spells, locale);
  const fileError =
    !!error && ["importInvalid", "importVersion", "importLarge"].includes(error.code);
  // Beginner spells first; everything else keeps its original order.
  const startHere = ["ink", "plot", "line", "circle", "text", "sound", "for"];
  const rank = (id: string) => {
    const i = startHere.indexOf(id);
    return i < 0 ? startHere.length : i;
  };
  const ordered = [...reference].sort((a, b) => rank(a.id) - rank(b.id));
  const filtered = ordered.filter(
    (s) =>
      (category === "ALL" || s.category === category) &&
      `${s.name} ${s.description} ${s.tags} ${s.syntax}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  function showSpell(spellId: string) {
    const spell = reference.find((entry) => entry.id === spellId);
    setCategory("ALL");
    setQuery(spell?.name ?? "");
    setDrawer("spellbook");
    setFocusSpell(spellId);
  }
  useEffect(() => {
    if (drawer !== "spellbook" || !focusSpell) return;
    const card = document.querySelector<HTMLElement>(
      `[data-spell-id="${CSS.escape(focusSpell)}"]`,
    );
    card?.scrollIntoView({ block: "center" });
    card?.focus({ preventScroll: true });
    setFocusSpell(null);
  }, [drawer, focusSpell, filtered]);
  const languagePicker = (
    <select
      className="language-picker"
      aria-label={copy("locale")}
      value={locale}
      onChange={(e) => chooseLocale(e.target.value as Locale)}
    >
      {locales.map((locale) => (
        <option key={locale.id} value={locale.id}>
          {locale.name}
        </option>
      ))}
    </select>
  );
  const story = !viewOnly && project.mode === "story";
  const credit =
    !viewOnly && cloud.credit
      ? cloud.credit.title
        ? hostedCopy("remixCredit", locale, {
            title: cloud.credit.title,
            author: cloud.credit.author ?? "",
          })
        : hostedCopy("remixCreditGone", locale)
      : "";
  // Play instructions are said once: under SCREEN in the editor, in the info panel on read-only pages.
  // One source: the project's own instructions (seeded from a built-in example when it is opened).
  const playHelp = project.instructions?.trim() ?? "";
  const lines = project.sourceCode.split("\n").length;
  return (
    <main className={"app" + (viewOnly ? " shared-viewer" : "")}>
      <header className="app-header">
        <h1>
          <a className="brand-link" href="/">
            {copy("brand")}
          </a>
        </h1>
        {!viewOnly && (
          <div className="project-identity">
            <input
              className="project-title"
              aria-label={copy("title")}
              placeholder={copy("untitled")}
              value={project.title}
              maxLength={120}
              onChange={(e) => update({ title: e.target.value })}
            />
            <button
              className="info-button"
              aria-label={copy("projectInfo")}
              title={copy("projectInfo")}
              onClick={() => setInfoOpen(true)}
            >
              ⓘ
            </button>
            <span className="save-state" ref={setStatusSlot}>
              {!cloud.link && (
                <span className={saved ? "local-save" : "account-error"}>
                  {copy(saved ? "saved" : "unsaved")}
                </span>
              )}
            </span>
          </div>
        )}
        {!viewOnly && (
          <div className="mode-controls" role="group" aria-label={copy("mode")}>
            {(["story", "sandbox"] as Mode[]).map((mode) => (
              <button
                key={mode}
                aria-pressed={project.mode === mode}
                onClick={() => changeMode(mode)}
              >
                {copy(mode)}
              </button>
            ))}
          </div>
        )}
        <div className="actions project-actions">
          {!viewOnly && (
            <CloudControls
              key={`${access.principal?.id ?? "guest"}:${access.principal?.verified ?? false}`}
              cloud={cloud}
              locale={locale}
              capture={() => capturePreview(canvas.current)}
              screenshot={() => frameDataUrl(canvas.current)}
              menuHost={menuSlot}
              statusHost={statusSlot}
            />
          )}
          {!viewOnly && (
            <Menu id="more-panel" label={copy("projectMenu")}>
              <button onClick={() => setInfoOpen(true)}>
                {copy("projectInfo")}…
              </button>
              <div className="menu-group" ref={setMenuSlot} />
              <hr />
              <button onClick={newProject}>{copy("new")}</button>
              <button onClick={() => fileInput.current?.click()}>
                {copy("openFile")}
              </button>
              <button onClick={download}>{copy("saveFile")}</button>
              <button onClick={resetProject}>{copy("resetProject")}</button>
              <hr />
              {languagePicker}
            </Menu>
          )}
          <AccountControl locale={locale} />
          {access.principal?.verified && access.principal.isAdmin && (
            <a className="admin-link" href="/admin">
              {hostedCopy("adminConsole", locale)}
            </a>
          )}
          {viewOnly && languagePicker}
          <input
            ref={fileInput}
            type="file"
            hidden
            accept=".randusr,application/json"
            aria-label={copy("openFile")}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void openFile(file);
            }}
          />
        </div>
      </header>
      {!viewOnly && infoOpen && (
        <ProjectInfo
          open={infoOpen}
          onClose={() => setInfoOpen(false)}
          locale={locale}
          fields={{ title: project.title, instructions: project.instructions ?? "" }}
          instructionsMax={instructionsMax}
          onChange={(patch) => update(patch)}
          credit={credit}
        />
      )}
      <div
        ref={workspace}
        className={
          "workspace layout-" +
          placement.layout +
          (viewOnly
            ? " viewer-layout"
            : story
              ? " story-layout"
              : " sandbox-layout")
        }
        style={{ "--px": placement.scale } as React.CSSProperties}
      >
        {viewerHeader && (
          <section className="viewer-info">{viewerHeader(locale)}</section>
        )}
        {story && (
          <section className="story-panel" aria-label={copy("story")}>
            <h2 className="sr-only">{copy("story")}</h2>
            <article className="story">
              <div className="story-text">
                <p className="eyebrow">
                  {content("storyTitle", storyTitle, locale)} ·{" "}
                  {project.sceneId + 1} / {scenes.length}
                </p>
                <h2>{scene.title}</h2>
                {scene.paragraphs.map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
                <p className="muted">
                  {copy("hint")}: {scene.hint}
                </p>
              </div>
              <div className="story-controls">
                <div className="actions">
                  <button
                    onClick={() => loadGuarded(scene.starter, { exampleId: null })}
                  >
                    {copy("starter")}
                  </button>
                  <button
                    onClick={() => loadGuarded(scene.example, { exampleId: null })}
                  >
                    {copy("example")}
                  </button>
                  {project.unlocked > project.sceneId &&
                    (scene.next ? (
                      <button
                        className="primary"
                        onClick={() => goChapter(Number(scene.next))}
                      >
                        {copy("next")}
                      </button>
                    ) : (
                      <p className="progress">{copy("complete")}</p>
                    ))}
                </div>
                <nav>
                  {scenes.map((s, i) => (
                    <button
                      key={s.id}
                      disabled={i > project.unlocked}
                      aria-label={s.title}
                      aria-current={i === project.sceneId ? "step" : undefined}
                      onClick={() => goChapter(i)}
                    >
                      {i + 1}
                    </button>
                  ))}
                </nav>
              </div>
            </article>
          </section>
        )}
        <div className="machine" key="machine">
          <section className="screen-panel">
            <div className="screen-heading">
              <nav className="runtime-controls" aria-label={copy("controls")}>
                <button
                  className="primary"
                  onClick={() => void run()}
                  title={copy("instruction")}
                >
                  {copy("run")}
                </button>
                <button
                  onClick={() => {
                    stop();
                    setIdle(true);
                    world.current?.clearScreen(
                      650,
                      window.matchMedia("(prefers-reduced-motion: reduce)")
                        .matches,
                    );
                  }}
                  disabled={!running}
                >
                  {copy("stop")}
                </button>
                <button
                  onClick={() => {
                    reset();
                    world.current?.startup(
                      750,
                      window.matchMedia("(prefers-reduced-motion: reduce)")
                        .matches,
                    );
                  }}
                >
                  {copy("reset")}
                </button>
              </nav>
              <h2>
                {copy("world")} <span className="muted">256 × 192</span>
              </h2>
            </div>
            <div className="screen-view">
              <div className="bezel" style={{ background: border }}>
                <canvas
                  ref={canvas}
                  tabIndex={0}
                  width="256"
                  height="192"
                  aria-label={copy("world")}
                />
                {idle && !running && !input && (
                  <button
                    className={"run-cue" + (poster ? " has-poster" : "")}
                    onClick={() => {
                      void run();
                      canvas.current?.focus();
                    }}
                  >
                    {poster && <img src={poster} alt="" />}
                    <span>{hostedCopy(poster ? "playShared" : "pressRun", locale)}</span>
                  </button>
                )}
              </div>
            </div>
            <div className="screen-foot">
              {input ? (
                <form
                  className="input-prompt"
                  onSubmit={(e) => {
                    e.preventDefault();
                    input.resolve(answer);
                  }}
                >
                  <label>
                    {input.prompt}
                    <input
                      autoFocus
                      aria-label={copy("input")}
                      value={answer}
                      maxLength={80}
                      onChange={(e) => setAnswer(e.target.value)}
                    />
                  </label>
                  <button type="submit" className="primary">
                    {copy("send")}
                  </button>
                </form>
              ) : (
                <>
                  {!viewOnly && playHelp && output.length === 0 && (
                    <p
                      className="game-controls workspace-controls play-help"
                      title={playHelp}
                    >
                      <strong>{copy("howToPlay")}:</strong> {playHelp}
                    </p>
                  )}
                  <div className="console" role="log">
                    {output.join("\n")}
                  </div>
                </>
              )}
            </div>
          </section>
          <section className="code-panel">
            <div className="code-heading">
              <h2>{copy("code")}</h2>
              {viewOnly && (
                <span className="muted small">
                  {copy("readOnlyCode").replace("{lines}", String(lines))}
                </span>
              )}
              {credit && <span className="remix-credit">{credit}</span>}
            </div>
            <Suspense fallback={<p>{copy("loading")}</p>}>
              <Editor
                readOnly={viewOnly}
                code={project.sourceCode}
                onChange={(sourceCode) => update({ sourceCode })}
                onRun={(source) => void run(source)}
                line={focusLine}
                label={copy("code")}
                insertRef={editorInsert}
                locale={locale}
                spells={reference}
                running={running}
                onOpenSpellbook={showSpell}
              />
            </Suspense>
            <div className={"status " + (error ? "error" : "")} role="status">
              {error && !fileError ? (
                <button
                  className="error"
                  onClick={() => {
                    setFocusLine(undefined);
                    setTimeout(() => setFocusLine(error.loc.line), 0);
                  }}
                >
                  {copy("line")
                    .replace("{line}", String(error.loc.line))
                    .replace(
                      "{message}",
                      message(error.code, error.params, locale),
                    )}
                </button>
              ) : error ? (
                message(error.code, error.params, locale)
              ) : (
                notice || copy(status as Parameters<typeof t>[0])
              )}
            </div>
          </section>
        </div>
      </div>
      <div className="drawer-handles">
        <button
          className="drawer-handle spellbook-handle"
          aria-expanded={drawer === "spellbook"}
          aria-controls="reference-drawer"
          onClick={(event) => {
            drawerOpener.current = event.currentTarget;
            setDrawer(drawer === "spellbook" ? null : "spellbook");
          }}
        >
          {copy("spellbook")}
        </button>
        <button
          className="drawer-handle examples-handle"
          aria-expanded={drawer === "examples"}
          aria-controls="reference-drawer"
          onClick={(event) => {
            drawerOpener.current = event.currentTarget;
            setDrawer(drawer === "examples" ? null : "examples");
          }}
        >
          {copy("examples")}
        </button>
        <button
          className="drawer-handle inventory-handle"
          aria-expanded={drawer === "inventory"}
          aria-controls="reference-drawer"
          onClick={(event) => {
            drawerOpener.current = event.currentTarget;
            setDrawer(drawer === "inventory" ? null : "inventory");
          }}
        >
          {copy("inventory")}
        </button>
      </div>
      {drawer && (
        <aside
          className={"drawer " + drawer}
          id="reference-drawer"
          aria-label={copy(drawer)}
        >
          <div className="drawer-heading">
            <h2>{copy(drawer)}</h2>
            <button onClick={() => closeDrawer()}>{copy("close")}</button>
          </div>
          <div className="drawer-content">
            {drawer === "inventory" && (
              <Inventory
                locale={locale}
                insert={insertAtCaret}
                preview={previewSound}
                previewUserSound={previewUserSoundFromInventory}
                stopPreview={stopPreviewSound}
                onClose={closeDrawer}
                canUseAssets={canUseAssets}
                userAssets={userAssets}
                userAssetsState={userAssetsState}
                focusAssetId={focusAssetId}
                onReloadAssets={() => void loadUserAssets()}
                userSounds={userSounds}
                onNewSprite={() => setSpriteEditor({})}
                onNewSound={(opener) => {
                  cancelSoundPreview();
                  soundOpener.current = opener;
                  setSoundEditor({});
                }}
                onEditSound={(soundId, opener) =>
                  void openUserSound(soundId, opener)
                }
                onEditAsset={(assetId) => void openUserAsset(assetId)}
                onInsertAsset={(assetId) => void insertUserAsset(assetId)}
                onInsertSound={(assetId) => void insertUserSound(assetId)}
                explain={(command) => {
                  setCategory("ALL");
                  setQuery(command);
                  setDrawer("spellbook");
                }}
              />
            )}
            {drawer === "examples" && (
              <div className="cards">
                {[
                  ...gallery.filter((ex) => ex.game),
                  ...gallery.filter((ex) => !ex.game),
                ].map((ex, index, list) => (
                  <article className="card" key={ex.id} data-example={ex.id}>
                    {(index === 0 || ex.game !== list[index - 1].game) && (
                      <h2>{copy(ex.game ? "games" : "toys")}</h2>
                    )}
                    {ex.game && <p className="progress">{copy("playable")}</p>}
                    <h3>{ex.title}</h3>
                    {ex.endless && (
                      <p className="progress">{copy("endless")}</p>
                    )}
                    <p>{ex.description}</p>
                    {ex.controls && (
                      <p className="game-controls">{ex.controls}</p>
                    )}
                    <p className="muted">{ex.tweak}</p>
                    <details>
                      <summary>{copy("code")}</summary>
                      <pre>{ex.code}</pre>
                    </details>
                    <div className="actions">
                      <button
                        onClick={() =>
                          loadGuarded(ex.code, {
                            exampleId: ex.id,
                            mode: "sandbox",
                            instructions: exampleInstructions(ex.id, locale),
                          })
                        }
                      >
                        {copy("load")}
                      </button>
                      <button
                        className="primary"
                        onClick={() => {
                          if (
                            loadGuarded(ex.code, {
                              exampleId: ex.id,
                              mode: "sandbox",
                              instructions: exampleInstructions(ex.id, locale),
                            })
                          )
                            void run(ex.code, true);
                        }}
                      >
                        {copy("try")}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
            {drawer === "spellbook" && (
              <>
                <a
                  className="button-link handbook-link"
                  href="/book"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {bookText(locale, "title")} ↗
                </a>
                <input
                  type="search"
                  aria-label={copy("search")}
                  placeholder={copy("search")}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <nav>
                  {["ALL", "DRAW", "LOGIC", "WORLD", "SOUND", "FLOW"].map(
                    (c) => (
                      <button
                        key={c}
                        aria-pressed={category === c}
                        onClick={() => setCategory(c)}
                      >
                        {copy(c.toLowerCase() as Parameters<typeof t>[0])}
                      </button>
                    ),
                  )}
                </nav>
                <p className="muted small">{copy("palette")}</p>
                <p className="muted small">{copy("referenceHint")}</p>
                {filtered.length === 0 && <p>{copy("noResults")}</p>}
                <div className="cards">
                  {filtered.map((s) => (
                    <article
                      className="card"
                      key={s.name}
                      data-spell-id={s.id}
                      tabIndex={-1}
                    >
                      <div className="card-head">
                        <h3>{s.name}</h3>
                        <span className="eyebrow">
                          {copy(
                            s.category.toLowerCase() as Parameters<typeof t>[0],
                          )}
                        </span>
                      </div>
                      <p className="spell-summary">{s.summary}</p>
                      <pre>{s.code}</pre>
                      <details className="spell-more">
                        <summary>{copy("more")}</summary>
                        <p>{s.description}</p>
                        <code>{s.syntax}</code>
                      </details>
                      <div className="actions">
                        <button
                          onClick={() => {
                            insert(s.code);
                          }}
                        >
                          {copy("insert")}
                        </button>
                        <button onClick={() => loadGuarded(s.code)}>
                          {copy("load")}
                        </button>
                        <button
                          onClick={() =>
                            void navigator.clipboard
                              ?.writeText(s.code)
                              .catch(() => {})
                          }
                        >
                          {copy("copy")}
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </>
            )}
          </div>
        </aside>
      )}
      {spriteEditor && (
        <Suspense fallback={null}>
          <PixelEditor
            locale={locale}
            asset={spriteEditor.asset ?? null}
            canSaveAnimation={animationAssetAdapter.available}
            onSave={saveSprite}
            onClose={() => setSpriteEditor(null)}
          />
        </Suspense>
      )}
      {soundEditor && (
        <Suspense fallback={null}>
          <SoundEditor
            locale={locale}
            adapter={soundDraftAdapter(canUseAssets)}
            asset={soundEditor.asset ?? null}
            returnFocus={soundOpener.current}
            onSaved={(saved) => {
              setFocusAssetId(`@${saved.alias}`);
              void loadUserSounds();
            }}
            onInsert={async (snippet, saved) => {
              setSoundEditor(null);
              if (canUseAssets && !(import.meta.env.DEV && window.__soundLabAdapter)) {
                try {
                  const asset = await soundAssetAdapter.load(saved.id);
                  setProject((current) => bindSoundToProject(current, asset));
                  insertAtCaret(soundInsertSnippet(asset));
                } catch (e) {
                  setError(e instanceof SpellError ? e : new SpellError("assetUnavailable"));
                }
              } else insertAtCaret(snippet);
            }}
            onClose={() => setSoundEditor(null)}
          />
        </Suspense>
      )}
      {viewerCaption && <footer>{viewerCaption(locale)}</footer>}
    </main>
  );
}
