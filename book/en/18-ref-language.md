---
summary: The grammar of the language — programs, names, values, operators and precedence — and every control keyword (FOR, IF, DO, LET, REM, AND, OR, NOT).
---

# Reference: the language

This is the exact description of the BASIC dialect that Randomize USR runs. It is written from the interpreter's own source and checked by the handbook's tests: every command the machine knows has a section in the reference pages, and every example here runs. For gentler explanations, read the chapters first; come back here to look things up.

**How to read an entry.** Square brackets `[like this]` mean optional. A word in lower case (`x`, `seconds`) stands for a value you supply. A command is written in capitals in this handbook, but the machine does not care about case.

## Programs and lines

A program is plain text, up to **100,000 characters**. It is read line by line, and **each statement is on its own line**. There is no way to put two statements on one line (no `:`) and no way to continue a statement on the next line.

A statement is one of:

| Form | Example |
| --- | --- |
| assignment | `SCORE = SCORE + 1` or `LET SCORE = 1` |
| command | `CIRCLE 128,96,20` |
| method call on a sprite | `CAT.MOVE_BY 2,0` |
| `INPUT` | `INPUT "Name?", NAME` |
| a block | `FOR … NEXT`, `IF … END IF`, `DO … LOOP` |

Blank lines and indentation are ignored. A function that gives back a value (`SPAWN`, `RND`…) cannot stand alone as a statement; its value must go somewhere: `CAT = SPAWN("cat",10,10)`.

## Names

A **name** (of a variable) starts with a letter (from any alphabet) or `_`, then letters, combining marks, digits or `_`; at most **64 characters**. Names are **not case-sensitive**: `Score`, `SCORE` and `score` are one variable. Variables need no declaration: assigning creates them. Reading a variable that has no value gives the `variable` error. **All variables are emptied at the start of every RUN.** Variables are global; there are no procedures or local variables.

Avoid using words of the language as variable names (`IF`, `FOR`, `NEXT`, `TO`, `STEP`, `THEN`, `ELSE`, `END`, `DO`, `LOOP`, `AND`, `OR`, `NOT`, `LET`, `TRUE`, `FALSE`, `INPUT`, `REM`). Names of commands and functions (such as `SIZE` or `TEXT`) happen to work as variable names, but are confusing.

## Values

| Kind | Written as | Notes |
| --- | --- | --- |
| number | `42`, `3.5`, `.5` | Decimal digits only; no exponent notation (`1E3`) and no hexadecimal. Always finite. A leading `-` or `+` is allowed. |
| string | `"text"` | Double quotes only. No escape sequences: a string cannot contain `"`, and cannot span lines. At most **2000** characters. |
| boolean | `TRUE`, `FALSE` | Also the result of any comparison. |
| sprite | from `SPAWN` | An object with a position; see [sprites](book:ref-sprites). |
| list | from `LIST(…)` | An ordered row of values; see [lists](book:ref-lists). |

`PRINT` shows a boolean as `true` or `false`, a number the way JavaScript would (so `1/3` is `0.3333333333333333`), and a string as it is.

## Operators and precedence

From the loosest to the tightest binding:

| Level | Operators |
| --- | --- |
| 1 | `OR` |
| 2 | `AND` |
| (prefix) | `NOT` — applies to the comparison after it |
| 3 | `=` `<>` `<` `>` `<=` `>=` |
| 4 | `+` `-` |
| 5 | `*` `/` |
| (prefix) | unary `-` and `+` — tightest |

Operators of the same level group from the left. Brackets `( )` override everything. Comparisons do not chain: `1 < 2 < 3` is `(1 < 2) < 3`, which is an error because `TRUE` is not a number.

`AND` and `OR` always give `TRUE` or `FALSE`, and they skip the right-hand side when the left one already decides the result (`FALSE AND X` never looks at `X`).

A condition (in `IF`) is true unless it is `FALSE`, the number `0` or the empty string. This convenience is accurate but easy to misread; prefer explicit comparisons.

```basic id=r-precedence output="14|true|true|false"
PRINT 2 + 3 * 4
PRINT 2 + 3 * 4 = 14 AND NOT 2 = 3
PRINT TRUE OR MISSING
PRINT FALSE AND MISSING
```

## Comments

### `REM` {#kw-rem}

```text
REM anything to the end of the line
' also a comment
```

