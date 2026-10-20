---
summary: Read short, annotated pieces of the three playable games that ship with Randomize USR, and learn the techniques they use.
---

# Reading real games

**Goal:** learn from professional-style code. The EXAMPLES drawer contains three complete games under **GAMES**. They are written in the same language you have been learning, nothing hidden. This chapter points at the interesting parts.

| Game | Keys | What is special |
| --- | --- | --- |
| **ALIEN ATTACK** | ← → move, SPACE fire, R restart | A grid of enemies moves as a block; one reusable bullet. |
| **BRICK BREAKER** | ← → move the paddle, R restart | A bouncing ball with simple physics; a wall of bricks in a list. |
| **PIXEL QUEST** | ← → walk, SPACE jump, R restart | Gravity, landing on platforms, stars to collect and a door. |

Open one from **EXAMPLES**, press RUN, play it, and then read the code beside this chapter. The pieces below are quoted word for word from the games, and the handbook's checker makes sure they still match.

> [!NOTE]
> The games are shipped as they are in the EXAMPLES drawer. Changing a copy never changes the original, and you can always reload the original from the drawer.

## Common structure

All three games share the skeleton from the last chapters: set the sprites up once, then a `DO … LOOP` that reads `STATE`, and a drawing part that rebuilds the HUD with `CLS 0`. Notice how a restart is just `STATE = 0` again:

```basic id=c14-alien-state fragment quote=alien-attack
STATE = 0
DO
  IF KEY("R") AND STATE > 1 THEN
    STATE = 0
  END IF
  IF STATE = 0 THEN
    SCORE = 0
```

## ALIEN ATTACK

### One bullet, reused

The game has a single bullet sprite that is hidden when not in use. `SHOT.VISIBLE` is the "is it flying?" flag. Compare it with the shot from [chapter 11](book:keyboard):

```basic id=c14-alien-shot fragment quote=alien-attack
    IF KEY("LEFT") AND SHIP.X > 10 THEN
      SHIP.MOVE_BY -3,0
    END IF
    IF KEY("RIGHT") AND SHIP.X < 246 THEN
      SHIP.MOVE_BY 3,0
    END IF
    IF KEY("SPACE") AND NOT SHOT.VISIBLE THEN
      SHOT.MOVE SHIP.X,164
      SHOT.SHOW
      SFX "laser"
    END IF
    IF SHOT.VISIBLE THEN
      SHOT.MOVE_BY 0,-4
      IF SHOT.Y < 20 THEN
        SHOT.HIDE
      END IF
    END IF
```

### A grid from a list

Ten aliens live in a list. Each frame, every alien is re-positioned from two shared numbers, `WAVE_X` and `WAVE_Y`, plus its own column and row. Moving the whole formation means changing just those two numbers:

```basic id=c14-alien-grid fragment quote=alien-attack
    FOR N = 1 TO COUNT(ALIENS)
      ALIEN = ITEM(ALIENS,N)
      COLUMN = N-1
      ROW = 0
      IF N > 5 THEN
        COLUMN = N-6
        ROW = 1
      END IF
      ALIEN.MOVE WAVE_X+COLUMN*38,WAVE_Y+ROW*26
      IF HIT(SHOT,ALIEN) THEN
        ALIEN.HIDE
        SHOT.HIDE
        SCORE = SCORE+10
        SFX "coin"
      END IF
```

A hit hides the alien instead of destroying it, so the list stays complete and a restart can show them all again.

### The HUD

The last part of the loop draws the title and score fresh, every frame:

```basic id=c14-alien-hud fragment quote=alien-attack
  CLS 0
  BORDER 1
  INK 5
  TEXT 6,5,"ALIEN ATTACK"
  INK 7
  TEXT 170,5,"SCORE "+SCORE
```

**Try:** the game's own tip is to change `SPEED = 0.24` to `0.4` for faster aliens.

## BRICK BREAKER

### A wall in a list

The nested loops from chapter 5 build the wall; a variable `KIND` picks the sprite for each row, and `SIZE` makes every brick 30 × 10 pixels:

