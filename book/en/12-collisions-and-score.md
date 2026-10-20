---
summary: Detect touching sprites with HIT, set hit boxes with SIZE, show a score with TEXT, and organise a game into states with a restart key.
---

# Collisions, score and game states

**Goal:** know when two things touch, count points, and handle winning, losing and starting over.

## HIT: do these two touch?

`HIT(a,b)` answers `TRUE` when two sprites overlap. Both sprites must be alive and visible. It compares their **boxes**: each sprite counts as a rectangle of its `WIDTH` × `HEIGHT`, centred on its position.

```basic id=c12-hit output="true|false|true|false"
A = SPAWN("cat",100,100)
B = SPAWN("star",110,100)
PRINT HIT(A,B)
B.MOVE 140,100
PRINT HIT(A,B)
B.MOVE 115,100
PRINT HIT(A,B)
B.MOVE 116,100
PRINT HIT(A,B)
```

Both sprites are 16 pixels wide. They overlap while their centres are less than 16 pixels apart, and they merely *touch edges* at exactly 16, which does not count. Hence the last answer is `false`.

### Make the box fit the picture

A box is a rough idea of a shape. A tall, thin character should have a tall, thin box:

```basic id=c12-size vars="W=12;H=16" sprites=1
HERO = SPAWN("traveler",50,50)
HERO.SIZE 12,16
W = HERO.WIDTH
H = HERO.HEIGHT
```

`SIZE` changes both what you see and what `HIT` measures. Make a bullet narrow with `SHOT.SIZE 3,8`. Make the paddle wide with `PADDLE.SIZE 40,8`. Some games make a hit box slightly smaller than the picture, so that a near-miss feels fair.

## Catching something

Move one sprite until it touches another, and then react. Here a star falls three pixels per frame onto a cat:

```basic id=c12-catch output="caught after 52 frames" sprites=1
CAT = SPAWN("cat",128,170)
STAR = SPAWN("star",128,0)
FOR T = 1 TO 100
  IF STAR.ALIVE THEN
    STAR.MOVE_BY 0,3
    IF HIT(CAT,STAR) THEN
      PRINT "caught after " + T + " frames"
      SFX "coin"
      STAR.DESTROY
    END IF
  END IF
  FRAME
NEXT T
```

Two details are worth noticing. `STAR.DESTROY` removes the star, so the message appears once; otherwise the star would keep overlapping the cat for several frames and the message would repeat. And once a sprite is destroyed, giving it any order (`STAR.MOVE_BY`) is an error, so the program asks `STAR.ALIVE` first. `ALIVE` is the one property that can always be asked.

In a real game the loop is a `DO … LOOP` that never ends by itself. *State variables* decide what happens inside it, as the next section shows.

## Game states

A game is in one situation at a time: getting ready, playing, won, lost. Name those situations with a number in a variable, usually called `STATE`, and make each part of the loop depend on it. All three shipped games (*Alien Attack*, *Brick Breaker* and *Pixel Quest*) use these four:

| STATE | Meaning |
| --- | --- |
| 0 | set up a new game |
| 1 | playing |
| 2 | won |
| 3 | lost |

```basic id=c12-states endless wait=6 vars="STATE>=1;STATE<=2"
CAT = SPAWN("cat",128,170)
STAR = SPAWN("star",128,0)
STATE = 0
DO
  IF STATE = 0 THEN
    SCORE = 0
    STAR.MOVE 128,0
    STAR.SHOW
    STATE = 1
  END IF
  IF STATE = 1 THEN
    STAR.MOVE_BY 0,3
    IF HIT(CAT,STAR) THEN
      SCORE = SCORE + 1
      STAR.MOVE 128,0
      SFX "coin"
    END IF
    IF SCORE = 3 THEN
      STATE = 2
    END IF
  END IF
  CLS 1
  INK 6
  TEXT 6,4,"SCORE " + SCORE
  IF STATE = 2 THEN
    INK 4
    TEXT 90,90,"YOU WIN!"
  END IF
  FRAME
LOOP
```

Read it as a story: the `STATE = 0` block runs once, sets the game up, and moves on to state 1. State 1 does the playing and decides when to go to state 2. Then the loop keeps drawing the "YOU WIN!" text over and over, until you press STOP. To start over, you set `STATE = 0` again, which is what the next section adds.

> [!TIP]
> Notice the order inside the loop: first change the **state**, then **draw**. Drawing last means the picture always matches the current state, with no half-updated frames.

## The score, drawn fresh every frame

Drawings never update by themselves. The score text says `SCORE 2` until something draws over it. There are two common ways:

1. **Erase, then write** (needed when you do not clear the whole screen): draw a filled rectangle in the background colour, then the text.
2. **Redraw everything every frame**: the way the shipped games do it. Start the drawing part of the loop with `CLS 1` (or `CLS 0`), then draw the title, score and messages again. Sprites are not affected by `CLS`.

Method 2 is simpler and cannot go wrong: the screen is rebuilt from the variables every frame. Because the program uses `FRAME`, the machine lets you draw many things per frame without slowing down.

Remember the idea of joining text and numbers: `"SCORE " + SCORE`.

## Starting over

Add a `KEY("R")` check at the top of the loop. If the game is over (`STATE > 1`), pressing R sends it back to state 0, which sets everything up again:

```basic id=c12-restart endless wait=3 keys=R vars="STATE>=1"
STATE = 3
DO
  IF KEY("R") AND STATE > 1 THEN
    STATE = 0
  END IF
  IF STATE = 0 THEN
    STATE = 1
  END IF
  CLS 0
  INK 7
  IF STATE = 1 THEN
    TEXT 80,90,"PLAYING"
  ELSE
    TEXT 64,90,"PRESS R TO RESTART"
  END IF
  FRAME
LOOP
```

This program starts in the "lost" state so you can see it work. Press R and it switches to "playing".

## Try it

1. Make the star give 10 points per catch and print the total as `SCORE 30`.
2. Add a `LIVES` counter that goes down when the star falls past the bottom.
3. Add a high score: keep `BEST` and update it when `SCORE` is bigger. Remember that RUN resets all variables, but restarting inside the loop does not.

<details>
<summary>Hints and answers</summary>

1. `SCORE = SCORE + 10` and `IF SCORE = 30 THEN`.
2. `IF STAR.Y > 192 THEN LIVES = LIVES - 1` (over several lines), and `IF LIVES = 0 THEN STATE = 3`. The next chapter builds this into a full game.
3. Set `BEST = 0` once, before the `DO`. When the game ends: `IF SCORE > BEST THEN BEST = SCORE` over several lines.

</details>

## What you learned

- `HIT(a,b)` checks overlapping boxes; `SIZE` sets the box.
- A `STATE` variable turns a loop into a small machine: setup, playing, won, lost.
- Redraw HUD text every frame with `CLS` and `TEXT`; use a key to restart.

Next: [your first complete game](book:your-first-game).
