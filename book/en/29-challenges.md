---
summary: Open-ended projects at three difficulty levels, each with a runnable starter and hints, to try on your own.
---

# Challenges

You have the tools. These are projects to try on your own. Each has a starter that runs, and a hint that is separate, so you can try first. Use **Open in Sandbox**, change it, and make it yours.

## Easy

### 1 · Sunset

Draw a sky that goes from blue at the top to red at the bottom, with a sun half hidden by the horizon.

```basic id=x-sunset px="10,5=9;10,100=11;10,185=10"
CLS 1
FOR Y = 0 TO 180 STEP 6
  INK 1
  IF Y > 60 THEN
    INK 3
  END IF
  IF Y > 120 THEN
    INK 2
  END IF
  FILLBOX 0,Y,256,6
NEXT Y
```

<details>
<summary>Ideas</summary>

Add `INK 6` and `FILLCIRCLE 128,150,30`, then draw the ground over it with a `FILLBOX` in `INK 0` starting at `y = 150`. Add stars to the dark part with `PLOT`.

</details>

### 2 · Name banner

Spell a word on SCREEN one letter at a time, each in its own colour, with a sound for every letter.

```basic id=x-banner events=TEXT,SFX
CLS 1
LETTERS = LIST("H","E","L","L","O")
FOR I = 1 TO COUNT(LETTERS)
  INK I + 1
  TEXT 20 + I * 30,90,ITEM(LETTERS,I)
  SFX "blip"
  WAIT 0.2
NEXT I
```

<details>
<summary>Ideas</summary>

There is no command to cut a string into letters, so the letters go in a list. Put in your own name. Make the letters bounce by drawing each one at a different `y`, using `SIN`. Letters cannot be scaled, but you can draw a letter twice, one pixel apart, for a bold look.

</details>

## Medium

### 3 · Fireworks

Launch a rocket from the bottom, burst it in the sky into lines of colour, and do it forever.

```basic id=x-fireworks endless wait=6 events=LINE,SFX
CLS 1
DO
  X = RND(40,215)
  Y = RND(30,100)
  INK RND(2,7)
  FOR H = 180 TO Y STEP -8
    PLOT X,H
    WAIT 0.01
  NEXT H
  SFX "explosion"
  FOR A = 0 TO 6.3 STEP 0.4
    LINE X,Y,X + COS(A) * 24,Y + SIN(A) * 24
  NEXT A
  WAIT 0.5
  CLS 1
LOOP
```

<details>
<summary>Ideas</summary>

Make a second ring of shorter lines in another colour. Draw the rocket as a sprite. Make the burst bigger on every third firework with a counter.

</details>

### 4 · Dodge the slimes

A hero walks left and right while slimes fall. Touch one and the game is over.

```basic id=x-dodge endless wait=8 keys=RIGHT vars="LIVES>=0"
HERO = SPAWN("traveler",128,176)
HERO.SIZE 12,16
SLIME = SPAWN("slime",RND(16,240),0)
SLIME.SIZE 12,14
LIVES = 3
DO
  IF KEY("LEFT") AND HERO.X > 16 THEN
    HERO.MOVE_BY -3,0
  END IF
  IF KEY("RIGHT") AND HERO.X < 240 THEN
    HERO.MOVE_BY 3,0
  END IF
  SLIME.MOVE_BY 0,3
  IF HIT(HERO,SLIME) THEN
    IF LIVES > 0 THEN
      LIVES = LIVES - 1
    END IF
    SFX "explosion"
    SLIME.MOVE RND(16,240),0
  END IF
  IF SLIME.Y > 200 THEN
    SLIME.MOVE RND(16,240),0
  END IF
  CLS 0
  INK 7
  TEXT 6,4,"LIVES " + LIVES
  FRAME
LOOP
```

<details>
<summary>Ideas</summary>

Add `STATE` with a game-over message and restart on `R`. Use a list of slimes at different speeds. Make the slimes faster as time goes by (a counter that increases `SPEED`).

</details>

## Harder

### 5 · Pong for two

Two paddles, one ball. W/S move the left paddle, the arrow keys move the right one. First to five points wins.

```basic id=x-pong endless wait=8 vars="LEFT_SCORE>=0;RIGHT_SCORE>=0"
LEFT_PADDLE = SPAWN("paddle",12,96)
LEFT_PADDLE.SIZE 8,36
RIGHT_PADDLE = SPAWN("paddle",244,96)
RIGHT_PADDLE.SIZE 8,36
BALL = SPAWN("ball",128,96)
BALL.SIZE 8,8
VX = 2
VY = 1
LEFT_SCORE = 0
RIGHT_SCORE = 0
DO
  IF KEY("W") AND LEFT_PADDLE.Y > 28 THEN
    LEFT_PADDLE.MOVE_BY 0,-3
  END IF
  IF KEY("S") AND LEFT_PADDLE.Y < 164 THEN
    LEFT_PADDLE.MOVE_BY 0,3
  END IF
  IF KEY("UP") AND RIGHT_PADDLE.Y > 28 THEN
    RIGHT_PADDLE.MOVE_BY 0,-3
  END IF
  IF KEY("DOWN") AND RIGHT_PADDLE.Y < 164 THEN
    RIGHT_PADDLE.MOVE_BY 0,3
  END IF
  BALL.MOVE_BY VX,VY
  IF BALL.Y < 8 OR BALL.Y > 184 THEN
    VY = -VY
  END IF
  IF HIT(BALL,LEFT_PADDLE) AND VX < 0 THEN
    VX = -VX
    SFX "blip"
  END IF
  IF HIT(BALL,RIGHT_PADDLE) AND VX > 0 THEN
    VX = -VX
    SFX "blip"
  END IF
  IF BALL.X < 0 THEN
    RIGHT_SCORE = RIGHT_SCORE + 1
    BALL.MOVE 128,96
  END IF
  IF BALL.X > 256 THEN
    LEFT_SCORE = LEFT_SCORE + 1
    BALL.MOVE 128,96
  END IF
  CLS 0
  INK 7
  TEXT 100,4,LEFT_SCORE + " : " + RIGHT_SCORE
  FRAME
LOOP
```

<details>
<summary>Ideas</summary>

Stop at five points (a `STATE` variable). Make the ball speed up on every paddle hit. Aim the ball by where it hits the paddle, like *Brick Breaker* does. Notice the checks `VX < 0` and `VX > 0` in the starter: the ball overlaps a paddle for several frames, and without them it would turn around again and again and get stuck.

</details>

### 6 · Your own world

Combine everything: a Story-like scene, with a hero, enemies, a collectable, a score, three screens (using `STATE`), your own pixel art, and your own sounds. Publish it with a *How to play* text and give the link to a friend.

## When you are stuck

1. Run the starter and change one number.
2. Read the matching chapter and its reference page.
3. Cut the program down until it works, and add back piece by piece.
4. Look at the three games in the EXAMPLES drawer: someone has probably solved your problem there already.
