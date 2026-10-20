import { afterEach, expect, it, vi } from "vitest";
import { Engine, type Sprite } from "../src/runtime/engine";
import { World } from "../src/runtime/world";
import { games } from "../src/content/games";
import { parse } from "../src/runtime/language";

afterEach(() => vi.useRealTimers());
function setup() {
  const world = new World();
  const output: string[] = [];
  world.onPrint = (text) => output.push(text);
  const engine = new Engine(world);
  return { world, engine, output };
}
it("boolean precedence, short circuit, NOT comparisons and nested ELSE", async () => {
  const { engine, output } = setup();
  await engine.run(`PRINT 2+3*4=14 AND NOT 2=3 OR FALSE
PRINT FALSE AND MISSING
PRINT TRUE OR MISSING
IF FALSE THEN
 PRINT 0
ELSE
 IF NOT FALSE THEN
  PRINT "chosen"
 ELSE
  PRINT 2
 END IF
END IF`);
  expect(output).toEqual(["true", "false", "true", "chosen"]);
  expect(() => parse("ELSE\nPRINT 1")).toThrow();
  expect(() => parse("IF TRUE THEN\nELSE\nELSE\nEND IF")).toThrow();
});
it("lists keep sprite references, use 1-based indexes and bound capacity", async () => {
  const { engine, output } = setup();
  await engine.run(
    'A=LIST(4,"hi")\nB=SPAWN("cat",1,2)\nPUSH A,B\nC=ITEM(A,3)\nC.MOVE 20,30\nPRINT B.X\nPRINT COUNT(A)',
  );
  expect(output).toEqual(["20", "3"]);
  for (const source of [
    "PRINT ITEM(LIST(1),0)",
    "PRINT ITEM(LIST(),1)",
    "PRINT COUNT(2)",
    "A=LIST()\nPUSH A,A",
    "A=LIST(LIST())",
  ]) {
    await expect(new Engine(new World()).run(source)).rejects.toHaveProperty(
      "code",
    );
  }
  await expect(
    new Engine(new World()).run("A=LIST()\nFOR I=1 TO 129\nPUSH A,I\nNEXT I"),
  ).rejects.toMatchObject({ code: "limit" });
});
it("HIT respects size, edges, hidden and destroyed sprites", async () => {
  const { engine, output } = setup();
  await engine.run(
    'A=SPAWN("paddle",30,20)\nA.SIZE 40,8\nB=SPAWN("ball",52,20)\nB.SIZE 6,6\nPRINT HIT(A,B)\nB.MOVE 53,20\nPRINT HIT(A,B)\nB.MOVE 30,20\nB.HIDE\nPRINT HIT(A,B)\nB.DESTROY\nPRINT HIT(A,B)\nPRINT B.ALIVE\nPRINT A.WIDTH+A.HEIGHT',
  );
  expect(output).toEqual(["true", "false", "false", "false", "false", "48"]);
});
it("validates input, sizes and nonblocking audio with shared budgets", async () => {
  for (const source of [
    'PRINT KEY("ESCAPE")',
    "PRINT KEY()",
    'A=SPAWN("cat",1,1)\nA.SIZE 0,8',
    'A=SPAWN("cat",1,1)\nA.SIZE 8.5,8',
    "PRINT HIT(2,3)",
    "FRAME 1",
    'SFX "missing"',
  ]) {
    await expect(new Engine(new World()).run(source)).rejects.toHaveProperty(
      "code",
    );
  }
  const { world, engine } = setup();
  const wait = vi.spyOn(engine, "wait");
  const sound = vi.spyOn(world.audio, "effect");
  await engine.run('SFX "coin"');
  expect(sound).toHaveBeenCalledWith("coin");
  expect(wait).not.toHaveBeenCalled();
  const boundedWorld = new World();
  const boundedSound = vi.spyOn(boundedWorld.audio, "effect");
  const boundedEngine = new Engine(boundedWorld, undefined, () => 0);
  boundedEngine.wait = async () => {};
  await boundedEngine.run('FOR I=1 TO 33\nSFX "coin"\nNEXT I');
  expect(boundedSound).toHaveBeenCalledTimes(32);
});

