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
  return { engine: new Engine(host), output };
}

async function run(source: string) {
  const { engine, output } = setup();
  await engine.run(source);
  return output;
}

async function failure(source: string): Promise<SpellError> {
  try {
    await run(source);
  } catch (e) {
    return e as SpellError;
  }
  throw new Error("expected the program to fail");
}

describe("EXIT DO / EXIT FOR", () => {
  it("leaves an endless DO loop", async () => {
    expect(
      await run(
        "N = 0\nDO\n  N = N + 1\n  IF N = 3 THEN\n    EXIT DO\n  END IF\nLOOP\nPRINT N",
      ),
    ).toEqual(["3"]);
  });
  it("EXIT DO leaves the DO even from inside a FOR", async () => {
    expect(
      await run(
        "DO\n  FOR N = 1 TO 5\n    PRINT N\n    IF N = 2 THEN\n      EXIT DO\n    END IF\n  NEXT N\nLOOP\nPRINT 99",
      ),
    ).toEqual(["1", "2", "99"]);
  });
  it("EXIT FOR leaves only the innermost FOR", async () => {
    expect(
      await run(
        "FOR A = 1 TO 2\n  FOR B = 1 TO 5\n    IF B = 2 THEN\n      EXIT FOR\n    END IF\n    PRINT A * 10 + B\n  NEXT B\nNEXT A",
      ),
    ).toEqual(["11", "21"]);
  });
  it("EXIT FOR works from inside a DO inside a FOR", async () => {
    expect(
      await run(
        "FOR A = 1 TO 3\n  DO\n    PRINT A\n    EXIT FOR\n  LOOP\nNEXT A\nPRINT 0",
      ),
    ).toEqual(["1", "0"]);
  });
  it.each([
    "EXIT DO",
    "EXIT FOR",
    "EXIT SUB",
    "FOR N = 1 TO 2\n  EXIT DO\nNEXT N",
    "DO\n  EXIT FOR\nLOOP",
    "SUB A\n  EXIT DO\nEND SUB\nDO\n  CALL A\n  EXIT DO\nLOOP",
    "EXIT",
    "EXIT WHILE",
  ])("rejects an EXIT without a matching block: %s", (source) => {
    expect(() => parse(source)).toThrow(SpellError);
  });
  it("still allows variables called EXIT, SUB and CALL", async () => {
    expect(await run("EXIT = 1\nSUB = 2\nCALL = 3\nPRINT EXIT + SUB + CALL")).toEqual([
      "6",
    ]);
  });
});

describe("SUB / CALL", () => {
  it("runs a SUB that shares the program's variables", async () => {
    expect(
      await run(
        "SCORE = 0\nSUB SCORED\n  SCORE = SCORE + 5\nEND SUB\nCALL SCORED\nCALL SCORED\nPRINT SCORE",
      ),
    ).toEqual(["10"]);
  });
  it("lets CALL come before the SUB it names", async () => {
    expect(
      await run('CALL HELLO\nSUB HELLO\n  PRINT "hi"\nEND SUB'),
    ).toEqual(["hi"]);
  });
  it("SUB can call another SUB and EXIT SUB returns early", async () => {
    expect(
      await run(
        'SUB INNER\n  PRINT "inner"\nEND SUB\nSUB OUTER\n  CALL INNER\n  IF TRUE THEN\n    EXIT SUB\n  END IF\n  PRINT "never"\nEND SUB\nCALL OUTER\nPRINT "done"',
      ),
    ).toEqual(["inner", "done"]);
  });
  it("EXIT DO and EXIT FOR work inside a SUB", async () => {
    expect(
      await run(
        "SUB COUNTUP\n  N = 0\n  DO\n    N = N + 1\n    IF N = 4 THEN\n      EXIT DO\n    END IF\n  LOOP\nEND SUB\nCALL COUNTUP\nPRINT N",
      ),
    ).toEqual(["4"]);
  });
  it("stops runaway recursion with the friendly limit error", async () => {
    const error = await failure("SUB LOOPY\n  CALL LOOPY\nEND SUB\nCALL LOOPY");
    expect(error.code).toBe("limit");
  });
  it("allows shallow recursion", async () => {
    expect(
      await run(
        "N = 0\nSUB UP\n  N = N + 1\n  IF N < 10 THEN\n    CALL UP\n  END IF\nEND SUB\nCALL UP\nPRINT N",
      ),
    ).toEqual(["10"]);
  });
  it("suggests a name when CALL does not match a SUB", async () => {
    const error = await failure("SUB DRAW_TREE\nEND SUB\nCALL DRAW_TRE");
    expect(error.code).toBe("unknown");
    expect(error.params.suggestion).toBe("DRAW_TREE");
    expect(error.loc.line).toBe(3);
  });
  it("rejects an unknown CALL even if it never runs", async () => {
    const error = await failure("IF FALSE THEN\n  CALL NOPE\nEND IF");
    expect(error.code).toBe("unknown");
  });
  it("rejects two SUBs with the same name", async () => {
    const error = await failure("SUB A\nEND SUB\nSUB A\nEND SUB");
    expect(error.code).toBe("expected");
  });
  it.each([
    "IF TRUE THEN\n  SUB A\n  END SUB\nEND IF",
    "DO\n  SUB A\n  END SUB\nLOOP",
    "SUB A\n  SUB B\n  END SUB\nEND SUB",
    "SUB A\nPRINT 1",
    "SUB\nEND SUB",
    "CALL",
  ])("rejects a badly built SUB: %s", (source) => {
    expect(() => parse(source)).toThrow(SpellError);
  });
  it("a SUB with a DO and no CALL elsewhere still makes the run long-running", async () => {
    const { engine } = setup();
    await engine.run("SUB A\n  DO\n    EXIT DO\n  LOOP\nEND SUB\nCALL A");
    expect(engine.longRunning).toBe(true);
  });
});

