import { describe, it, expect } from "vitest";
import { parse, SpellError } from "../src/runtime/language";
import { Engine, type Host } from "../src/runtime/engine";
function setup() {
  const output: string[] = [];
  const host: Host = {
    reset() {},
    stop() {},
    command() {},
    method() {},
    spawn(kind, x, y) {
      return {
        id: 1,
        kind,
        x,
        y,
        angle: 0,
        visible: true,
        alive: true,
        say: "",
      };
    },
    print(s) {
      output.push(s);
    },
    async input() {
      return "7";
    },
  };
  return { engine: new Engine(host), output, host };
}
describe("language", () => {
  it("precedence, case, strings and all expression forms", async () => {
    const { engine, output } = setup();
    await engine.run(
      'let x = 2 + 3 * 4\nPRINT x\nPRINT "Cat" + "!"\nPRINT ROUND(ABS(-2.3))\nPRINT SIN(0)+COS(0)\nPRINT TRUE\nPRINT (4+2)/3',
    );
    expect(output).toEqual(["14", "Cat!", "2", "1", "true", "2"]);
  });
  it("nested FOR / IF and descending STEP", async () => {
    const { engine, output } = setup();
    await engine.run(
      "FOR X=3 TO 1 STEP -1\nIF X >= 2 THEN\nFOR Y=1 TO 2\nPRINT X\nNEXT Y\nEND IF\nNEXT X",
    );
    expect(output).toEqual(["3", "3", "2", "2"]);
  });
  it("comments, methods, properties, random and input", async () => {
    const { engine, output } = setup();
    await engine.run(
      'REM hi\nCAT=SPAWN("cat",4,5)\nCAT.MOVE 1,2\nPRINT CAT.X\nN=0\nINPUT "Number",N\nPRINT N+1\nPRINT RND(2,2)',
    );
    expect(output).toEqual(["4", "8", "2"]);
  });
  it.each([
    "IF TRUE THEN\nPRINT 1",
    "FOR X=1 TO 3\nPRINT X",
    'PRINT "oops',
    "FOR X 1 TO 4",
    "PRINT @",
  ])("friendly located parse failure %s", (s) => {
    expect(() => parse(s)).toThrow(SpellError);
  });
  it("stops empty huge loops safely", async () => {
    const { engine } = setup();
    await expect(
      engine.run("FOR X=1 TO 999999999\nNEXT X"),
    ).rejects.toMatchObject({ code: "limit" });
  });
  it("interrupts waits", async () => {
    const { engine } = setup();
    const run = engine.run("WAIT 30\nPRINT 2");
    engine.stop();
    await expect(run).rejects.toMatchObject({ code: "stopped" });
  });
  it("does not expose JS globals", async () => {
    const { engine } = setup();
    await expect(engine.run("PRINT window")).rejects.toMatchObject({
      code: "variable",
    });
    await expect(engine.run('eval "alert(1)"')).rejects.toMatchObject({
      code: "unknown",
    });
  });
  it("explains functions used as statements instead of calling them unknown", async () => {
    const { engine } = setup();
    for (const source of ['SPAWN "cat",10,10', "RND 5"])
      await expect(engine.run(source)).rejects.toMatchObject({
        code: "functionStatement",
        loc: { line: 1 },
      });
  });
  it("typo guidance and finite limits", async () => {
    const { engine } = setup();
    await expect(engine.run("CIRLCE 1,2,3")).rejects.toMatchObject({
      params: { suggestion: "CIRCLE" },
    });
    await expect(engine.run("PRINT 1/0")).rejects.toMatchObject({
      code: "zero",
    });
  });
});
