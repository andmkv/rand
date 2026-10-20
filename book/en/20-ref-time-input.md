---
summary: Time, keyboard and text — WAIT, FRAME, PRINT, INPUT and KEY — and how the machine paces programs.
---

# Reference: time, keys and text input

## How the machine runs a program

Your program runs in the browser, one statement at a time, but it is **cooperative**: it regularly hands control back so the page can draw, play sound and react to STOP. That is why a tight loop never freezes the page and why STOP always works. Waiting commands (`WAIT`, `FRAME`, `INPUT`, `SOUND`, `BEEP`, `NOTE`, `REST`, `PLAY`, `EXPLODE`) are the main places where time passes.

A program that does **not** contain a `DO … LOOP` is also bounded: at most 30,000 statements, 10,000 loop passes and two minutes of running time, after which it stops with the `limit` error. A program that contains `DO` is long-running and has no such limit, but is still stoppable and still bounded in sprites, lists and sound.

## Time

### `WAIT` {#cmd-wait}

**Syntax:** `WAIT seconds` · 0 to 30; decimals allowed. **Blocking.**

Pauses the program for that many seconds. Outside 0–30, the error is `range` ("duration"). STOP interrupts a wait at once.

```basic id=r-wait output="one|two"
PRINT "one"
WAIT 0.5
PRINT "two"
```

### `FRAME` {#cmd-frame}

**Syntax:** `FRAME` · no arguments. **Blocking** for about 1/60 of a second.

Waits for the next screen refresh. Use it once per pass of a game loop: the loop then runs about 60 times a second. A program that uses `FRAME` anywhere is treated as a *frame-based* program: drawing commands are no longer cut into slices, up to 1,000 statements run between `FRAME`s, and everything you draw appears in one go.

```basic id=r-frame vars="N=30"
N = 0
FOR T = 1 TO 30
  N = N + 1
  FRAME
NEXT T
```

## Text output

### `PRINT` {#cmd-print}

**Syntax:** `PRINT value` · exactly one value.

Writes one line in the text area below SCREEN (up to 1000 characters). Numbers, text and booleans are converted to text; to print several things use `+`. The text area is not part of SCREEN: use [`TEXT`](book:ref-drawing#cmd-text) to write on SCREEN.

```basic id=r-print output="3 apples|true"
PRINT 3 + " apples"
PRINT 2 < 3
```

## Text input

### `INPUT` {#cmd-input}

**Syntax:** `INPUT prompt, name` · **Blocking** until the player answers.

Shows the prompt (a string or any value, turned into text) and waits for an answer typed in the box below SCREEN. The answer goes into the variable `name`.

- If `name` **already holds a number**, the answer must be a number; it is stored as a number. Anything else gives the `input` error ("Please type a number for NAME").
- Otherwise the answer is stored as **text**.

STOP cancels a waiting `INPUT`.

```basic id=r-input input="Mia|7" output="Mia is 8"
AGE = 0
INPUT "Name?", NAME
INPUT "Age?", AGE
PRINT NAME + " is " + (AGE + 1)
```

## Keyboard

### `KEY` {#fn-key}

**Syntax:** `KEY(name)` → `TRUE` or `FALSE` · exactly one argument.

Answers whether a key is **being held down right now**. `name` is a string, not case-sensitive: `"LEFT"`, `"RIGHT"`, `"UP"`, `"DOWN"`, `"SPACE"`, `"ENTER"`, one letter `"A"`–`"Z"` or one digit `"0"`–`"9"`. Anything else is the `key` error.

- Keys reach the program only while **SCREEN has the focus**. The first `KEY` call in a run moves the focus there; clicking CODE gives it to the editor, and clicking SCREEN brings it back. When the browser window or tab loses focus, all keys are released.
- Letters and digits are read by their **physical position** on the keyboard, so the same program works with other keyboard layouts.
- Presses together with `Ctrl`, `⌘` or `Alt` are ignored.
- `KEY` is a function: use it in a condition or assign it: `HELD = KEY("SPACE")`.

```basic id=r-key endless wait=2 keys=SPACE vars="PRESSED=1"
PRESSED = 0
DO
  IF KEY("SPACE") THEN
    PRESSED = 1
  END IF
  FRAME
LOOP
```