describe("SET and lists", () => {
  it("changes one item of a list", async () => {
    expect(
      await run(
        "L = LIST(1,2,3)\nSET L,2,20\nPRINT ITEM(L,1)\nPRINT ITEM(L,2)\nPRINT COUNT(L)",
      ),
    ).toEqual(["1", "20", "3"]);
  });
  it("shares the list like PUSH does", async () => {
    expect(
      await run("A = LIST(0,0)\nB = A\nSET B,1,7\nPRINT ITEM(A,1)"),
    ).toEqual(["7"]);
  });
  it("can hold words and sprites", async () => {
    expect(
      await run('L = LIST("a","b")\nSET L,1,"z"\nPRINT ITEM(L,1)'),
    ).toEqual(["z"]);
  });
  it.each([
    "L = LIST(1,2)\nSET L,0,5",
    "L = LIST(1,2)\nSET L,3,5",
    "L = LIST(1,2)\nSET L,1.5,5",
    "L = LIST()\nSET L,1,5",
  ])("keeps the index rule: %s", async (source) => {
    expect((await failure(source)).code).toBe("index");
  });
  it("only stores flat values and needs a list", async () => {
    expect((await failure("L = LIST(1)\nSET L,1,LIST(2)")).code).toBe("list");
    expect((await failure("SET 5,1,2")).code).toBe("list");
    expect((await failure("L = LIST(1)\nSET L,1")).code).toBe("args");
  });
  it("still lets a variable be called SET", async () => {
    expect(await run("SET = 4\nPRINT SET")).toEqual(["4"]);
  });
});

describe("MIN MAX INT MOD", () => {
  it("MIN and MAX", async () => {
    expect(
      await run("PRINT MIN(3,7)\nPRINT MAX(3,7)\nPRINT MIN(-1,-2)\nPRINT MAX(4,4)"),
    ).toEqual(["3", "7", "-2", "4"]);
  });
  it("INT rounds down", async () => {
    expect(await run("PRINT INT(3.9)\nPRINT INT(-0.5)\nPRINT INT(5)")).toEqual([
      "3",
      "-1",
      "5",
    ]);
  });
  it("MOD works as an operator and as a function, and is never negative", async () => {
    expect(
      await run(
        "PRINT 7 MOD 3\nPRINT MOD(7,3)\nPRINT -1 MOD 8\nPRINT 10 MOD 5\nPRINT 5.5 MOD 2",
      ),
    ).toEqual(["1", "1", "7", "0", "1.5"]);
  });
  it("MOD binds like * and /", async () => {
    expect(await run("PRINT 2 + 7 MOD 4 * 2")).toEqual(["8"]);
    expect(await run("PRINT 20 - 10 MOD 4")).toEqual(["18"]);
  });
  it("MOD by zero is the friendly zero error", async () => {
    expect((await failure("PRINT 5 MOD 0")).code).toBe("zero");
    expect((await failure("PRINT MOD(5,0)")).code).toBe("zero");
  });
  it("checks the number of ingredients", async () => {
    expect((await failure("PRINT MIN(1)")).code).toBe("args");
    expect((await failure("PRINT MAX(1,2,3)")).code).toBe("args");
    expect((await failure("PRINT INT(1,2)")).code).toBe("args");
  });
  it("keeps variables called MIN, MAX, INT and MOD working", async () => {
    expect(
      await run("MIN = 1\nMAX = 9\nINT = 2\nMOD = 3\nPRINT MIN + MAX + INT + MOD"),
    ).toEqual(["15"]);
  });
  it("a quoted MOD is text, not an operator", async () => {
    expect(await run('PRINT "MOD"')).toEqual(["MOD"]);
  });
});