Both start a comment that runs to the end of the line, on a line of its own or after a statement. `REM` must be a whole word (so `REMIX = 3` is an assignment). Comments are ignored.

```basic id=r-rem output="done"
REM Draw a dot in the middle
PLOT 128,96 ' a yellow dot would need INK 6 first
PRINT "done"
```

### `LET` {#kw-let}

**Syntax:** `[LET] name = value`

`LET` is optional and changes nothing. `LET X = 5` means exactly `X = 5`.

## Loops

### `FOR` `NEXT` `STEP` `TO` {#kw-for}

**Syntax:** `FOR name = start TO end [STEP amount]` … `NEXT [name]`

Sets `name` to `start`, runs the body, adds `amount` (default `1`) and repeats while the value has not passed `end`. A negative `STEP` counts down (the loop runs while `name >= end`). The three numbers are worked out once, before the first pass. `STEP 0` is an error (`step`). The counter is a normal variable, and keeps its value from the last pass after the loop. If you write a name after `NEXT`, it must be the same variable.

A single `FOR` runs at most **10,000 passes** (error `limit` after that). Loops can be nested up to 40 levels.

```basic id=r-for output="1|3|5|3|2|1"
FOR I = 1 TO 5 STEP 2
  PRINT I
NEXT I
FOR J = 3 TO 1 STEP -1
  PRINT J
NEXT J
```

### `DO` `LOOP` {#kw-do}

**Syntax:** `DO` … `LOOP`

Repeats its body forever. There is no way to leave except STOP (or an error). A program that contains `DO` anywhere is treated as long-running: the total-statement, total-iteration and two-minute limits do not apply to it. Put a `FRAME` or `WAIT` inside so the loop yields time.

```basic id=r-do endless wait=2 vars="N>10"
N = 0
DO
  N = N + 1
  WAIT 0.05
LOOP
```

## Decisions

### `IF` `THEN` `END IF` `END` {#kw-if}

**Syntax:**

```text
IF condition THEN
  statements
[ELSE
  statements]
END IF
```

`THEN` must be the last thing on its line and the body starts on the next line; there is no one-line `IF`. `END IF` is two words. There is no `ELSEIF`; nest an `IF` inside `ELSE`. Blocks may be nested 40 deep. `END` is only valid as the first half of `END IF`; on its own it is an error, because a program cannot be ended early.

```basic id=r-if output="B"
SCORE = 70
IF SCORE >= 90 THEN
  PRINT "A"
ELSE
  IF SCORE >= 60 THEN
    PRINT "B"
  ELSE
    PRINT "C"
  END IF
END IF
```

### `ELSE` {#kw-else}

Introduces the second branch of an `IF`. It must be on its own line, once per `IF`. See `IF`.

## Logic

### `AND` `OR` `NOT` {#kw-logic}

`a AND b` is true when both are true; `a OR b` when at least one is; `NOT a` reverses. See the precedence table above. `AND` and `OR` skip their right side when the left side already decides.

```basic id=r-logic output="true|false|true"
PRINT 5 > 3 AND 2 < 4
PRINT NOT TRUE
PRINT 1 = 2 OR 3 = 3
```

## Arithmetic and comparison operators

### `+` `-` `*` `/` {#op-arithmetic}

Numbers add, subtract, multiply and divide with ordinary precedence. `+` also **joins** text: if either side is a string, both sides are turned into text and glued together (a joined result is limited to 2000 characters). Division by zero is the `zero` error. Subtracting, multiplying or dividing anything that is not a number is the `number` error.

```basic id=r-arithmetic output="7|-1|12|2.5|ab|a1|3 apples"
PRINT 3 + 4
PRINT 3 - 4
PRINT 3 * 4
PRINT 5 / 2
PRINT "a" + "b"
PRINT "a" + 1
PRINT 3 + " apples"
```

### `=` `<>` `<` `>` `<=` `>=` {#op-compare}

`=` and `<>` (not equal) compare any two values of the same kind; values of different kinds are never equal (`1 = "1"` is `FALSE`). Text comparison is case-sensitive. Sprites and lists are equal only to themselves. `<`, `>`, `<=` and `>=` need numbers.

```basic id=r-compare output="true|false|true|false"
PRINT 3 <> 4
PRINT "Cat" = "cat"
PRINT 2 <= 2
PRINT 1 = "1"
```

## Input

`INPUT` is described with the other input and timing commands in [Reference: time, keys and text input](book:ref-time-input).
