---
summary: Draw your own sprites and animations in the pixel editor, give them names, and use them in BASIC with SPAWN("@name").
---

# The pixel editor: your own sprites

**Goal:** draw a character, make it walk, and put it into a program.

## Who can use it

Drawing and saving your own sprites needs a **registered account** (or a **Demo** session, which behaves like one for an hour). That is because saved sprites live in your private library in the cloud.

Everyone, including guests, can *use* custom sprites that come with a project. This handbook ships a small sample bundle called **workshop**: a walking robot `@buddy`, a blue gem `@gem`, and two sounds. The examples below load it automatically when you press **Open in Sandbox**, so you can try everything in this chapter right now, without an account.

## Using a custom sprite in BASIC

Custom sprites are called by a name that starts with `@`. You use it exactly like a built-in sprite:

```basic id=c15-meet assets=workshop sprites=2 output="true"
BUDDY = SPAWN("@buddy",40,110)
BUDDY.SIZE 32,32
GEM = SPAWN("@gem",200,110)
GEM.SIZE 16,16
FOR X = 40 TO 190 STEP 2
  BUDDY.MOVE X,110
  FRAME
NEXT X
GEM.SAY "Got it!"
PRINT HIT(BUDDY,GEM)
```

Run it (with **Open in Sandbox**, which brings the pictures along). The robot walks to the gem, and its legs move as it goes. You did not write any animation code: `@buddy` is an *animated sprite* with four frames, and the machine plays them automatically.

Everything from the sprite chapter works: `MOVE`, `MOVE_BY`, `SIZE`, `TURN`, `SHOW`, `HIDE`, `SAY`, `DESTROY`, `HIT`. Your sprite is just another object.

> [!WARNING]
> **Call `SIZE` on your sprites if you use `HIT`.** A custom sprite is drawn at its own size (here 16 × 16 for the robot, 8 × 8 for the gem), but its `WIDTH` and `HEIGHT` start at 16 until you call `SIZE`. `HIT` measures those numbers. In the program above, both sprites get an explicit `SIZE`, so the picture and the hit box agree.

### A small game with your own art

```basic id=c15-gems assets=workshop endless wait=6 keys=RIGHT vars="SCORE>=0;PX>=16"
BUDDY = SPAWN("@buddy",128,160)
BUDDY.SIZE 32,32
GEM = SPAWN("@gem",RND(16,240),0)
GEM.SIZE 16,16
SCORE = 0
DO
  IF KEY("LEFT") AND BUDDY.X > 16 THEN
    BUDDY.MOVE_BY -3,0
  END IF
  IF KEY("RIGHT") AND BUDDY.X < 240 THEN
    BUDDY.MOVE_BY 3,0
  END IF
  GEM.MOVE_BY 0,2
  IF HIT(BUDDY,GEM) THEN
    SCORE = SCORE + 1
    GEM.MOVE RND(16,240),0
    SFX "@zap"
  END IF
  IF GEM.Y > 200 THEN
    GEM.MOVE RND(16,240),0
  END IF
  PX = BUDDY.X
  CLS 0
  INK 6
  TEXT 6,4,"GEMS " + SCORE
  FRAME
LOOP
```

This is *Star Catcher* from [chapter 13](book:your-first-game) with a different cast. Notice `SFX "@zap"`: personal sounds use the same `@` convention, as you will see in the [next chapter](book:sound-lab).

## Drawing your own

1. Sign in. (If the server offers it, you can also open the **Log in** dialog and press **Try Demo**.)
2. Open the **INVENTORY** drawer and press **+ New sprite**. The editor opens full screen.
3. Pick a **size**: 8, 16, 32 or 64 pixels square. Start small! A 16 × 16 sprite is plenty for a character, and it is quicker to draw.
4. Optionally start from a **template** (Cat, Star or Blank).
5. Choose a colour and draw. There are 15 colours (the Spectrum palette, both normal and bright shades) plus **transparent**, which lets the background show through. Transparent is what makes a sprite non-rectangular.
6. Give it a **name** at the top and press **Save sprite**.

### The tools

| Tool | Key | What it does |
| --- | --- | --- |
| Pencil | `B` | Paints a pixel (hold and drag to paint more). |
| Eraser | `E` | Makes a pixel transparent. |
| Colour picker | `I` | Picks the colour of a pixel you click. |
| Fill | `F` | Floods an area with the current colour. |
| Rectangle | `R` | Drags a filled block. |
| Move view | | Pans the canvas when you have zoomed in. |