```basic id=c14-brick-wall fragment quote=brick-breaker
BRICKS = LIST()
FOR ROW = 1 TO 3
  FOR COLUMN = 1 TO 6
    KIND = "brick_red"
    IF ROW = 2 THEN
      KIND = "brick_cyan"
    END IF
    IF ROW = 3 THEN
      KIND = "brick_yellow"
    END IF
    BRICK = SPAWN(KIND,COLUMN*36+2,26+ROW*14)
    BRICK.SIZE 30,10
    PUSH BRICKS,BRICK
  NEXT COLUMN
NEXT ROW
```

### Ball physics

The ball has its own position (`X`, `Y`) and velocity (`VX`, `VY`) in plain variables, and the sprite is simply moved there. Walls flip a velocity. The paddle flips `VY` and also *aims* the ball: the farther from the paddle's centre it lands, the more sideways it goes (`VX = (X-PADDLE.X)/10`).

```basic id=c14-brick-ball fragment quote=brick-breaker
    OLD_Y = Y
    X = X+VX
    Y = Y+VY
    IF X < 4 OR X > 252 THEN
      VX = -VX
      X = X+VX
    END IF
    IF Y < 22 THEN
      VY = ABS(VY)
    END IF
    BALL.MOVE X,Y
    IF HIT(BALL,PADDLE) AND VY > 0 THEN
      Y = PADDLE.Y-PADDLE.HEIGHT/2-BALL.HEIGHT/2
      VY = -ABS(VY)
      VX = (X-PADDLE.X)/10
      IF ABS(VX) < 0.8 THEN
        VX = 0.8
      END IF
      SFX "jump"
    END IF
```

Look at `VY = ABS(VY)` against the ceiling: it forces the ball downward without needing to know which way it was going. And `AND VY > 0` makes the paddle ignore a ball that is already moving up, which avoids the ball getting stuck inside the paddle.

**Try:** make the paddle easier with `PADDLE.SIZE 60,8` at the top of the program.

## PIXEL QUEST

### Jump, gravity and landing

This is the most advanced piece. The hero has a vertical velocity `VY`. Gravity adds 0.22 each frame. A jump sets `VY` to a negative number (up). Landing means: the hero was above the platform's top last frame and is at or below it now, and its horizontal position is over the platform.

```basic id=c14-quest-jump fragment quote=pixel-quest
    IF JUMP_HELD AND NOT WAS_JUMP AND GROUNDED THEN
      VY = JUMP
      SFX "jump"
    END IF
    OLD_BOTTOM = Y+HERO.HEIGHT/2
    VY = VY+0.22
    Y = Y+VY
    GROUNDED = FALSE
    FOR N = 1 TO COUNT(PLATFORMS)
      LEDGE = ITEM(PLATFORMS,N)
      TOP = LEDGE.Y-LEDGE.HEIGHT/2
      IF VY >= 0 AND OLD_BOTTOM <= TOP AND Y+HERO.HEIGHT/2 >= TOP THEN
        IF ABS(X-LEDGE.X) < (LEDGE.WIDTH+HERO.WIDTH)/2 THEN
          Y = TOP-HERO.HEIGHT/2
          VY = 0
          GROUNDED = TRUE
        END IF
      END IF
    NEXT N
```

Three ideas to take away:

1. **Remember the previous position** (`OLD_BOTTOM`). Comparing "before" and "after" stops the hero from falling through thin platforms at high speed.
2. **One jump per press.** `JUMP_HELD AND NOT WAS_JUMP` is the "was it held?" trick from [chapter 11](book:keyboard), and `GROUNDED` stops jumping in mid-air.
3. **Loop over the platforms.** The same check works for any number of platforms because they are in a list.

**Try:** change `JUMP = -4.8` to `-5.4` to leap higher.

## How to learn from code

When you read someone else's program, do not start at the top and try to understand every line. Instead:

1. **Run it** and play. Name each thing you see.
2. **Find the state variable** and the main `DO` loop.
3. **Change one number** and predict what happens before you run it.
4. **Delete one block** and see what breaks.

## What you learned

- Real games use the same few ideas: states, lists, previous positions, and one-press keys.
- You can read, run, and modify the shipped games from the EXAMPLES drawer.

Part III is done. Next you will learn to make your own pictures and sounds: [the pixel editor](book:pixel-editor).
