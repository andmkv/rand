import { describe, expect, test } from "vitest";
import { DemoStore } from "../server/demo-store";
import type { DemoConfig } from "../server/demo-config";
import type { ProjectSnapshot } from "../shared/project";
import { instructionsMax } from "../shared/limits";

const config = (over: Partial<DemoConfig> = {}): DemoConfig => ({
  enabled: true,
  idleMs: 60_000,
  absoluteMs: 3_600_000,
  maxSessions: 5,
  maxSessionsPerIp: 2,
  maxProjects: 3,
  maxRevisions: 3,
  maxSessionBytes: 20_000,
  maxStoreBytes: 60_000,
  loginPer15Minutes: 10,
  tombstoneMs: 600_000,
  requestPerMinute: 100,
  publicationsPer15Minutes: 5,
  previewsPer15Minutes: 5,
  ...over,
});

const snapshot = (
  title = "Demo",
  sourceCode = "CLS",
  instructions = "",
): ProjectSnapshot => {
  const at = new Date(1_700_000_000_000).toISOString();
  return {
    format: "randusr",
    version: 2,
    title,
    instructions,
    sourceCode,
    mode: "sandbox",
    createdAt: at,
    updatedAt: at,
    storyId: "tower",
    sceneId: 0,
    unlocked: 0,
    exampleId: null,
  };
};

const clock = (start = 1_000_000) => {
  const time = { value: start };
  return { time, now: () => time.value };
};

