---
summary: SPAWN and HIT, the nine sprite methods and the six sprite properties, with sizes, limits and lifetimes.
---

# Reference: sprites

A **sprite** is a movable picture object. You get one from [`SPAWN`](#fn-spawn), keep it in a variable, give it orders with **methods** (`NAME.METHOD arguments`) and ask about it with **properties** (`NAME.PROPERTY`).

## Facts that apply to every sprite

- Its **position** `x,y` is its **centre**. Sprites start at **16 × 16** pixels and are drawn above the drawing layer, in the order they were created (a newer sprite covers an older one).
- Built-in sprite pictures are 8 × 8 art, shown at 16 × 16. [`SIZE`](#method-size) stretches them. Custom sprites (names starting with `@`) are drawn at their own pixel size until `SIZE` is called, but their `WIDTH` and `HEIGHT` properties, and `HIT`, still use 16 until `SIZE` is called.
- A sprite is **alive** from `SPAWN` until `DESTROY` or an `EXPLODE` that reaches it. Sending a method to a destroyed sprite, or reading any property but `ALIVE`, gives the `object` error ("This needs a living sprite").
- Using a method on something that is not a sprite (a number, a text) also gives the `object` error.
- At most **128 sprites** may be alive at once; a program with no `DO … LOOP` may also create at most **512** in total. Either limit gives the `limit` error.
- `CLS` does not remove sprites. RESET, or the start of a run, does.
- Method calls are statements: `CAT.MOVE 10,20`. Properties are values: `X = CAT.X`.

## Functions

### `SPAWN` {#fn-spawn}

**Syntax:** `variable = SPAWN(name, x, y)` · a function that gives back a sprite.

Creates a visible sprite at `x,y`. `name` is the id of a built-in sprite (see [assets](book:ref-assets); not case-sensitive) or the `@alias` of a sprite saved in the project. An unknown name is the `sprite` error, which lists the valid ones. `x` and `y` must be within ±10,000.

```basic id=r-spawn sprites=1 events=SPAWN:cat
CAT = SPAWN("cat",128,100)
```

### `HIT` {#fn-hit}

**Syntax:** `HIT(a, b)` → `TRUE` or `FALSE`

`TRUE` when two sprites overlap. Both must be alive and **visible**. Each sprite counts as a rectangle of its `WIDTH` × `HEIGHT` centred on its position; the rectangles overlap when the horizontal distance between the centres is less than half the sum of the widths **and** the vertical distance is less than half the sum of the heights. Sprites that merely touch edges do not overlap. Giving anything but sprites is the `object` error.

```basic id=r-hit output="true|false"
A = SPAWN("cat",50,50)
B = SPAWN("star",60,55)
PRINT HIT(A,B)
B.HIDE
PRINT HIT(A,B)
```

## Methods

### `.SIZE` {#method-size}

**Syntax:** `sprite.SIZE width,height` · whole numbers; width 1–256, height 1–192 (else `range`).

Changes the drawn size and the hit box. Rotation and movement keep working.

```basic id=r-size vars="W=40;H=10"
BAR = SPAWN("paddle",128,170)
BAR.SIZE 40,10
W = BAR.WIDTH
H = BAR.HEIGHT
```

### `.MOVE` {#method-move}

**Syntax:** `sprite.MOVE x,y`

Places the centre at `x,y`. Coordinates beyond ±10,000 give `range`. There is no screen limit: a sprite can be moved off SCREEN and brought back.

### `.MOVE_BY` {#method-move-by}

**Syntax:** `sprite.MOVE_BY dx,dy`

Moves the sprite by that amount from where it is: `dx` to the right, `dy` downwards (negative values go left and up).

```basic id=r-move vars="PX=70;PY=50"
S = SPAWN("star",10,20)
S.MOVE 50,30
S.MOVE_BY 20,20
PX = S.X
PY = S.Y
```

### `.TURN` {#method-turn}

**Syntax:** `sprite.TURN degrees`

Sets the rotation in degrees (clockwise, around the centre). The value is taken modulo 360, and is absolute, not additional: `TURN 90` twice is still 90.

```basic id=r-turn sprites=1
R = SPAWN("rocket",128,100)
R.TURN 90
```

### `.SHOW` {#method-show}

**Syntax:** `sprite.SHOW` · makes a hidden sprite visible again. No effect on a visible one.

### `.HIDE` {#method-hide}

**Syntax:** `sprite.HIDE` · hides the sprite. It stays alive: it keeps its position, can still be moved and asked questions, but is not drawn and `HIT` ignores it.

```basic id=r-hide output="false|true"
G = SPAWN("ghost",100,100)
G.HIDE
PRINT G.VISIBLE
G.SHOW
PRINT G.VISIBLE
```

### `.DESTROY` {#method-destroy}

**Syntax:** `sprite.DESTROY`

Removes the sprite for good. Afterwards only `.ALIVE` can be read; it is `FALSE`.

### `.SAY` {#method-say}

**Syntax:** `sprite.SAY text`

Shows a speech bubble above the sprite with the first **40** characters of `text`. An empty string `""` clears it. It stays until you change it.

### `.EXPLODE` {#method-explode}

**Syntax:** `sprite.EXPLODE` · **Blocking** for about half a second.

A dramatic bang: the sprite shows `!`, waits 0.2 seconds, plays the explosion sound, and then **destroys every sprite within 44 pixels** of it (itself included) and erases the drawn shapes and pixels within the same distance. Sparks fly for a few more frames. Counts as one sound event.

```basic id=r-explode sprites=0 px="100,100=8"
INK 2
FILLBOX 90,90,20,20
B = SPAWN("dynamite",100,100)
B.EXPLODE
```

## Properties

Read them anywhere a value is allowed: `IF CAT.X > 200 THEN`.

### `.X` `.Y` {#prop-x}

The current centre position (numbers). `X` is 0 at the left, `Y` is 0 at the top.

### `.VISIBLE` {#prop-visible}

`TRUE` unless the sprite was hidden.

### `.WIDTH` `.HEIGHT` {#prop-size}

The size used for hit tests: 16 until `SIZE` is called. For custom sprites, these start at 16 too (see the facts above).

### `.ALIVE` {#prop-alive}

`TRUE` until the sprite is destroyed. The only property that can still be read on a destroyed sprite.

```basic id=r-props output="12|20|true|true"
S = SPAWN("slime",12,20)
PRINT S.X
PRINT S.Y
PRINT S.VISIBLE
PRINT S.ALIVE
```
