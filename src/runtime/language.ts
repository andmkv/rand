export interface Loc {
  line: number;
  column: number;
  spelling?: string;
}
export class SpellError extends Error {
  constructor(
    public code: string,
    public params: Record<string, unknown> = {},
    public loc: Loc = { line: 1, column: 1 },
  ) {
    super(code);
  }
}
type Token = Loc & {
  kind: "number" | "string" | "name" | "symbol" | "end";
  value: string;
};
export type Expr = Loc &
  (
    | { type: "literal"; value: number | string | boolean }
    | { type: "variable"; name: string }
    | { type: "binary"; op: string; left: Expr; right: Expr }
    | { type: "unary"; op: string; value: Expr }
    | { type: "call"; name: string; args: Expr[] }
    | { type: "property"; name: string; property: string }
  );
export type Stmt = Loc &
  (
    | { type: "assign"; name: string; value: Expr }
    | { type: "command"; name: string; object?: string; args: Expr[] }
    | {
        type: "for";
        name: string;
        start: Expr;
        end: Expr;
        step: Expr;
        body: Stmt[];
      }
    | { type: "if"; condition: Expr; body: Stmt[]; otherwise?: Stmt[] }
    | { type: "do"; body: Stmt[] }
    | { type: "exit"; kind: "DO" | "FOR" | "SUB" }
    | { type: "sub"; name: string; body: Stmt[] }
    | { type: "callsub"; name: string }
    | { type: "input"; prompt: Expr; name: string }
  );
