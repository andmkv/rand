---
summary: Build STAR CATCHER, a complete original game with a player, falling stars, score, lives, winning, losing and restart, in four small steps.
---

# Your first complete game: STAR CATCHER

**Goal:** make a real, finished game from the pieces you already know. Each step is a program that runs, so you can stop after any step and still have something playable.

**The game:** stars fall from the sky. You steer a cat left and right to catch them. Each catch is a point and the stars fall faster as your score grows. If three stars reach the ground, the game is over. Catch ten and you win. Press R to play again.

> [!TIP]
> Click SCREEN after pressing RUN, so the arrow keys go to the game.

## Step 1 · A cat that moves

Start with what you know from [the keyboard chapter](book:keyboard): a character, a loop, two fences.

```basic id=c13-step1 endless wait=4 keys=LEFT vars="PX>=16;PX<=240"
CAT = SPAWN("cat",128,170)
DO
  IF KEY("LEFT") AND CAT.X > 16 THEN
    CAT.MOVE_BY -4,0
  END IF
  IF KEY("RIGHT") AND CAT.X < 240 THEN
    CAT.MOVE_BY 4,0
  END IF
  PX = CAT.X
  FRAME
LOOP
```

The variable `PX` is only there so this handbook's checker can look at the position. You can delete it.

## Step 2 · A falling star

A second sprite, the star, moves down by `SPEED` pixels every frame. When it leaves the bottom of SCREEN it jumps back to the top at a new random place.

```basic id=c13-step2 endless wait=4 keys=LEFT vars="SY>=0"
CAT = SPAWN("cat",128,170)
STAR = SPAWN("star",RND(16,240),0)
SPEED = 2
DO
  IF KEY("LEFT") AND CAT.X > 16 THEN
    CAT.MOVE_BY -4,0
  END IF
  IF KEY("RIGHT") AND CAT.X < 240 THEN
    CAT.MOVE_BY 4,0
  END IF
  STAR.MOVE_BY 0,SPEED
  IF STAR.Y > 192 THEN
    STAR.MOVE RND(16,240),0
  END IF
  SY = STAR.Y
  FRAME
LOOP
```

New ideas: `RND(16,240)` keeps the star away from the edges, and the star is moved back to the top with `MOVE` (absolute) while the fall uses `MOVE_BY` (relative).

## Step 3 · Catch it and count

Now ask `HIT(CAT,STAR)`. When they touch, add a point, play a sound, speed up, and send the star back to the top. The score is written at the top of SCREEN, redrawn every frame.

```basic id=c13-step3 endless wait=4 keys=LEFT vars="SCORE>=0"
CAT = SPAWN("cat",128,170)
STAR = SPAWN("star",RND(16,240),0)
SPEED = 2
SCORE = 0
DO
  IF KEY("LEFT") AND CAT.X > 16 THEN
    CAT.MOVE_BY -4,0
  END IF
  IF KEY("RIGHT") AND CAT.X < 240 THEN
    CAT.MOVE_BY 4,0
  END IF
  STAR.MOVE_BY 0,SPEED
  IF HIT(CAT,STAR) THEN
    SCORE = SCORE + 1
    SPEED = 2 + SCORE / 4
    STAR.MOVE RND(16,240),0
    SFX "coin"
  END IF
  IF STAR.Y > 192 THEN
    STAR.MOVE RND(16,240),0
  END IF
  CLS 1
  INK 6
  TEXT 6,4,"SCORE " + SCORE
  FRAME
LOOP
```

- `SPEED = 2 + SCORE / 4` makes the game get harder: at 4 points the speed is 3, at 8 points it is 4.
- `SFX` (not `SOUND`) is used so the game never pauses for the sound.
- `CLS 1` wipes the drawing and paints the sky blue; the sprites stay. Then the score is drawn again with the new number.

## Step 4 · Lives, winning, losing, restarting

Now the full game. It uses the state machine from [chapter 12](book:collisions-and-score): `STATE` is 0 (set up), 1 (playing), 2 (won) or 3 (lost). Read the code from the top and match each part to the step before.

