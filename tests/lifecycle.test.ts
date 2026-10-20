import { afterEach, describe, it, expect, vi } from "vitest";
import { Engine } from "../src/runtime/engine";
import { World } from "../src/runtime/world";
import { AudioToy } from "../src/runtime/audio";
import { parse } from "../src/runtime/language";
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("cancellation and resource ownership", () => {
  it("clears wait timers and does not stop a newer run from an old catch", async () => {
    vi.useFakeTimers();
    const world = new World();
    const old = new Engine(world);
    const promise = old.run("WAIT 30");
    const stopped = expect(promise).rejects.toMatchObject({ code: "stopped" });
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);
    old.stop();
    expect(vi.getTimerCount()).toBe(0);
    const spy = vi.spyOn(world, "stop");
    const next = new Engine(world);
    await next.run("INK 4\nPLOT 1,1");
    await stopped;
    expect(spy).toHaveBeenCalledTimes(1);
    expect(world.shapes).toHaveLength(1);
  });
  it("input resumes or aborts without a leftover callback", async () => {
    const world = new World();
    let resolver: (s: string) => void = () => {};
    world.ask = (_prompt, signal) =>
      new Promise((resolve, reject) => {
        resolver = (s) => {
          signal.removeEventListener("abort", abort);
          resolve(s);
        };
        const abort = () => reject({ code: "stopped" });
        signal.addEventListener("abort", abort, { once: true });
      });
    const engine = new Engine(world);
    const run = engine.run('INPUT "Name",N\nPRINT N');
    await Promise.resolve();
    resolver("Mira");
    await run;
    expect(engine.variables.get("N")).toBe("Mira");
    const other = new Engine(world);
    const waiting = other.run('INPUT "Name",N');
    other.stop();
    await expect(waiting).rejects.toHaveProperty("code");
  });
  it("cancels every active audio node", () => {
    const audio = new AudioToy();
    const stops: unknown[] = [],
      disconnects: unknown[] = [];
    const param = { setValueAtTime() {}, exponentialRampToValueAtTime() {} };
    audio.context = {
      currentTime: 0,
      destination: {},
      createOscillator() {
        return {
          frequency: param,
          connect() {},
          start() {},
          stop(time?: number) {
            if (time === undefined) stops.push(1);
          },
          disconnect() {
            disconnects.push(1);
          },
        };
      },
      createGain() {
        return { gain: param, connect() {}, disconnect() {} };
      },
    } as unknown as AudioContext;
    audio.tone(440, 1);
    audio.tone(880, 1);
    expect(audio.nodes.size).toBe(2);
    audio.stop();
    expect(audio.nodes.size).toBe(0);
    expect(stops).toHaveLength(2);
    expect(disconnects).toHaveLength(2);
  });
  it("bounds identifiers, strings and parser nesting", () => {
    expect(() => parse("X".repeat(10000))).toThrow();
    expect(() => parse('PRINT "' + "A".repeat(3000) + '"')).toThrow();
    expect(() =>
      parse("PRINT " + "(".repeat(100) + "1" + ")".repeat(100)),
    ).toThrow();
  });
  it("preserves the typed spelling of unknown commands and methods", async () => {
    const e = new Engine(new World());
    await expect(e.run("Cirlce 1,2,3")).rejects.toMatchObject({
      params: { value: "Cirlce", suggestion: "CIRCLE" },
    });
    const other = new Engine(new World());
    await expect(
      other.run('CAT=SPAWN("cat",1,2)\nCAT.Exlplode'),
    ).rejects.toMatchObject({
      params: { value: "Exlplode", suggestion: "EXPLODE" },
    });
  });
});