export function lex(source: string): Token[] {
  if (source.length > 100000) throw new SpellError("limit");
  const tokens: Token[] = [];
  source.split(/\r?\n/).forEach((s, li) => {
    let i = 0;
    while (i < s.length) {
      const loc = { line: li + 1, column: i + 1 };
      const c = String.fromCodePoint(s.codePointAt(i)!);
      if (/\s/.test(c)) {
        i++;
        continue;
      }
      if (c === "'" || /^REM\b/i.test(s.slice(i))) break;
      if (c === '"') {
        let value = "";
        i++;
        while (i < s.length && s[i] !== '"') value += s[i++];
        if (s[i] !== '"') throw new SpellError("quote", {}, loc);
        i++;
        if (value.length > 2000) throw new SpellError("limit", {}, loc);
        tokens.push({ ...loc, kind: "string", value });
        continue;
      }
      const n = s.slice(i).match(/^(?:\d+(?:\.\d*)?|\.\d+)/);
      if (n) {
        tokens.push({ ...loc, kind: "number", value: n[0] });
        i += n[0].length;
        continue;
      }
      const id = s.slice(i).match(/^[\p{L}_][\p{L}\p{M}\p{N}_]*/u);
      if (id) {
        if (id[0].length > 64) throw new SpellError("limit", {}, loc);
        tokens.push({
          ...loc,
          kind: "name",
          value: id[0].toUpperCase(),
          spelling: id[0],
        });
        i += id[0].length;
        continue;
      }
      const op = s.slice(i).match(/^(<=|>=|<>|[+\-*/=<>(),.])/);
      if (op) {
        tokens.push({ ...loc, kind: "symbol", value: op[0] });
        i += op[0].length;
        continue;
      }
      throw new SpellError("token", { value: c }, loc);
    }
    tokens.push({ kind: "end", value: "\n", line: li + 1, column: i + 1 });
  });
  return tokens;
}
export function parse(source: string): Stmt[] {
  const tokens = lex(source);
  let p = 0,
    depth = 0;
  // What we are inside right now ("FOR", "DO", "SUB"), innermost last.
  const inside: string[] = [];
  const at = () =>
    tokens[p] ??
    ({
      kind: "end",
      value: "EOF",
      line: tokens.at(-1)?.line ?? 1,
      column: 1,
    } as Token);
  const take = () => tokens[p++];
  const is = (v: string) => at().value === v;
  const need = (v: string) => {
    if (!is(v)) throw new SpellError("expected", { value: v }, at());
    return take();
  };
  const name = () => {
    if (at().kind !== "name")
      throw new SpellError("expected", { value: "a name" }, at());
    return take().value;
  };
  function expr(min = 0): Expr {
    if (++depth > 80) throw new SpellError("limit", {}, at());
    const tok = take();
    if (!tok) throw new SpellError("expected", { value: "a value" }, at());
    let left: Expr;
    if (["-", "+", "NOT"].includes(tok.value) && tok.kind !== "string")
      left = {
        ...tok,
        type: "unary",
        op: tok.value,
        value: expr(tok.value === "NOT" ? 2 : 6),
      };
    else if (tok.value === "(") {
      left = expr();
      need(")");
    } else if (tok.kind === "number" || tok.kind === "string")
      left = {
        ...tok,
        type: "literal",
        value: tok.kind === "number" ? Number(tok.value) : tok.value,
      };
    else if (tok.kind === "name") {
      if (["TRUE", "FALSE"].includes(tok.value))
        left = { ...tok, type: "literal", value: tok.value === "TRUE" };
      else if (is("(")) {
        take();
        const args: Expr[] = [];
        if (!is(")")) {
          args.push(expr());
          while (is(",")) {
            take();
            args.push(expr());
          }
        }
        need(")");
        left = { ...tok, type: "call", name: tok.value, args };
      } else if (is(".")) {
        take();
        left = { ...tok, type: "property", name: tok.value, property: name() };
      } else left = { ...tok, type: "variable", name: tok.value };
    } else throw new SpellError("token", { value: tok.value }, tok);
    const precedence: Record<string, number> = {
      OR: 1,
      AND: 2,
      "=": 3,
      "<>": 3,
      "<": 3,
      ">": 3,
      "<=": 3,
      ">=": 3,
      "+": 4,
      "-": 4,
      "*": 5,
      "/": 5,
      MOD: 5,
    };
    // Only symbols and words are operators: a quoted "MOD" is just text.
    const power = (t: Token) =>
      t.kind === "symbol" || t.kind === "name" ? (precedence[t.value] ?? 0) : 0;
    while (power(at()) > min) {
      const op = take();
      left = {
        ...op,
        type: "binary",
        op: op.value,
        left,
        right: expr(precedence[op.value]),
      };
    }
    depth--;
    return left;
  }
  function block(end?: string, nesting = 0): Stmt[] {
    if (nesting > 40) throw new SpellError("limit", {}, at());
    const out: Stmt[] = [];
    while (p < tokens.length) {
      if (at().kind === "end") {
        take();
        continue;
      }
      if (is("NEXT") || is("END") || is("LOOP") || is("ELSE")) {
        if (!end) throw new SpellError("token", { value: at().value }, at());
        return out;
      }
      const loc = at();
      let cmd = name();
      let spelling = loc.spelling;
      if (cmd === "LET") cmd = name();
      if (cmd === "FOR") {
        const variable = name();
        need("=");
        const start = expr();
        need("TO");
        const finish = expr();
        const step = is("STEP")
          ? (take(), expr())
          : { ...loc, type: "literal" as const, value: 1 };
        need("\n");
        inside.push("FOR");
        const body = block("NEXT", nesting + 1);
        inside.pop();
        if (!is("NEXT"))
          throw new SpellError("block", { value: "NEXT " + variable }, loc);
        take();
        if (at().kind === "name" && name() !== variable)
          throw new SpellError("expected", { value: variable }, at());
        out.push({
          ...loc,
          type: "for",
          name: variable,
          start,
          end: finish,
          step,
          body,
        });
      } else if (cmd === "DO") {
        need("\n");
        inside.push("DO");
        const body = block("LOOP", nesting + 1);
        inside.pop();
        need("LOOP");
        out.push({ ...loc, type: "do", body });
      } else if (cmd === "IF") {
        const condition = expr();
        need("THEN");
        need("\n");
        const body = block("END IF", nesting + 1);
        let otherwise: Stmt[] = [];
        if (is("ELSE")) {
          take();
          need("\n");
          otherwise = block("END IF", nesting + 1);
        }
        if (!is("END")) throw new SpellError("block", { value: "END IF" }, loc);
        take();
        need("IF");
        out.push({ ...loc, type: "if", condition, body, otherwise });
      } else if (cmd === "EXIT" && !is("=")) {
        const kind = name();
        if (kind !== "DO" && kind !== "FOR" && kind !== "SUB")
          throw new SpellError("expected", { value: "DO, FOR or SUB" }, loc);
        // EXIT DO / EXIT FOR must sit inside such a loop of the same SUB (or
        // of the main program); EXIT SUB must sit inside a SUB.
        let found = false;
        for (let i = inside.length - 1; i >= 0 && !found; i--) {
          if (inside[i] === kind) found = true;
          else if (inside[i] === "SUB") break;
        }
        if (!found)
          throw new SpellError(
            "expected",
            {
              value:
                kind === "DO"
                  ? "DO … LOOP around this"
                  : kind === "FOR"
                    ? "FOR … NEXT around this"
                    : "SUB … END SUB around this",
            },
            loc,
          );
        out.push({ ...loc, type: "exit", kind });
      } else if (cmd === "SUB" && !is("=")) {
        // SUBs live at the top of the program, not inside loops or IFs.
        if (nesting !== 0) throw new SpellError("token", { value: "SUB" }, loc);
        const subName = name();
        need("\n");
        inside.push("SUB");
        const body = block("END SUB", nesting + 1);
        inside.pop();
        if (!is("END")) throw new SpellError("block", { value: "END SUB" }, loc);
        take();
        need("SUB");
        out.push({ ...loc, type: "sub", name: subName, body });
      } else if (cmd === "CALL" && !is("=")) {
        const spelled = at();
        out.push({
          ...loc,
          type: "callsub",
          name: name(),
          spelling: spelled.spelling,
        });
      } else if (cmd === "INPUT") {
        const prompt = expr();
        need(",");
        out.push({ ...loc, type: "input", prompt, name: name() });
      } else if (is("=")) {
        take();
        out.push({ ...loc, type: "assign", name: cmd, value: expr() });
      } else {
        let object: string | undefined;
        if (is(".")) {
          take();
          object = cmd;
          spelling = at().spelling;
          cmd = name();
        }
        const args: Expr[] = [];
        if (at().kind !== "end") {
          args.push(expr());
          while (is(",")) {
            take();
            args.push(expr());
          }
        }
        out.push({
          ...loc,
          type: "command",
          name: cmd,
          object,
          args,
          spelling,
        });
      }
      if (at().kind !== "end")
        throw new SpellError("expected", { value: "a new line" }, at());
      take();
    }
    if (end) throw new SpellError("block", { value: end }, out[0] ?? at());
    return out;
  }
  return block();
}
