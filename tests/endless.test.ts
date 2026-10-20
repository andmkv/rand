import { it, expect, vi, afterEach } from "vitest";
import { parse } from "../src/runtime/language";
import { World } from "../src/runtime/world";
import { Engine } from "../src/runtime/engine";
import { examples } from "../src/content/examples";
afterEach(() => vi.useRealTimers());
it("parses nested DO, FOR and IF and reports missing LOOP", () => {
  expect(
    parse(
      "DO\nFOR X=1 TO 2\nIF TRUE THEN\nDO\nWAIT 0.01\nLOOP\nEND IF\nNEXT X\nLOOP",
    )[0],
  ).toMatchObject({ type: "do" });
  expect(() => parse("DO\nPRINT 1")).toThrow();
});
it("tight empty DO yields, survives former totals, and STOP removes its timer", async () => {
  vi.useFakeTimers();
  const e = new Engine(new World());
  const done = e.run("DO\nLOOP");
  const stopped = expect(done).rejects.toMatchObject({ code: "stopped" });
  await vi.advanceTimersByTimeAsync(130000);
  expect(e.iterations).toBeGreaterThan(10000);
  expect(e.controller.signal.aborted).toBe(false);
  expect(vi.getTimerCount()).toBe(1);
  e.stop();
  await stopped;
  expect(vi.getTimerCount()).toBe(0);
}, 20000);
it("survives the old statement limit without WAIT", async () => {
  vi.useFakeTimers();
  const e = new Engine(new World());
  const done = e.run("X=0\nDO\nX=X+1\nLOOP");
  const stopped = expect(done).rejects.toMatchObject({ code: "stopped" });
  await vi.advanceTimersByTimeAsync(12000);
  expect(e.statements).toBeGreaterThan(30000);
  expect(e.variables.get("X")).toBeGreaterThan(10000);
  e.stop();
  await stopped;
});
it.each(examples.filter((e) => e.endless))(
  "bounded extended simulation: $title",
  async (example) => {
    vi.useFakeTimers();
    const w = new World(),
      e = new Engine(w);
    const done = e.run(example.code);
    const stopped = expect(done).rejects.toMatchObject({ code: "stopped" });
    await vi.advanceTimersByTimeAsync(135000);
    expect(e.longRunning).toBe(true);
    expect(w.shapes.length).toBeLessThanOrEqual(512);
    expect(w.events.length).toBeLessThanOrEqual(256);
    expect(w.eventCounts.size).toBeLessThanOrEqual(64);
    expect(w.pixels.byteLength + w.owners.byteLength).toBe(245760);
    expect(w.objects.length).toBeLessThanOrEqual(128);
    expect(e.audioTimes.length).toBeLessThanOrEqual(32);
    e.stop();
    await stopped;
    expect(vi.getTimerCount()).toBe(0);
  },
  20000,
);