describe("DemoStore isolation and lifecycle", () => {
  test("projects are owned by one session and versioned", () => {
    const store = new DemoStore(config(), clock().now, 0);
    const a = store.create("127.0.0.1").session;
    const b = store.create("127.0.0.1").session;
    const p = store.createProject(a, snapshot("A"));
    expect(store.getProject(a, p.id).title).toBe("A");
    expect(() => store.getProject(b, p.id)).toThrow(/NOT_FOUND/);
    expect(() =>
      store.saveProject(b, p.id, p.version, snapshot("Stolen")),
    ).toThrow(/NOT_FOUND/);
    const saved = store.saveProject(a, p.id, 1, snapshot("A2"));
    expect(saved.version).toBe(2);
    expect(() => store.saveProject(a, p.id, 1, snapshot("stale"))).toThrow(
      /VERSION_CONFLICT/,
    );
    expect(store.listProjects(b, { archived: false }).projects).toHaveLength(0);
  });

  test("gallery is per-session and never mixes other demo sessions", () => {
    const store = new DemoStore(config(), clock().now, 0);
    const a = store.create("127.0.0.1").session;
    const b = store.create("127.0.0.1").session;
    const p = store.createProject(a, snapshot("Public"));
    store.publish(
      a,
      p.id,
      { version: 1, visibility: "public", title: "Public" },
      "http://localhost:5173",
    );
    expect(store.gallery(a, {}).projects).toHaveLength(1);
    expect(store.gallery(b, {}).projects).toHaveLength(0);
  });

  test("private shares stay owner-only, unlisted opens without a session", () => {
    const store = new DemoStore(config(), clock().now, 0);
    const a = store.create("127.0.0.1").session;
    const b = store.create("127.0.0.1").session;
    const p = store.createProject(a, snapshot("Secret"));
    expect(store.shared(a, p.shortCode).visibility).toBe("private");
    expect(() => store.shared(b, p.shortCode)).toThrow(/NOT_FOUND/);
    expect(() => store.publicShared(p.shortCode)).toThrow(/NOT_FOUND/);
    store.publish(
      a,
      p.id,
      { version: 1, visibility: "unlisted", title: "Secret" },
      "http://localhost:5173",
    );
    expect(store.shared(b, p.shortCode).visibility).toBe("unlisted");
    expect(store.publicShared(p.shortCode).title).toBe("Secret");
    // A different demo session can view, but cannot remix into its own library.
    expect(() => store.remix(b, p.shortCode)).toThrow(/DEMO_FOREIGN_REMIX/);
  });

  test("remix creates an independent private copy in the same session", () => {
    const store = new DemoStore(config(), clock().now, 0);
    const a = store.create("127.0.0.1").session;
    const p = store.createProject(a, snapshot("Original", 'TEXT 1,1,"hi"'));
    store.publish(
      a,
      p.id,
      { version: 1, visibility: "public", title: "Original" },
      "http://localhost:5173",
    );
    const copy = store.remix(a, p.shortCode);
    expect(copy.id).not.toBe(p.id);
    expect(copy.visibility).toBe("private");
    expect(copy.version).toBe(1);
    expect(copy.snapshot.sourceCode).toBe('TEXT 1,1,"hi"');
    const updated = store.saveProject(a, p.id, 2, snapshot("Changed"));
    expect(copy.snapshot.title).toBe("Original");
    expect(updated.title).toBe("Changed");
  });

  test("instructions survive Demo revisions, pinned publications, duplicate and remix", () => {
    const store = new DemoStore(
      config({ maxProjects: 10, maxRevisions: 10 }),
      clock().now,
      0,
    );
    const a = store.create("127.0.0.1").session;
    const original = "← → — движение\n日本語 🎮 <script>alert(1)</script>";
    const draft = "Draft instructions\n<img src=x>";
    const later = "Later instructions\n🧪";
    const project = store.createProject(
      a,
      snapshot("Original", "CLS", original),
    );
    const saved = store.saveProject(
      a,
      project.id,
      project.version,
      snapshot("Original", "CLS", draft),
    );
    const published = store.publish(
      a,
      project.id,
      { version: saved.version, visibility: "public", title: "Published" },
      "http://localhost:5173",
    );
    expect(store.publicShared(project.shortCode).snapshot.instructions).toBe(
      draft,
    );

    const changed = store.saveProject(
      a,
      project.id,
      published.version,
      snapshot("Original", "CLS", later),
    );
    expect(store.publicShared(project.shortCode).snapshot.instructions).toBe(
      draft,
    );
    const remix = store.remix(a, project.shortCode);
    expect(remix.snapshot.instructions).toBe(draft);
    const duplicate = store.duplicateProject(a, project.id, changed.version);
    expect(duplicate.snapshot.instructions).toBe(later);

    const first = store
      .revisions(a, project.id)
      .revisions.find((r) => r.number === 1)!;
    expect(store.revision(a, project.id, first.id).snapshot.instructions).toBe(
      original,
    );
    const restored = store.restoreRevision(
      a,
      project.id,
      first.id,
      changed.version,
    );
    expect(restored.snapshot.instructions).toBe(original);
    expect(() =>
      store.createProject(
        a,
        snapshot("Too long", "CLS", "🎮".repeat(instructionsMax + 1)),
      ),
    ).toThrow(/INVALID_INPUT/);
  });

  test("revisions are bounded and restorable", () => {
    const store = new DemoStore(config({ maxRevisions: 2 }), clock().now, 0);
    const a = store.create("127.0.0.1").session;
    const p = store.createProject(a, snapshot("v1"));
    let version = 1;
    for (let i = 2; i <= 5; i++) {
      const saved = store.saveProject(a, p.id, version, snapshot(`v${i}`));
      version = saved.version;
    }
    const list = store.revisions(a, p.id);
    expect(list.revisions.length).toBeLessThanOrEqual(2);
    const oldestKept = list.revisions.at(-1)!;
    const restored = store.restoreRevision(a, p.id, oldestKept.id, version);
    expect(restored.version).toBe(version + 1);
    expect(store.revisions(a, p.id).revisions.length).toBeLessThanOrEqual(2);
  });

  test("idle expiry destroys data and tombstones public links", () => {
    const { time, now } = clock();
    const store = new DemoStore(config({ idleMs: 1000 }), now, 0);
    const login = store.create("127.0.0.1");
    const p = store.createProject(login.session, snapshot("Gone"));
    store.publish(
      login.session,
      p.id,
      { version: 1, visibility: "public", title: "Gone" },
      "http://localhost:5173",
    );
    time.value += 1001;
    expect(store.resolve(login.token)).toBeNull();
    expect(() => store.publicShared(p.shortCode)).toThrow(/DEMO_EXPIRED/);
    expect(store.stats().sessions).toBe(0);
    expect(store.stats().bytes).toBe(0);
  });

  test("absolute lifetime expires even with activity", () => {
    const { time, now } = clock();
    const store = new DemoStore(
      config({ idleMs: 10_000, absoluteMs: 5000 }),
      now,
      0,
    );
    const login = store.create("127.0.0.1");
    time.value += 4000;
    expect(store.resolve(login.token)).not.toBeNull();
    time.value += 1001;
    expect(store.resolve(login.token)).toBeNull();
  });

  test("logout destroys the session and its share link", () => {
    const store = new DemoStore(config(), clock().now, 0);
    const login = store.create("127.0.0.1");
    const p = store.createProject(login.session, snapshot("Bye"));
    store.publish(
      login.session,
      p.id,
      { version: 1, visibility: "unlisted", title: "Bye" },
      "http://localhost:5173",
    );
    store.destroy(login.session, "logout");
    expect(store.resolve(login.token)).toBeNull();
    expect(() => store.publicShared(p.shortCode)).toThrow(/DEMO_EXPIRED/);
  });

  test("project count, session bytes and total bytes are hard caps", () => {
    const store = new DemoStore(
      config({ maxProjects: 2, maxSessionBytes: 3000, maxStoreBytes: 5000 }),
      clock().now,
      0,
    );
    const a = store.create("127.0.0.1").session;
    store.createProject(a, snapshot("one"));
    store.createProject(a, snapshot("two"));
    expect(() => store.createProject(a, snapshot("three"))).toThrow(
      /QUOTA_EXCEEDED/,
    );
    const big = "x".repeat(5000);
    const b = store.create("127.0.0.2").session;
    expect(() => store.createProject(b, snapshot("big", big))).toThrow(
      /QUOTA_EXCEEDED/,
    );
  });

  test("session count per IP and request budget are enforced", () => {
    const store = new DemoStore(
      config({ maxSessionsPerIp: 1, requestPerMinute: 2 }),
      clock().now,
      0,
    );
    const first = store.create("10.0.0.1").session;
    expect(() => store.create("10.0.0.1")).toThrow(/RATE_LIMITED/);
    expect(store.allowRequest(first)).toBe(true);
    expect(store.allowRequest(first)).toBe(true);
    expect(store.allowRequest(first)).toBe(false);
  });

  test("previews stay scoped to their project and publication", () => {
    const store = new DemoStore(config(), clock().now, 0);
    const a = store.create("127.0.0.1").session;
    const p = store.createProject(a, snapshot("Shot"));
    const png = Buffer.alloc(64, 1);
    const key = store.storePreview(a, p.id, png);
    expect(store.projectPreview(a, p.id, key).length).toBe(64);
    expect(() => store.sharedPreview(p.shortCode, key)).toThrow(/NOT_FOUND/);
    store.publish(
      a,
      p.id,
      {
        version: 1,
        visibility: "public",
        title: "Shot",
        previewPng: png,
      },
      "http://localhost:5173",
    );
    const publishedKey = store.getProject(a, p.id).publishedMetadata!
      .previewKey!;
    expect(store.sharedPreview(p.shortCode, publishedKey).length).toBe(64);
  });
});
