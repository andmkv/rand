---
summary: Repeat work with FOR…NEXT and DO…LOOP, slow it down with WAIT, nest loops to fill the screen, and learn how the machine keeps loops safe.
---

# Loops: doing things again and again

**Goal:** draw hundreds of things with a few lines, and make programs that keep running.

## FOR…NEXT: count and repeat

A **loop** repeats a block of statements. The most common one counts:

```basic id=c05-row px="0,96=14;8,96=14;248,96=14;4,96=8"
INK 6
FOR X = 0 TO 255 STEP 8
  PLOT X,96
NEXT X
```

Reading it aloud: *for X from 0 to 255, step 8: plot a dot at X,96; next X.*

- `FOR X = 0 TO 255 STEP 8` creates the variable `X`, starts it at 0 and repeats until it would pass 255. After every pass it grows by 8.
- Everything between the `FOR` line and `NEXT X` is the **body**. Indenting the body with two spaces is not required, but it makes loops much easier to read.
- `NEXT X` sends the machine back to the top for the next value.
- `STEP` is optional. Without it, the variable grows by 1.

A counting loop can also go **backwards**, using a negative step:

```basic id=c05-countdown output="3|2|1|GO!"
FOR N = 3 TO 1 STEP -1
  PRINT N
NEXT N
PRINT "GO!"
```

The numbers in a `FOR` line can be variables or calculations, and decimals are fine: `FOR A = 0 TO 6.28 STEP 0.1`. The three numbers are worked out once, when the loop starts. `STEP 0` is an error because the loop would never move.

> [!NOTE]
> You may write `NEXT` followed by the variable name, as in `NEXT X`. If you do, it has to match the `FOR`, and the machine tells you when it does not.

## Using the counter

The counter is a normal variable. Use it in calculations to make patterns: here the radius shrinks and the colour changes with it.

```basic id=c05-rings px="128,96=9;213,96=14"
BORDER 0
FOR R = 90 TO 10 STEP -10
  INK ROUND(R / 15)
  FILLCIRCLE 128,96,R
NEXT R
```

Each pass draws a smaller solid circle on top of the bigger one. `ROUND(R / 15)` turns the radius into a colour number from 1 to 6, so every ring has a different colour.

## Loops inside loops

Put one loop inside another to cover a grid. The inner loop runs completely for every step of the outer loop.

```basic id=c05-grid px="10,10=15;33,10=15;42,10=15;10,42=15;20,20=8;34,10=8"
FOR Y = 10 TO 170 STEP 32
  FOR X = 10 TO 230 STEP 32
    BOX X,Y,24,24
  NEXT X
NEXT Y
```

With 6 rows and 7 columns that is 42 boxes from five lines of code.

## Waves and spirals

Together with `SIN` and `COS`, loops draw curves. A point at angle `A` and distance `R` from the centre is at `(128 + COS(A) * R, 96 + SIN(A) * R)`. If R grows while A turns, you get a spiral:

```basic id=c05-spiral px="128,96=13"
INK 5
FOR A = 0 TO 12.5 STEP 0.1
  R = A * 7
  PLOT 128 + COS(A) * R, 96 + SIN(A) * R
NEXT A
```

Angles for `SIN` and `COS` are in radians; a full circle is about 6.28. Change `STEP 0.1` to `0.02` and the dots join up into a smooth line. Be careful, though: see the speed limits below.

## WAIT: slow down and watch

Normally a loop runs so fast that you only see the final picture. `WAIT seconds` pauses for that many seconds (from 0 to 30; decimals are fine), so you can watch the picture build:

```basic id=c05-stairs px="36,104=12;150,60=12;36,60=8"
INK 4
FOR S = 0 TO 7
  FILLBOX 32 + S * 16, 100 - S * 8, 16, 8 + S * 8
  WAIT 0.2
NEXT S
```

`WAIT 0.2` pauses for a fifth of a second, so the staircase appears one step at a time.

## DO…LOOP: keep going

`DO` … `LOOP` repeats its body **forever**, until you press STOP. Use it for twinkling skies, game loops, and anything alive.

```basic id=c05-twinkle endless wait=5 events=PLOT
CLS 1
DO
  X = RND(0,255)
  Y = RND(0,191)
  INK RND(5,7)
  PLOT X,Y
  WAIT 0.02
LOOP
```

Run this and press STOP when you have had enough. Stars keep appearing at random places.

> [!WARNING]
> There is no `EXIT` or `BREAK` in this language. A `DO … LOOP` can only end when you press STOP. A well-behaved forever-loop also contains a `WAIT` or a `FRAME` so that it hands time back to the browser (more on `FRAME` in [chapter 8](book:motion)).

## Safety rails: how the machine protects you

The machine does not trust loops. It protects itself and your browser with these limits:

- A program **without** a `DO … LOOP` is stopped with the message *"That is a lot of magic!"* if it runs more than **10,000 loop passes in total**, or more than **30,000 statements**, or for more than **two minutes**.
- A single `FOR` loop, anywhere, can never run more than 10,000 passes.
- A program that **does** contain `DO … LOOP` is allowed to run for as long as it likes, because it is meant to be stopped by you.
- The machine automatically gives the browser a moment to draw every few drawing commands, so even a huge `FOR` loop never freezes the page. That is also why a long loop shows the picture building up rather than appearing in one flash.

This program shows the limit being hit on purpose:

```basic id=c05-limit error=limit
FOR I = 1 TO 20000
  PLOT 0,0
NEXT I
```

It stops with *"That is a lot of magic! Try a smaller loop or fewer shapes and sounds."* instead of hanging your browser.

## Try it

1. Change `STEP 8` in the first program to `STEP 4`, then to `STEP 2`. How many dots are on the line now?
2. Draw a chessboard: 8 × 8 squares of 20 pixels, with `FILLBOX` for the dark squares only. (You can do it without `IF`, using two pairs of loops.)
3. Make the stars in the twinkling program only appear in the top half of the screen.

<details>
<summary>Hints and answers</summary>

1. 256 ÷ 8 = 32 dots; 256 ÷ 4 = 64; 256 ÷ 2 = 128 dots. At STEP 1 the line becomes solid.
2. Dark squares are those where the column and row numbers have the same oddness. Use one pair of loops that steps by 40 starting at `(0,0)`, and another that steps by 40 starting at `(20,20)`.
3. Change `RND(0,191)` to `RND(0,95)`.

</details>

## What you learned

- `FOR … TO … STEP … NEXT` repeats a body a counted number of times; the counter is a normal variable.
- Loops can be nested, and combined with `SIN` and `COS` for curves.
- `WAIT seconds` slows things down so you can watch.
- `DO … LOOP` repeats until STOP. Other programs have a limit of 10,000 passes in total.

Next: [decisions](book:decisions).
