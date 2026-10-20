---
summary: Every message the machine can give while it reads or runs your program, what causes it, how to fix it, and the limits table.
---

# Reference: error messages and limits

When something is wrong, the machine stops, highlights the line and shows a message in the form *Line 7: …*. The messages are written to say what to *try*, not to scold. Below is every message that can come from a program, with a program that causes it. (Error names in the first column are the internal codes; you will not see them on screen, but they are stable and are what the handbook's tests check.)

## Messages from reading the program

These appear as soon as you press RUN, before anything is drawn, because the machine reads the whole program first.

| Code | Message | Usual cause and fix |
| --- | --- | --- |
| `token` | *I found "…" here. Try a number, name, or quoted word.* | A character that does not belong, such as `$`, `#`, `;`, `[`. |
| `quote` | *This string needs a closing quote.* | A missing `"`. |
| `expected` | *Try adding … here.* | A missing word or comma, such as `TO` in a `FOR`, `THEN` in an `IF`, or a new line after `THEN`. |
| `block` | *This block needs …* | An `IF`, `FOR` or `DO` that is never closed (`END IF`, `NEXT x`, `LOOP`). |
| `limit` | *That is a lot of magic! …* | The program is too long, too deeply nested, or a string is too long (also see below). |

```basic id=e-token error=token
PRINT 5 $ 3
```

```basic id=e-quote error=quote
PRINT "oops
```

```basic id=e-expected error=expected
FOR X = 1 5
NEXT X
```

```basic id=e-block error=block
IF TRUE THEN
  PRINT 1
```

## Messages from running the program

| Code | Message | Usual cause and fix |
| --- | --- | --- |
| `unknown` | *I don't know a spell called …. Did you mean …?* | A typo in a command, method or property name. The suggestion is the closest real name. |
| `variable` | *Give … a value first.* | A variable read before it was assigned. |
| `number` | *This spell needs a finite number.* | A text or true/false where a number is needed (`"a" * 2`, `INK "red"`). |
| `args` | *… needs N ingredients.* | The wrong number of arguments: `CIRCLE 1,2` has two, it needs three. |
| `range` | *… is outside this spell's range.* | A value outside what the command accepts (`INK 9`, `WAIT 40`, `RND(5,1)`, `TEMPO 500`, a negative radius). |
| `zero` | *Dividing by zero does not fit in this world.* | `x / 0`. |
| `step` | *STEP cannot be zero.* | `STEP 0` in a `FOR`. |
| `functionStatement` | *… gives something back. Keep it with a name, like …* | A function (`ROUND`, `ABS`, `RND`…) used alone on a line instead of inside an expression. (A long form such as `SPAWN("cat",10,10)` alone on a line is reported earlier, as `expected`.) |
| `object` | *This needs a living sprite. Try SPAWN first.* | A method on a destroyed sprite, or on something that is not a sprite. |
| `sprite` | *Try one of these sprites: …* | `SPAWN` with an unknown name. The message lists the real ones. |
| `sound` | *That sound is not in INVENTORY. …* | `SOUND` / `SFX` / an instrument alias that does not exist. |
| `list` | *Use a flat LIST of numbers, words or sprites here.* | A non-list where a list is needed, or a list inside a list. |
| `index` | *That item is outside the list. …* | `ITEM(list,n)` with `n` below 1 or above `COUNT(list)`. |
| `key` | *Try LEFT, RIGHT, UP, DOWN, SPACE, ENTER, or a letter/number key.* | `KEY("ESC")` or another unknown key name. |
| `input` | *Please type a number for ….* | A letter typed where `INPUT` was expecting a number. |
| `limit` | *That is a lot of magic! Try a smaller loop or fewer shapes and sounds.* | A limit was hit (see the table below). |
| `stopped` | *Stopped.* | You pressed STOP. Not an error. |

```basic id=e-unknown error=unknown
CIRCL 128,96,20
```

```basic id=e-variable error=variable
PRINT SCORE
```

```basic id=e-number error=number
PRINT "a" * 2
```

```basic id=e-args error=args
CIRCLE 1,2
```

```basic id=e-range error=range
INK 9
```

```basic id=e-zero error=zero
PRINT 1 / 0
```

```basic id=e-step error=step
FOR I = 1 TO 5 STEP 0
NEXT I
```

```basic id=e-function error=functionStatement
ROUND(2.5)
```

```basic id=e-object error=object
A = SPAWN("cat",1,1)
A.DESTROY
A.MOVE 5,5
```

```basic id=e-sprite error=sprite
A = SPAWN("dragon",1,1)
```

```basic id=e-sound error=sound
SFX "missing"
```

```basic id=e-list error=list
PRINT COUNT(5)
```

```basic id=e-index error=index
PRINT ITEM(LIST(1,2),3)
```

```basic id=e-key error=key
PRINT KEY("ESCAPE")
```

```basic id=e-input error=input input="abc"
N = 5
INPUT "Number?", N
```

For `unknown`, the names the machine knows are the commands, sprite methods and sprite properties listed in this reference, and the suggestion is the closest one by spelling.

## Messages about files and assets

These are not caused by your program, but by opening or loading something.

| Code | Message | What happened |
| --- | --- | --- |
| `importInvalid` | *That file is not a Randomize USR project. Your current project is unchanged.* | The file is damaged, not a `.randusr` file, or its contents fail validation. |
| `importVersion` | *This project was made with a newer Randomize USR (version N). Please update …* | The file format is newer than this app understands. |
| `importLarge` | *That file is too large. Try a .randusr file smaller than 1 MB.* | The file exceeds 1 MB. |
| `assetUnavailable` | *That sprite could not be loaded. Check the connection and try again.* | A built-in or saved sprite picture failed to load. |
| `audio` | *Sound could not start. Try pressing Play or RUN again.* | The browser refused to start audio. |
| `internal` | *The spell could not finish. Try resetting the world.* | Something unexpected happened; press RESET. |

## Limits at a glance

| Limit | Value | When exceeded |
| --- | --- | --- |
| Program length | 100,000 characters | `limit` |
| String length | 2,000 characters | `limit` |
| Name length | 64 characters | `limit` |
| Nesting of blocks | 40 levels | `limit` |
| Expression depth | 80 | `limit` |
| Statements per run (no `DO`) | 30,000 | `limit` |
| Loop passes per run (no `DO`) | 10,000 | `limit` |
| One `FOR` loop | 10,000 passes | `limit` |
| Running time (no `DO`) | 120 seconds | `limit` |
| Coordinates | ±10,000 | `range` |
| `WAIT` | 0 to 30 s | `range` |
| `TEXT` | 120 characters per call | extra characters are not drawn |
| `PRINT` | 1000 characters per line | extra characters are not shown |
| `SAY` | 40 characters | extra characters are cut |
| Sprites alive | 128 | `limit` |
| Sprites created (no `DO`) | 512 | `limit` |
| Sprite size | 1–256 × 1–192 | `range` |
| List length | 128 items | `limit` |
| `PLAY` notes | 64 per call | `limit` |
| `TEMPO` | 30–300 | `range` |
| Sound starts per run (no `DO`) | 256 | `limit` |
| Sound starts per second | 32 | extras dropped silently |
| Sounds at once | 8 | extras dropped silently |
| `.randusr` file | 1 MB | `importLarge` |

```basic id=e-limit error=limit
A = LIST()
FOR I = 1 TO 129
  PUSH A,I
NEXT I
```
