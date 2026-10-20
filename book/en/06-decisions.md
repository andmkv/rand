---
summary: Make programs choose with IF, ELSE and comparisons, combine conditions with AND, OR and NOT, ask questions with INPUT, and read error messages.
---

# Decisions, questions and mistakes

**Goal:** make your program choose between actions, ask the player something, and understand what the machine says when something goes wrong.

## IF … THEN … END IF

An `IF` runs its body only when a condition is true.

```basic id=c06-if output="High score!"
SCORE = 7
IF SCORE > 5 THEN
  PRINT "High score!"
END IF
```

The shape is always the same:

```text
IF condition THEN
  ...statements that run when it is true...
END IF
```

`THEN` has to be the last thing on its line, and the body goes on the following lines. There is no one-line form of `IF`. Everything up to `END IF` belongs to the condition.

## Comparisons

A **condition** is a question with a yes/no answer. You build one with a comparison:

| Written | Means |
| --- | --- |
| `A = B` | A is equal to B |
| `A <> B` | A is *not* equal to B |
| `A < B` / `A > B` | A is smaller / bigger than B |
| `A <= B` / `A >= B` | A is smaller-or-equal / bigger-or-equal |

Notice that `=` means two different things. At the start of a line, `SCORE = 7` *stores* 7 in SCORE. Inside an `IF`, `SCORE = 7` *asks* whether SCORE equals 7.

You can compare text for equality as well: `IF NAME = "Mia" THEN`. The `<`, `>`, `<=` and `>=` signs work with **numbers only**. A number and a string are never equal, so `1 = "1"` is false.

## ELSE: the other way

Add `ELSE` to run something when the condition is false.

```basic id=c06-else output="Keep trying"
SCORE = 3
IF SCORE > 5 THEN
  PRINT "High score!"
ELSE
  PRINT "Keep trying"
END IF
```

There is no `ELSE IF`. To check several things in a row, put another `IF` inside the `ELSE`:

```basic id=c06-grades output="Bronze"
POINTS = 40
IF POINTS >= 90 THEN
  PRINT "Gold"
ELSE
  IF POINTS >= 70 THEN
    PRINT "Silver"
  ELSE
    PRINT "Bronze"
  END IF
END IF
```

Each `IF` needs its own `END IF`. Matching them up like brackets is the main skill: indenting the inner `IF` by two spaces makes it easy.

## AND, OR, NOT

Combine conditions:

- `A AND B` is true only when **both** are true.
- `A OR B` is true when **either** (or both) is true.
- `NOT A` flips true to false and false to true.

```basic id=c06-logic output="inside|outside"
X = 100
Y = 50
IF X > 80 AND X < 180 AND Y > 20 AND Y < 100 THEN
  PRINT "inside"
END IF
X = 250
IF X < 10 OR X > 245 THEN
  PRINT "outside"
END IF
```

`AND` is worked out before `OR`, like multiplication before addition, and `NOT` is worked out before `AND`. Add brackets when in doubt: `(A OR B) AND C`.

The right-hand side of an `AND` or `OR` is skipped when the answer is already clear. For example, `FALSE AND ANYTHING` is false without looking at `ANYTHING`.

> [!NOTE]
> You can keep a yes/no answer in a variable: `ALIVE = TRUE`, then `IF ALIVE THEN`. The words `TRUE` and `FALSE` are built in. As a convenience, `IF` also treats the number `0` and the empty string `""` as false. Everything else counts as true. That shortcut is accurate but easy to misread, so for readable code prefer an explicit comparison such as `IF LIVES > 0 THEN`.

## A picture that decides

```basic id=c06-checker px="4,4=15;28,4=0;4,28=0;28,28=15"
FOR Y = 0 TO 7
  FOR X = 0 TO 7
    IF (X + Y) / 2 = ROUND((X + Y) / 2) THEN
      INK 7
    ELSE
      INK 0
    END IF
    FILLBOX X * 24, Y * 24, 24, 24
  NEXT X
NEXT Y
```