type Driver = (engine: Engine, world: World, frame: number) => boolean | void;
async function simulate(id: string, driver: Driver, max = 3000) {
  vi.useFakeTimers();
  const { world, engine } = setup();
  let frames = 0;
  let completed = false;
  engine.yieldFrame = async () => {
    engine.work = 0;
    engine.drawCommands = 0;
    engine.drawWork = 0;
    engine.sliceStart = Date.now();
    if ((engine.loc as { name?: string }).name === "FRAME") {
      frames++;
      vi.setSystemTime(Date.now() + 17);
      world.keys.clear();
      completed = driver(engine, world, frames) === true;
      if (completed || frames >= max) engine.stop();
    }
    engine.sliceStart = Date.now();
    engine.check();
  };
  await expect(
    engine.run(games.find((g) => g.id === id)!.code),
  ).rejects.toMatchObject({ code: "stopped" });
  expect(world.objects.length).toBeLessThanOrEqual(24);
  expect(world.events.length).toBeLessThanOrEqual(256);
  expect(world.audio.nodes.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  return { engine, world, frames, completed };
}
it("alien wave can be beaten by steering and firing, then restarted", async () => {
  let won = false;
  const result = await simulate("alien-attack", (engine, world) => {
    const state = engine.variables.get("STATE");
    if (state === 2) {
      won = true;
      world.keys.add("R");
      return;
    }
    if (won && state === 1 && engine.variables.get("SCORE") === 0) return true;
    const ship = engine.variables.get("SHIP") as Sprite;
    const target = world.objects.find((s) => s.kind === "alien" && s.visible);
    if (!target) return;
    const lead =
      ((164 - target.y) / 4) *
      Number(engine.variables.get("SPEED")) *
      Number(engine.variables.get("DIRECTION"));
    const dx = target.x + lead - ship.x;
    if (dx < -2) world.keys.add("LEFT");
    if (dx > 2) world.keys.add("RIGHT");
    if (Math.abs(dx) <= 5) world.keys.add("SPACE");
  });
  expect(
    result.completed,
    JSON.stringify(
      Object.fromEntries(
        [...result.engine.variables].filter(([, v]) => typeof v !== "object"),
      ),
    ),
  ).toBe(true);
  expect(won).toBe(true);
});
it("brick wall can be cleared with paddle input and restarted", async () => {
  let won = false;
  const result = await simulate(
    "brick-breaker",
    (engine, world, frame) => {
      const state = engine.variables.get("STATE");
      if (state === 2) {
        won = true;
        world.keys.add("R");
        return;
      }
      if (won && state === 1 && engine.variables.get("SCORE") === 0)
        return true;
      const paddle = engine.variables.get("PADDLE") as Sprite;
      const ball = engine.variables.get("BALL") as Sprite;
      const target = world.objects.find(
        (s) => s.visible && s.kind.startsWith("brick_"),
      );
      const flight = target ? (174 - target.y) / 2 : 60;
      // Aim the rebound toward the next remaining brick, steering only with keys.
      const desiredVx = target
        ? Math.max(-1.6, Math.min(1.6, (target.x - ball.x) / flight))
        : 1;
      const offset = desiredVx * 10;
      const dx = ball.x - offset - paddle.x;
      if (dx < -1) world.keys.add("LEFT");
      if (dx > 1) world.keys.add("RIGHT");
    },
    12000,
  );
  expect(
    result.completed,
    JSON.stringify(
      Object.fromEntries(
        [...result.engine.variables].filter(([, v]) => typeof v !== "object"),
      ),
    ),
  ).toBe(true);
  expect(won).toBe(true);
}, 20000);
it.each(games)(
  "$title has a loss and a working restart",
  async (game) => {
    let lost = false;
    const result = await simulate(
      game.id,
      (engine, world) => {
        const state = engine.variables.get("STATE");
        if (state === 3) {
          lost = true;
          world.keys.add("R");
          return;
        }
        if (lost && state === 1 && engine.variables.get("SCORE") === 0)
          return true;
        if (game.id === "pixel-quest") world.keys.add("RIGHT");
      },
      5000,
    );
    expect(
      result.completed,
      JSON.stringify(
        Object.fromEntries(
          [...result.engine.variables].filter(([, v]) => typeof v !== "object"),
        ),
      ),
    ).toBe(true);
    expect(lost).toBe(true);
    if (game.id === "alien-attack")
      expect(result.world.eventCounts.get("SFX")).toBe(1);
  },
  20000,
);
it("quest can be completed by walking and jumping across the actual level", async () => {
  let stage = 0;
  const result = await simulate(
    "pixel-quest",
    (engine, world) => {
      if (engine.variables.get("STATE") === 2) return true;
      if (engine.variables.get("STATE") === 3) return;
      const x = Number(engine.variables.get("X"));
      const grounded = engine.variables.get("GROUNDED");
      // Move onto each ledge, release jump, then jump to the next one.
      const targets = [108, 180, 244];
      const target = targets[stage];
      if (x < target) world.keys.add("RIGHT");
      if (grounded && (stage === 0 ? x >= 44 : true)) world.keys.add("SPACE");
      if (grounded && x >= target - 3) stage++;
      if (stage > 2) stage = 2;
    },
    1200,
  );
  expect(
    result.completed,
    JSON.stringify(
      Object.fromEntries(
        [...result.engine.variables].filter(([, v]) => typeof v !== "object"),
      ),
    ),
  ).toBe(true);
  expect(result.engine.variables.get("SCORE")).toBe(2);
});

it.each(games)(
  "$title keeps resources bounded over three simulated minutes and repeated restarts",
  async (game) => {
    const result = await simulate(
      game.id,
      (_engine, world, frame) => {
        world.keys.add("R");
        world.keys.add(frame % 120 < 60 ? "RIGHT" : "LEFT");
        if (frame % 30 < 15) world.keys.add("SPACE");
      },
      10800,
    );
    expect(result.frames).toBe(10800);
    expect(result.world.objects).toHaveLength(
      game.id === "alien-attack" ? 12 : game.id === "brick-breaker" ? 20 : 9,
    );
    expect(result.world.shapes.length).toBeLessThanOrEqual(512);
    expect(result.engine.audioTimes.length).toBeLessThanOrEqual(32);
    expect(result.world.pixels).toHaveLength(49152);
  },
  20000,
);
