---
summary: Make things move smoothly with speed variables, loops, WAIT and FRAME, and write a simple game loop that bounces, falls and orbits.
---

# Motion and animation

**Goal:** make anything move smoothly, at a steady speed, until you press STOP.

## Animation is just many small changes

A film is a quick series of still pictures. Your program does the same thing: change a position a tiny bit, wait a moment, change it again. If the steps are small and quick, your eye sees movement.

```basic id=c08-slide vars="CX=228" sprites=1
CAT = SPAWN("cat",20,110)
FOR X = 20 TO 230 STEP 4
  CAT.MOVE X,110
  WAIT 0.02
NEXT X
CX = CAT.X
```

The cat jumps 4 pixels every 0.02 seconds, which is 200 pixels per second.

## Speed in a variable

Better than hard-coding the step is a **speed variable**. Then bouncing is just flipping its sign:

```basic id=c08-bounce endless wait=5 vars="PX>=16;PX<=250"
CAT = SPAWN("cat",30,110)
SPEED = 3
DO
  CAT.MOVE_BY SPEED,0
  IF CAT.X > 240 THEN
    SPEED = -3
  END IF
  IF CAT.X < 16 THEN
    SPEED = 3
  END IF
  PX = CAT.X
  FRAME
LOOP
```

The whole animation is five ideas:

1. A **position** (here the sprite itself).
2. A **speed**, which is how far to move per step.
3. A **loop** that adds the speed to the position every step.
4. A **check** at the edges that turns the speed around.
5. A short **pause** so each step is seen: `FRAME`.

## FRAME: wait for the next picture

`FRAME` pauses until the next screen refresh, about **1/60 of a second**. A `DO` loop with `FRAME` in it runs at roughly 60 steps per second, which is the usual speed of video games.

Why not just `WAIT 0.016`? It would work, but `FRAME` also tells the machine something useful: *"a whole picture is finished now, no need to hurry me."* As soon as your program uses `FRAME` anywhere, the machine changes its mood. It stops cutting your drawing into small slices, and lets you draw many shapes between two `FRAME`s. That is perfect for games that clear and redraw many things in every step.

Use `WAIT seconds` when you want a particular time (a one-second pause, a slow animation). Use `FRAME` for the heartbeat of a game loop.

> [!TIP]
> In a game loop, think in **pixels per frame**. A speed of 3 at 60 frames per second is 180 pixels per second, so it takes a bit under a second to cross SCREEN.

## Gravity: acceleration

Real things speed up as they fall. In code: add a bit to the speed every frame, and a bit to the position.

```basic id=c08-gravity endless wait=6 vars="Y>=0;Y<=190"
BALL = SPAWN("ball",128,20)
VY = 0
DO
  VY = VY + 0.4
  BALL.MOVE_BY 0,VY
  IF BALL.Y > 170 THEN
    BALL.MOVE 128,170
    VY = -VY * 0.8
  END IF
  Y = BALL.Y
  FRAME
LOOP
```

- `VY` is the vertical speed. It grows by 0.4 every frame (gravity).
- When the ball reaches the floor at y = 170, it is put back on the floor, and the speed flips and shrinks to 80% of its size, so every bounce is lower.

Change `0.4` to `0.1` for the Moon, and `0.8` to `0.95` for a bouncier ball.

## Circles: SIN and COS

To move something around a circle, use the same trick as for drawing one: position = centre + (COS(angle), SIN(angle)) × radius, and grow the angle each frame.

```basic id=c08-orbit px="198,96=15" sprites=1
SHIP = SPAWN("ship",128,96)
FOR A = 0 TO 6.28 STEP 0.05
  X = 128 + COS(A) * 70
  Y = 96 + SIN(A) * 70
  SHIP.MOVE X,Y
  PLOT X,Y
  FRAME
NEXT A
```

The ship leaves a trail of dots because `PLOT` stays on the drawing layer, while the sprite moves on top. Both layers are in play at once.

## Drawing animation: erase and redraw

Moving things by drawing is also possible. Because drawings never move, you erase the old shape (draw it again in the background colour) and draw it in the new place:

```basic id=c08-ball-draw endless wait=3 vars="BX>=8;BX<=248"
BX = 20
DX = 4
DO
  INK 0
  FILLCIRCLE BX,96,8
  BX = BX + DX
  IF BX > 248 OR BX < 8 THEN
    DX = -DX
  END IF
  INK 6
  FILLCIRCLE BX,96,8
  FRAME
LOOP
```

Drawing sprites and moving them is usually simpler. But erase-and-redraw is the right tool when you want to draw something that is not a sprite: scores, bars, tails and lasers.

## Wall-clock timing and the limits

- `WAIT` accepts from 0 to 30 seconds per call.
- A long-running program must contain a `DO … LOOP`; the machine stops other programs after 10,000 loop passes or two minutes. See [chapter 5](book:loops) for the full list.
- Without a `FRAME` or `WAIT`, a loop is still automatically sliced so that the page never freezes, but the speed is then not predictable. Always pace your animation with `FRAME` or `WAIT`.

## Try it

1. Make the bouncing cat go twice as fast, and also move up and down (add a second speed, `SPEEDY`).
2. Make the planet orbit change speed as it goes (hint: make the `STEP` of the angle a variable).
3. In the gravity program, make the ball also drift sideways and bounce off the left and right walls.

<details>
<summary>Hints and answers</summary>

1. `CAT.MOVE_BY SPEED,SPEEDY` and add similar `IF` checks for `CAT.Y` using 16 and 176.
2. Replace the `FOR` with `DO`, keep `A = A + ASTEP`, and change `ASTEP` over time.
3. Add `VX` and `BALL.MOVE_BY VX,VY`, and flip `VX` when `BALL.X` leaves 8…248.

</details>

## What you learned

- Animation = change a little, wait a little, repeat.
- A speed variable and an edge check make bouncing; adding to the speed makes gravity.
- `FRAME` is the heartbeat of a game loop (about 60 per second).
- `SIN` and `COS` move things around circles.

Next: [lists](book:lists).