Flip ↔ and Flip ↕ mirror the whole drawing: draw half a face, flip, done. **Zoom** (`[` and `]`), **Grid** (`G`) and **Fit** (`0`) help you see what you are doing, and **Undo** and **Redo** (`Ctrl/⌘ + Z`, `Ctrl/⌘ + Shift + Z`) go back and forward up to 40 steps. With the keyboard alone you can move a cursor with the arrow keys and paint with `Enter`. **Export PNG** saves a picture file of the sprite with real transparency.

If you change the size after drawing, the editor asks first: a bigger canvas keeps your drawing centred; a smaller one cuts off the edges.

### From the editor into your program

After saving, the sprite appears under **INVENTORY → My assets**. Its code name, the **alias**, is made from the name you typed: lower-case letters, digits, hyphens and underscores, with `@` in front, for example "Robot buddy" becomes `@robot-buddy`. Names that use only other alphabets become `@sprite`, and clashes get a number (`@sprite-2`). The alias is fixed when the sprite is created; renaming the sprite later does not change it, so your programs keep working.

Press **Insert in CODE** to paste a ready-made line at the cursor:

```basic id=c15-snippet fragment
SPRITE = SPAWN("@robot-buddy",80,120)
```

## Animation

A sprite with more than one frame is animated. In the editor:

1. Draw the first frame.
2. Press **+ Animate**. A copy of your drawing becomes frame 2, and a **timeline** of frames appears under the canvas.
3. Change frame 2 slightly (move a leg, blink an eye). Press **Duplicate** for more frames, **Add frame** for an empty one, and drag frames (or use the ← → buttons) to reorder them.
4. Press **Play** to see it moving. Set the speed with **FPS** (1 to 12 frames per second) and turn **Loop** on or off. **Onion skin** shows faint ghosts of the previous and next frame, to help you line things up.
5. Save as usual.

Shortcuts on the timeline: `N` adds a frame, `Shift + N` duplicates, `Delete` removes, `,` and `.` move between frames, `Alt + arrows` reorder, `P` plays, `Shift + P` stops, `O` toggles onion skin and `L` toggles loop. At most 32 frames.

In BASIC, animation is automatic. `SPAWN("@alias",x,y)` starts it from frame 1; a looping animation repeats, and a non-looping one stops on its last frame. The machine only paints while the page is visible. STOP freezes the sprite on its current frame, and RESET removes it. There are no extra animation commands.

> [!TIP]
> Frames do not move the sprite. Moving is still `MOVE` and `MOVE_BY`. A walk cycle is just 4 frames of legs, played while your code slides the sprite across SCREEN.

## Limits

- A sprite is at most 64 × 64 pixels, with 15 colours plus transparent, and at most 32 frames.
- An account keeps up to 64 assets (sprites and sounds together), 100 versions of each, and 5 MiB in total.
- A single project carries up to 16 sprites and 16 sounds.
- Saving always creates a new **version**; old versions are never overwritten. A program is **pinned** to the version it was written with.

## Your sprites travel with your project

When you save a `.randusr` file, share a project or publish it, the pictures and sounds it uses are packed *inside* the project. People who open it do not need an account or access to your library, and they see exactly the pictures you used. Your private library itself is never exposed. See [chapter 17](book:saving-and-sharing).

## Try it

1. In the first program, make the robot walk back to the left as well, using a second `FOR` with `STEP -2`.
2. Turn the robot upside down with `TURN` when it reaches the gem.
3. If you have an account: draw a 16 × 16 coin, give it a 4-frame spin, and replace the gem in the game.

<details>
<summary>Hints and answers</summary>

1. After the first loop add `FOR X = 190 TO 40 STEP -2`, with the same `BUDDY.MOVE X,110` and `FRAME` inside.
2. `BUDDY.TURN 180`. Angles are in degrees and turn the sprite around its centre.
3. A spin is easiest as four frames: full width, narrow, thin line, narrow again. Use the Onion skin to keep the pixels lined up.

</details>

## What you learned

- Custom sprites are used by their `@alias` in `SPAWN`. They behave like built-in sprites.
- Call `SIZE` so that `HIT` agrees with what you see.
- Frames animate automatically; moving is still your job.
- Pictures are packed into the project, so other people can run it.

Next: [the Sound Lab](book:sound-lab).