```basic id=c13-star-catcher endless wait=30 keys=LEFT vars="LIVES>=0;SCORE>=0"
' STAR CATCHER - catch ten stars, lose three and it is over
CAT = SPAWN("cat",128,170)
STAR = SPAWN("star",128,0)
STATE = 0
DO
  IF KEY("R") AND STATE > 1 THEN
    STATE = 0
  END IF
  IF STATE = 0 THEN
    SCORE = 0
    LIVES = 3
    SPEED = 2
    CAT.MOVE 128,170
    STAR.MOVE RND(16,240),0
    STAR.SHOW
    STATE = 1
  END IF
  IF STATE = 1 THEN
    IF KEY("LEFT") AND CAT.X > 16 THEN
      CAT.MOVE_BY -4,0
    END IF
    IF KEY("RIGHT") AND CAT.X < 240 THEN
      CAT.MOVE_BY 4,0
    END IF
    STAR.MOVE_BY 0,SPEED
    IF HIT(CAT,STAR) THEN
      SCORE = SCORE + 1
      SPEED = 2 + SCORE / 4
      STAR.MOVE RND(16,240),0
      SFX "coin"
    END IF
    IF STAR.Y > 192 THEN
      LIVES = LIVES - 1
      STAR.MOVE RND(16,240),0
      SFX "explosion"
    END IF
    IF SCORE = 10 THEN
      STATE = 2
      STAR.HIDE
    END IF
    IF LIVES = 0 THEN
      STATE = 3
      STAR.HIDE
    END IF
  END IF
  CLS 1
  BORDER 1
  INK 6
  TEXT 6,4,"SCORE " + SCORE
  INK 2
  TEXT 186,4,"LIVES " + LIVES
  IF STATE = 2 THEN
    INK 4
    TEXT 92,84,"YOU WIN!"
  END IF
  IF STATE = 3 THEN
    INK 2
    TEXT 86,84,"GAME OVER"
  END IF
  IF STATE > 1 THEN
    INK 7
    TEXT 52,106,"PRESS R TO PLAY AGAIN"
  END IF
  FRAME
LOOP
```

### Walkthrough

1. **Set-up of sprites (before the loop).** The cat and star are created once. They are moved and shown again on every restart, never re-created.
2. **`STATE = 0` block.** Resets the score, lives and speed, puts both sprites back and switches to state 1. This is the restart code *and* the start code.
3. **`STATE = 1` block.** One frame of playing: keys, the star falling, catching (point, faster, new star) and missing (lose a life). It ends by checking the two end conditions. Both `IF`s hide the star, so a finished game has no star flying around.
4. **The drawing part.** Always runs. It clears, shows the score and lives, and adds a message for state 2 or 3.
5. **`KEY("R")`.** At the top of the loop. It only works when the game is over.

## Make it yours

Three modifications, from easy to harder:

1. **Easy:** change the number of lives, the winning score (`SCORE = 10`), or the speed formula.
2. **Medium:** add a bad sprite (a `slime`) that falls too. Catching it costs a life.
3. **Harder:** show the lives as little sprites. Keep them in a list, and `HIDE` the last one visible each time a life is lost.

<details>
<summary>Hints and answers</summary>

1. Only three numbers change: `LIVES = 3`, `SCORE = 10` and `2 + SCORE / 4`.
2. Create `SLIME = SPAWN("slime",RND(16,240),0)` at the start. Move it down like the star. `IF HIT(CAT,SLIME) THEN LIVES = LIVES - 1`, written over several lines. Do not forget to reset it.
3. `HEARTS = LIST()` and `FOR I = 1 TO 3` with `PUSH HEARTS,SPAWN("star",20 + I * 20,18)`. When `LIVES` drops, use `ITEM(HEARTS,LIVES + 1)` and its `HIDE`. Show them all again in state 0.

</details>

## What you learned

- A complete game is a loop with a `STATE` variable, the keys read first, the world updated second, and the picture redrawn last.
- You can build a game in checkpoints that always run.
- You wrote every line of it, and you can change every number.

Next: [reading the shipped games](book:reading-real-games).
