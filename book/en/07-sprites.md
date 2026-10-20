---
summary: Bring characters to life with SPAWN, then move, resize, turn, hide, speak and blow them up with sprite methods.
---

# Sprites: characters that move

**Goal:** put a character on SCREEN and control it with code.

## What is a sprite?

A **sprite** is a small picture that you can move around. Everything you drew so far (`PLOT`, `LINE`, `CIRCLE`…) stays where it is once drawn. A sprite is different: it is an *object* with a position, a size and a direction, and you can ask it to move again and again.

You create a sprite with the function `SPAWN` and keep it in a variable:

```basic id=c07-cat sprites=1 events=SPAWN:cat
CAT = SPAWN("cat",128,100)
CAT.SAY "Meow!"
```

- `SPAWN("cat",128,100)` creates a cat whose **centre** is at x = 128, y = 100.
- The answer is stored in `CAT`, so now `CAT` is the cat.
- `CAT.SAY "Meow!"` is a **method call**: variable, dot, method name, arguments. It asks that sprite to show a speech bubble.

> [!NOTE]
> `SPAWN` *gives something back*, so its result has to go somewhere: into a variable (`CAT = SPAWN("cat",10,10)`) or into a list. A line that only says `SPAWN("cat",10,10)` is an error.

### Which sprites exist?

The machine ships with nineteen built-in sprites: `cat`, `wizard`, `ghost`, `key`, `door`, `star`, `crate`, `dynamite`, `rocket`, `slime`, `alien`, `ship`, `paddle`, `ball`, `brick_red`, `brick_cyan`, `brick_yellow`, `platform` and `traveler`. The name is not case-sensitive. You can see all of them, with their pictures, in the **INVENTORY** drawer; press **Insert in CODE** to paste the line that creates one. If you misspell a name, the error lists the real ones. (People with an account can also draw their own: see [the pixel editor chapter](book:pixel-editor).)

A built-in sprite is **16 × 16 pixels** by default and is drawn in front of everything you painted.

## Making many

Spawn inside a loop and you get a crowd:

```basic id=c07-parade sprites=6
FOR I = 0 TO 5
  S = SPAWN("star",30 + I * 40,60)
NEXT I
```

Each pass makes a new star and puts it in `S`. Only the last one stays in the variable `S`, but all six stay on SCREEN. (To keep every one, store them in a list, in [chapter 9](book:lists).)

A program can have at most **128 living sprites** at once, and a program without a `DO … LOOP` can spawn at most 512 in total. `DESTROY` frees the room.

## What a sprite can do: methods

| Method | What it does |
| --- | --- |
| `S.MOVE x,y` | Jump so the centre is at `x,y`. |
| `S.MOVE_BY dx,dy` | Move by an amount, from where it is now. |
| `S.SIZE w,h` | Change its size (whole pixels, width 1–256, height 1–192). |
| `S.TURN degrees` | Rotate it (360 is a full turn). |
| `S.SHOW` / `S.HIDE` | Make it visible or invisible. |
| `S.SAY "text"` | Show a speech bubble (up to 40 letters). `SAY ""` clears it. |
| `S.DESTROY` | Remove it for good. |
| `S.EXPLODE` | A bang: a short pause, a sound, and everything near it disappears. |

You can also read a sprite's properties: `S.X`, `S.Y`, `S.WIDTH`, `S.HEIGHT`, `S.VISIBLE` and `S.ALIVE`.

```basic id=c07-rocket vars="W=48;ANGLE=45" sprites=1
ROCKET = SPAWN("rocket",128,100)
ROCKET.SIZE 48,48
ROCKET.TURN 45
W = ROCKET.WIDTH
ANGLE = 45
PRINT "The rocket is " + W + " pixels wide"
```

`SIZE` squeezes or stretches the picture to the new size. Rotation turns it around its centre.

### Hide, show, destroy

```basic id=c07-ghost output="true|false|false" sprites=0
G = SPAWN("ghost",128,100)
PRINT G.ALIVE
G.HIDE
PRINT G.VISIBLE
G.SHOW
G.DESTROY
PRINT G.ALIVE
```

A **hidden** sprite still exists, you just cannot see it. A **destroyed** sprite is gone for good. After `DESTROY`, only `ALIVE` can still be asked; any other question or order for that sprite gives the error *This needs a living sprite. Try SPAWN first.*

## Sprites and drawings are separate

`CLS` wipes the drawing but **does not remove sprites**. Press **↺ RESET** (or run your program again) to clear everything, sprites included.

## EXPLODE: build, then break

`EXPLODE` is the dramatic method. It waits a moment, plays an explosion sound, removes every sprite within about 44 pixels (including the one that exploded), and erases drawn shapes within the same distance. Let us build a wall and blow a hole in it:

```basic id=c07-wall px="128,60=8;80,140=10" sprites=0
INK 2
FOR X = 80 TO 160 STEP 16
  FOR Y = 60 TO 140 STEP 16
    BOX X,Y,15,15
  NEXT Y
NEXT X
BOMB = SPAWN("dynamite",128,100)
WAIT 0.4
BOMB.EXPLODE
```

The boxes near the dynamite vanish and the far corners stay. The explosion waits about half a second, so it blocks the next line of the program until it has finished.

## A talking parade

Put the pieces together: a little story with movement and speech.

```basic id=c07-story sprites=2
BORDER 5
CLS 1
WIZ = SPAWN("wizard",30,120)
GH = SPAWN("ghost",226,120)
WIZ.SAY "Hello!"
FOR STEPS = 1 TO 40
  WIZ.MOVE_BY 2,0
  GH.MOVE_BY -2,0
  WAIT 0.03
NEXT STEPS
WIZ.SAY ""
GH.SAY "BOO!"
```

## Try it

1. Make the ghost bigger by 4 times (64 × 64) before it says BOO.
2. Turn a cat around in 10-degree steps with a loop, so it spins.
3. Spawn seven stars and destroy the odd-numbered ones. (You will need a list for this; try it after chapter 9.)

<details>
<summary>Hints and answers</summary>

1. `GH.SIZE 64,64` right after the spawn.
2. `FOR A = 0 TO 360 STEP 10` containing `CAT.TURN A` and `WAIT 0.03`.
3. Keep the sprites in a list, then loop over `COUNT(list)` and call `DESTROY` on every second one.

</details>

## What you learned

- `SPAWN("name",x,y)` makes a sprite; keep it in a variable.
- Methods (`MOVE`, `MOVE_BY`, `SIZE`, `TURN`, `SHOW`, `HIDE`, `SAY`, `DESTROY`, `EXPLODE`) tell it what to do; properties (`X`, `Y`, `WIDTH`, `HEIGHT`, `VISIBLE`, `ALIVE`) tell you its state.
- Sprites are separate from the drawing; RESET clears both.

Next: [motion and animation](book:motion).