The condition asks whether `(X + Y) / 2` is a whole number, which is true when X + Y is even. That is how a program tells even from odd without any special command: halve it, round it, and see whether anything changed.

## INPUT: ask a question

`INPUT "question", NAME` shows the question and waits for the player to type an answer. The program pauses until they press Enter.

```basic id=c06-input input="Mia|4" output="Hi, Mia!|You said 4|Nice choice."
INPUT "What is your name?", NAME
PRINT "Hi, " + NAME + "!"
GUESS = 0
INPUT "Pick a number from 1 to 5", GUESS
PRINT "You said " + GUESS
IF GUESS > 3 THEN
  PRINT "Nice choice."
END IF
```

There is one trap to learn: **what kind of answer do you get?** If the variable already holds a *number*, the answer must be a number and is stored as a number. If the variable is empty or holds text, the answer is stored as text. That is why the program sets `GUESS = 0` first, to tell the machine "I expect a number here". If someone then types letters, the machine says *Please type a number for GUESS.*

The question text is a normal value, so `"Hello " + NAME + ", pick a number"` works as a prompt.

## When something goes wrong

Everyone makes mistakes, including professionals; reading the message is a skill. The machine reports the **line number** and says what it wanted, in plain words.

```basic id=c06-error-name error=variable
PRINT SCORE
```

*Line 1: Give SCORE a value first.* The variable `SCORE` was never given a value.

A misspelt command gets a suggestion:

```basic id=c06-error-typo error=unknown
CIRCL 128,96,20
```

*Line 1: I don't know a spell called CIRCL. Did you mean CIRCLE?*

The most common causes of errors, in the order you are likely to meet them:

1. **A typo**: `CIRCL`, `FILBOX`, `PRNT`. Check the spelling against the Spellbook.
2. **A missing value**: a variable read before it was set, or a command given too few numbers (*CIRCLE needs 3 ingredients*).
3. **A missing end**: an `IF` with no `END IF`, a `FOR` with no `NEXT`, a `DO` with no `LOOP`. The message says what is missing.
4. **A missing quote**: `"HELLO` instead of `"HELLO"`.
5. **A number out of range**: `INK 9`, `RND(5,1)`, coordinates larger than ±10000.

For the complete catalogue, see [Error messages](book:ref-errors).

### Debugging with PRINT

When the program runs but does something strange, ask the machine what it is thinking. Put `PRINT` lines at the places you doubt, run, and read the values. Once the bug is found, delete the extra `PRINT` lines.

## Try it

1. Make the "inside" check draw a box on SCREEN instead of printing a word.
2. Ask the player for a number and print `"even"` or `"odd"`. Use the halve-and-round trick.
3. A secret number game: set `SECRET = RND(1,5)`, ask for a guess, and print whether it was too small, too big, or right. (Look at the Examples drawer for *Number Wizard* afterwards.)

<details>
<summary>Hints and answers</summary>

1. Replace the `PRINT` line with `BOX 80,20,100,80`, or choose the box from the X/Y limits in the condition.
2. `INPUT "Number?", N` after `N = 0`; then `IF N / 2 = ROUND(N / 2) THEN PRINT "even"` laid out over several lines, with `ELSE` for "odd".
3. Three results need two `IF`s: first `IF GUESS = SECRET`, and in the `ELSE`, `IF GUESS < SECRET THEN PRINT "too small" ELSE PRINT "too big"`.

</details>

## What you learned

- `IF … THEN … ELSE … END IF` chooses; comparisons are `= <> < > <= >=`.
- `AND`, `OR`, `NOT` combine conditions.
- `INPUT` asks; the starting value of the variable decides whether the answer is a number or text.
- Error messages name the line and say what was expected. `PRINT` is your flashlight.

You have now finished Part I. You can draw, calculate, repeat and decide, which is most of what programming is. Next: [sprites](book:sprites).
