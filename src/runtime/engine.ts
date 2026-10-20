import { parse, SpellError, type Expr, type Stmt, type Loc } from "./language";
export type Value = number | string | boolean | Sprite | Value[];
export interface Sprite {
  id: number;
  kind: string;
  x: number;
  y: number;
  angle: number;
  visible: boolean;
  alive: boolean;
  say: string;
  width?: number;
  height?: number;
  indestructible?: boolean;
  /** Runtime-only elapsed-time anchor for a project animation. */
  animationStartedAt?: number;
  /** Set by global STOP to freeze an animated sprite on its current frame. */
  animationFrozenFrame?: number;
}
export interface Host {
  key?(name: string): boolean;
  reset(): void;
  command(name: string, args: Value[], engine: Engine): Promise<void> | void;
  spawn(kind: string, x: number, y: number, engine?: Engine): Sprite;
  method(
    sprite: Sprite,
    name: string,
    args: Value[],
    engine: Engine,
  ): Promise<void> | void;
  print(text: string): void;
  input(prompt: string, signal: AbortSignal): Promise<string>;
  stop(): void;
}
export const commands = [
  "FRAME",
  "PUSH",
  "SFX",
  "CLS",
  "INK",
  "PAPER",
  "BORDER",
  "BRIGHT",
  "PLOT",
  "LINE",
  "BOX",
  "FILLBOX",
  "CIRCLE",
  "FILLCIRCLE",
  "TEXT",
  "WAIT",
  "PRINT",
  "BEEP",
  "NOTE",
  "REST",
  "TEMPO",
  "PLAY",
  "SOUND",
];
export const methods = [
  "SIZE",
  "MOVE",
  "MOVE_BY",
  "TURN",
  "SHOW",
  "HIDE",
  "DESTROY",
  "SAY",
  "EXPLODE",
];
export const functions = [
  "SPAWN",
  "RND",
  "RANDOM",
  "SIN",
  "COS",
  "ABS",
  "ROUND",
  "KEY",
  "HIT",
  "LIST",
  "ITEM",
  "COUNT",
];
export function sprite(value: Value | undefined): Sprite {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new SpellError("object");
  return value;
}
function list(value: Value): Value[] {
  if (!Array.isArray(value)) throw new SpellError("list");
  return value;
}
export function numeric(v: Value): number {
  if (typeof v !== "number" || !Number.isFinite(v))
    throw new SpellError("number");
  return v;
}
export function count(args: Value[], n: number, name: string) {
  if (args.length !== n)
    throw new SpellError("args", { value: name, count: n });
}
function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [
    i,
    ...Array(b.length).fill(0),
  ]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
  return d[a.length][b.length];
}
export function unknown(value: string, known: string[]): never {
  const suggestion = [...known].sort(
    (a, b) =>
      distance(value.toUpperCase(), a) - distance(value.toUpperCase(), b),
  )[0];
  throw new SpellError("unknown", {
    value,
    suggestion:
      suggestion && distance(value.toUpperCase(), suggestion) <= 3
        ? suggestion
        : "",
  });
}
export class Engine {
  variables = new Map<string, Value>();
  controller = new AbortController();
  statements = 0;
  iterations = 0;
  audioEvents = 0;
  loc: Loc = { line: 1, column: 1 };
  started = 0;
  longRunning = false;
  frameMode = false;
  work = 0;
  sliceStart = 0;
  drawWork = 0;
  drawCommands = 0;
  audioTimes: number[] = [];
  constructor(
    public host: Host,
    public limits = {
      statements: 30000,
      iterations: 10000,
      audio: 256,
      wall: 120000,
    },
    private readonly now: () => number = Date.now,
  ) {}
  stop() {
    this.controller.abort();
    this.host.stop();
  }
  async wait(seconds: number) {
    if (seconds < 0 || seconds > 30)
      throw new SpellError("range", { value: "duration" });
    await new Promise<void>((resolve, reject) => {
      const signal = this.controller.signal;
      const abort = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        reject(new SpellError("stopped"));
      };
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", abort);
        resolve();
      }, seconds * 1000);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
  }
  check() {
    if (this.controller.signal.aborted) throw new SpellError("stopped");
    if (
      !this.longRunning &&
      (this.statements > this.limits.statements ||
        this.iterations > this.limits.iterations ||
        this.now() - this.started > this.limits.wall)
    )
      throw new SpellError("limit");
  }
  async yieldFrame() {
    await this.wait(0.016);
    this.work = 0;
    this.drawWork = 0;
    this.drawCommands = 0;
    this.sliceStart = this.now();
    this.check();
  }
  async checkpoint() {
    this.check();
    if (
      ++this.work >= (this.frameMode ? 1000 : 100) ||
      this.now() - this.sliceStart >= 6
    )
      await this.yieldFrame();
  }
  async drawing(cost: number) {
    if (this.frameMode) return;
    this.drawWork += cost;
    if (++this.drawCommands >= 8 || this.drawWork >= 65536)
      await this.yieldFrame();
  }
  audioEvent() {
    const now = this.now();
    while (this.audioTimes.length && now - this.audioTimes[0] >= 1000)
      this.audioTimes.shift();
    if (!this.longRunning && this.audioEvents >= this.limits.audio)
      throw new SpellError("limit");
    if (this.audioTimes.length >= 32) return false;
    this.audioTimes.push(now);
    this.audioEvents++;
    return true;
  }
  evaluate(e: Expr): Value {
    switch (e.type) {
      case "literal":
        return typeof e.value === "number" ? numeric(e.value) : e.value;
      case "variable": {
        const v = this.variables.get(e.name);
        if (v === undefined)
          throw new SpellError("variable", { value: e.spelling ?? e.name }, e);
        return v;
      }
      case "property": {
        const v = sprite(this.variables.get(e.name));
        if (e.property === "ALIVE") return v.alive;
        if (!v.alive) throw new SpellError("object");
        if (e.property === "X") return v.x;
        if (e.property === "Y") return v.y;
        if (e.property === "VISIBLE") return v.visible;
        if (e.property === "WIDTH") return v.width ?? 16;
        if (e.property === "HEIGHT") return v.height ?? 16;
        return unknown(e.property, [
          "X",
          "Y",
          "VISIBLE",
          "ALIVE",
          "WIDTH",
          "HEIGHT",
        ]);
      }
      case "unary":
        if (e.op === "NOT") return !this.evaluate(e.value);
        return (e.op === "-" ? -1 : 1) * numeric(this.evaluate(e.value));
      case "binary": {
        if (e.op === "AND")
          return (
            Boolean(this.evaluate(e.left)) && Boolean(this.evaluate(e.right))
          );
        if (e.op === "OR")
          return (
            Boolean(this.evaluate(e.left)) || Boolean(this.evaluate(e.right))
          );
        const a = this.evaluate(e.left),
          b = this.evaluate(e.right);
        if (e.op === "=") return a === b;
        if (e.op === "<>") return a !== b;
        if (e.op === "+") {
          if (typeof a === "string" || typeof b === "string") {
            const result = String(a) + String(b);
            if (result.length > 2000) throw new SpellError("limit");
            return result;
          }
          return numeric(a) + numeric(b);
        }
        const x = numeric(a),
          y = numeric(b);
        switch (e.op) {
          case "-":
            return x - y;
          case "*":
            return x * y;
          case "/":
            if (y === 0) throw new SpellError("zero");
            return x / y;
          case "<":
            return x < y;
          case ">":
            return x > y;
          case "<=":
            return x <= y;
          case ">=":
            return x >= y;
        }
        throw new SpellError("number");
      }
      case "call": {
        const a = e.args.map((x) => this.evaluate(x));
        if (e.name === "LIST") {
          if (a.length > 128) throw new SpellError("limit");
          if (a.some(Array.isArray)) throw new SpellError("list");
          return a;
        }
        if (e.name === "COUNT") {
          count(a, 1, e.name);
          return list(a[0]).length;
        }
        if (e.name === "ITEM") {
          count(a, 2, e.name);
          const values = list(a[0]),
            index = numeric(a[1]);
          if (!Number.isInteger(index) || index < 1 || index > values.length)
            throw new SpellError("index");
          return values[index - 1];
        }
        if (e.name === "KEY") {
          count(a, 1, e.name);
          const name = String(a[0]).toUpperCase();
          if (!/^(LEFT|RIGHT|UP|DOWN|SPACE|ENTER|[A-Z0-9])$/.test(name))
            throw new SpellError("key");
          return this.host.key?.(name) ?? false;
        }
        if (e.name === "HIT") {
          count(a, 2, e.name);
          const first = sprite(a[0]),
            second = sprite(a[1]);
          return (
            first.alive &&
            second.alive &&
            first.visible &&
            second.visible &&
            Math.abs(first.x - second.x) <
              ((first.width ?? 16) + (second.width ?? 16)) / 2 &&
            Math.abs(first.y - second.y) <
              ((first.height ?? 16) + (second.height ?? 16)) / 2
          );
        }
        if (e.name === "SPAWN") {
          count(a, 3, e.name);
          return this.host.spawn(
            String(a[0]),
            numeric(a[1]),
            numeric(a[2]),
            this,
          );
        }
        if (e.name === "RND" || e.name === "RANDOM") {
          count(a, 2, e.name);
          const lo = numeric(a[0]),
            hi = numeric(a[1]);
          if (!Number.isInteger(lo) || !Number.isInteger(hi) || hi < lo)
            throw new SpellError("range", { value: "RND" });
          return lo + Math.floor(Math.random() * (hi - lo + 1));
        }
        const f: Record<string, (n: number) => number> = {
          SIN: Math.sin,
          COS: Math.cos,
          ABS: Math.abs,
          ROUND: Math.round,
        };
        if (!Object.hasOwn(f, e.name))
          return unknown(e.spelling ?? e.name, functions);
        count(a, 1, e.name);
        return f[e.name](numeric(a[0]));
      }
    }
  }
  async execute(body: Stmt[]): Promise<void> {
    for (const s of body) {
      this.loc = s;
      this.statements++;
      this.check();
      await this.checkpoint();
      this.check();
      switch (s.type) {
        case "assign":
          this.variables.set(s.name, this.evaluate(s.value));
          break;
        case "if":
          if (this.evaluate(s.condition)) await this.execute(s.body);
          else if (s.otherwise) await this.execute(s.otherwise);
          break;
        case "for": {
          const start = numeric(this.evaluate(s.start)),
            end = numeric(this.evaluate(s.end)),
            step = numeric(this.evaluate(s.step));
          if (step === 0) throw new SpellError("step");
          let loopIterations = 0;
          for (let x = start; step > 0 ? x <= end : x >= end; x += step) {
            this.loc = s;
            this.iterations++;
            this.check();
            await this.checkpoint();
            if (++loopIterations > this.limits.iterations)
              throw new SpellError("limit");
            this.variables.set(s.name, x);
            await this.execute(s.body);
          }
          break;
        }
        case "do": {
          while (true) {
            this.iterations++;
            await this.checkpoint();
            await this.execute(s.body);
          }
        }
        case "input": {
          const answer = await this.host.input(
            String(this.evaluate(s.prompt)),
            this.controller.signal,
          );
          this.check();
          if (typeof this.variables.get(s.name) === "number") {
            const n = Number(answer);
            if (!answer.trim() || !Number.isFinite(n))
              throw new SpellError("input", { value: s.name });
            this.variables.set(s.name, n);
          } else this.variables.set(s.name, answer);
          break;
        }
        case "command": {
          const args = s.args.map((e) => this.evaluate(e));
          if (s.object) {
            const object = sprite(this.variables.get(s.object));
            if (!object.alive) throw new SpellError("object");
            if (!methods.includes(s.name))
              unknown(s.spelling ?? s.name, methods);
            await this.host.method(object, s.name, args, this);
          } else {
            if (!commands.includes(s.name)) {
              if (functions.includes(s.name))
                throw new SpellError("functionStatement", {
                  value: s.name,
                  example:
                    s.name === "SPAWN"
                      ? 'CAT = SPAWN("cat",10,10)'
                      : `ANSWER = ${s.name}(…)`,
                });
              unknown(s.spelling ?? s.name, commands);
            }
            if (s.name === "FRAME") {
              count(args, 0, s.name);
              await this.yieldFrame();
            } else if (s.name === "PUSH") {
              count(args, 2, s.name);
              const values = list(args[0]);
              if (values.length >= 128) throw new SpellError("limit");
              if (Array.isArray(args[1])) throw new SpellError("list");
              values.push(args[1]);
            } else if (s.name === "PRINT") {
              count(args, 1, s.name);
              this.host.print(String(args[0]));
            } else if (s.name === "WAIT") {
              count(args, 1, s.name);
              await this.wait(numeric(args[0]));
            } else await this.host.command(s.name, args, this);
          }
          break;
        }
      }
    }
  }
  async run(source: string) {
    this.variables.clear();
    this.statements = 0;
    this.iterations = 0;
    this.audioEvents = 0;
    this.started = this.now();
    this.sliceStart = this.started;
    this.work = 0;
    this.drawWork = 0;
    this.drawCommands = 0;
    this.audioTimes = [];
    this.host.reset();
    try {
      const body = parse(source);
      const containsDo = (body: Stmt[]): boolean =>
        body.some(
          (s) =>
            s.type === "do" ||
            ((s.type === "for" || s.type === "if") &&
              (containsDo(s.body) ||
                (s.type === "if" && containsDo(s.otherwise ?? [])))),
        );
      this.longRunning = containsDo(body);
      const containsFrame = (body: Stmt[]): boolean =>
        body.some(
          (s) =>
            (s.type === "command" && s.name === "FRAME" && !s.object) ||
            ((s.type === "for" || s.type === "if" || s.type === "do") &&
              (containsFrame(s.body) ||
                (s.type === "if" && containsFrame(s.otherwise ?? [])))),
        );
      this.frameMode = containsFrame(body);
      await this.execute(body);
      this.check();
    } catch (e) {
      if (!this.controller.signal.aborted) this.host.stop();
      if (e instanceof SpellError) {
        if (e.loc.line === 1 && e.loc.column === 1) e.loc = this.loc;
        throw e;
      }
      throw new SpellError("internal", {}, this.loc);
    }
  }
}
