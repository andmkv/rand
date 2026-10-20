---
summary: Read the keyboard with KEY, build the heartbeat loop of a game, move a character with the arrows or WASD, and fire once per key press.
---

# The keyboard: a character you steer

**Goal:** move a character with the keys, stay inside SCREEN, and fire a shot exactly once per press.

## Asking about a key

`KEY("name")` is a function that answers `TRUE` while that key is held down, and `FALSE` when it is not. You ask it every frame, inside a loop.

The names you can use are `"LEFT"`, `"RIGHT"`, `"UP"`, `"DOWN"` (the arrow keys), `"SPACE"`, `"ENTER"`, a single letter `"A"` to `"Z"`, or a digit `"0"` to `"9"`. Upper or lower case does not matter. Any other name gives an error that lists the allowed ones.

> [!IMPORTANT]
> The keys go to **SCREEN**, not to CODE. When you press **RUN**, a program that uses `KEY` moves the keyboard focus to SCREEN by itself. If you click in CODE to edit, the keys go to the editor again; click on SCREEN to give them back to the game. Combinations with `Ctrl`, `⌘` or `Alt` are ignored, so the browser's own shortcuts keep working.

Letter keys are read by their **position** on the keyboard, not by the letter printed on them, so `KEY("W")` works on a Russian or Greek keyboard layout as well.

## The game loop

Almost every game has the same skeleton:

```text
set everything up
DO
  read the keys
  change the world
  draw the world
  FRAME
LOOP
```

Here it is with a spaceship that moves left and right:

```basic id=c11-move endless wait=5 keys=RIGHT vars="PX>=240;PX<=243"
SHIP = SPAWN("ship",128,170)
DO
  IF KEY("LEFT") AND SHIP.X > 16 THEN
    SHIP.MOVE_BY -3,0
  END IF
  IF KEY("RIGHT") AND SHIP.X < 240 THEN
    SHIP.MOVE_BY 3,0
  END IF
  PX = SHIP.X
  FRAME
LOOP
```

Run it, click SCREEN if the arrows do nothing, and steer.

- `FRAME` makes the loop run about 60 times a second.
- The check `SHIP.X > 16` is a **fence**: it only lets the ship move left while it is still inside SCREEN. Without the fence the ship drives off the edge and is lost.
- Two different `IF`s, one per direction, means that holding both keys cancels out.

If you want the ship to stop being pushed when you leave the keys, it already does: the ship only moves while the key is down.

## Four directions and two layouts

Support the arrows and the WASD keys together by joining two `KEY`s with `OR`:

```basic id=c11-wasd endless wait=5 keys="RIGHT,DOWN" vars="PX=240;PY=176"
HERO = SPAWN("traveler",128,96)
DO
  IF (KEY("LEFT") OR KEY("A")) AND HERO.X > 16 THEN
    HERO.MOVE_BY -2,0
  END IF
  IF (KEY("RIGHT") OR KEY("D")) AND HERO.X < 240 THEN
    HERO.MOVE_BY 2,0
  END IF
  IF (KEY("UP") OR KEY("W")) AND HERO.Y > 16 THEN
    HERO.MOVE_BY 0,-2
  END IF
  IF (KEY("DOWN") OR KEY("S")) AND HERO.Y < 176 THEN
    HERO.MOVE_BY 0,2
  END IF
  PX = HERO.X
  PY = HERO.Y
  FRAME
LOOP
```

Pressing two keys at once moves diagonally: both `IF`s are true in the same frame.

## Once per press: the "was it held?" trick

Fire a shot every frame while SPACE is held and the screen fills with bullets. Usually you want *one* shot per press. The trick is to remember whether the key was already down in the **previous** frame:

```basic id=c11-fire endless wait=3 keys=SPACE vars="SHOTS=1"
HELD = FALSE
SHOTS = 0
DO
  IF KEY("SPACE") AND NOT HELD THEN
    SHOTS = SHOTS + 1
    SFX "laser"
  END IF
  HELD = KEY("SPACE")
  FRAME
LOOP
```

The shot fires only on the frame where SPACE is down *and* `HELD` is false. At the end of every frame, `HELD` is updated. Holding the key for ten seconds still counts as one press. This is how *Pixel Quest* makes you release SPACE between jumps.

An even simpler cousin is the **cool-down**: a counter that counts down to zero before the next shot is allowed.

```basic id=c11-cooldown endless wait=3 keys=SPACE vars="SHOTS>=5;SHOTS<=8"
WAIT_SHOT = 0
SHOTS = 0
DO
  IF WAIT_SHOT > 0 THEN
    WAIT_SHOT = WAIT_SHOT - 1
  END IF
  IF KEY("SPACE") AND WAIT_SHOT = 0 THEN
    SHOTS = SHOTS + 1
    WAIT_SHOT = 30
  END IF
  FRAME
LOOP
```

With a cool-down of 30 frames you can fire twice a second at most.

## A shot that flies

A bullet is a sprite you move yourself. Hide it when it is not flying, and use its visibility as the "is it in use?" flag:

```basic id=c11-shot endless wait=3 keys=SPACE vars="SY>=20"
SHIP = SPAWN("ship",128,170)
SHOT = SPAWN("ball",128,160)
SHOT.SIZE 4,8
SHOT.HIDE
DO
  IF KEY("SPACE") AND NOT SHOT.VISIBLE THEN
    SHOT.MOVE SHIP.X,160
    SHOT.SHOW
    SFX "laser"
  END IF
  IF SHOT.VISIBLE THEN
    SHOT.MOVE_BY 0,-5
    IF SHOT.Y < 20 THEN
      SHOT.HIDE
    END IF
  END IF
  SY = SHOT.Y
  FRAME
LOOP
```

One sprite is reused for every shot. That keeps the number of sprites small and the code short.

## Try it

1. Change the speed of the ship from 3 to 5. Does it still feel right?
2. Make the ship wrap around: when it leaves the right edge it appears on the left.
3. Make the spaceship fire with `UP` as well as `SPACE`.

<details>
<summary>Hints and answers</summary>

1. Higher speeds feel quick but make precise aiming harder. Games often use 2–4 pixels per frame.
2. Replace the fence with `IF SHIP.X > 255 THEN SHIP.MOVE 0,170`, written over several lines.
3. `IF (KEY("SPACE") OR KEY("UP")) AND NOT SHOT.VISIBLE THEN`.

</details>

## What you learned

- `KEY("name")` is `TRUE` while the key is down; the game loop reads keys, changes the world, draws, and calls `FRAME`.
- Fences keep characters on SCREEN.
- Remember last frame's key state, or use a cool-down, to fire once.

Next: [collisions and score](book:collisions-and-score).
