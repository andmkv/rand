---
summary: Every drawing command — CLS, INK, PAPER, BORDER, BRIGHT, PLOT, LINE, BOX, FILLBOX, CIRCLE, FILLCIRCLE, TEXT — with parameters, ranges and examples.
---

# Reference: drawing

## SCREEN and the drawing layer

- SCREEN is **256 × 192** pixels, drawn with nearest-neighbour scaling, so pixels stay square and sharp at any size.
- The origin `0,0` is the **top-left** pixel. `x` grows to the right (0 to 255), `y` grows downwards (0 to 191).
- Coordinates may be decimals; they are **rounded** to the nearest pixel. Anything outside SCREEN is clipped (not drawn). A coordinate beyond ±10,000 is an error (`range`).
- Drawing commands paint a **drawing layer**. Later paint covers earlier paint. **Sprites** are painted above that layer, then speech bubbles, then explosion sparks. `CLS` clears only the drawing layer.
- The machine keeps a record of the most recent **512** shapes, which `EXPLODE` uses to decide what to erase. Pixels that were painted stay on SCREEN regardless, and `EXPLODE` clears every pixel within its blast radius.
- Every drawing command is given whole numbers or decimals; strings are not allowed for coordinates (error `number`).

### The palette

The sixteen colours are the classic Spectrum set. `INK`, `PAPER` and `BORDER` take a colour number `0`–`7`; `BRIGHT` chooses the shade.

| n | Colour | `BRIGHT 0` | `BRIGHT 1` |
| --- | --- | --- | --- |
| 0 | black | `#000000` | `#000000` |
| 1 | blue | `#0000BF` | `#0000FF` |
| 2 | red | `#BF0000` | `#FF0000` |
| 3 | magenta | `#BF00BF` | `#FF00FF` |
| 4 | green | `#00BF00` | `#00FF00` |
| 5 | cyan | `#00BFBF` | `#00FFFF` |
| 6 | yellow | `#BFBF00` | `#FFFF00` |
| 7 | white | `#BFBFBF` | `#FFFFFF` |

Each shape takes its colour at the moment it is drawn, using the `INK` and `BRIGHT` in force then. Empty background is painted with the current `PAPER` and `BRIGHT`. At the start of every RUN the machine resets to `INK 7`, `PAPER 0`, `BORDER 1`, `BRIGHT 1`.

### Timing of drawing

Without `FRAME` anywhere in the program, the machine lets the browser draw after every 8 drawing commands (or sooner for very large shapes), so a long drawing visibly builds up. If the program contains `FRAME`, drawing is not sliced, and `FRAME` marks the end of a picture. See [`FRAME`](book:ref-time-input#cmd-frame).

## Colour and screen commands

### `CLS` {#cmd-cls}

**Syntax:** `CLS [colour]`

Clears the drawing layer (everything drawn by the other drawing commands). With a colour `0`–`7`, also sets `PAPER` to it. Sprites are not touched. Not blocking.

```basic id=r-cls px="10,10=13;100,100=13"
INK 2
FILLBOX 90,90,20,20
CLS 5
```

### `INK` {#cmd-ink}

**Syntax:** `INK colour` · colour is a whole number `0`–`7`.

Chooses the colour of everything drawn after it, including `TEXT`. Other values give the `range` error.

```basic id=r-ink px="50,50=9;60,50=12"
INK 1
PLOT 50,50
INK 4
PLOT 60,50
```

### `PAPER` {#cmd-paper}

**Syntax:** `PAPER colour` · `0`–`7`.

Sets the background colour behind your drawing. It changes the whole empty background at once.

```basic id=r-paper px="5,5=10;100,100=15"
PAPER 2
INK 7
PLOT 100,100
```

### `BORDER` {#cmd-border}

**Syntax:** `BORDER colour` · `0`–`7`.

Sets the colour of the frame around SCREEN. The border is outside the 256 × 192 picture.

```basic id=r-border events=BORDER
BORDER 4
```

### `BRIGHT` {#cmd-bright}

**Syntax:** `BRIGHT 0` or `BRIGHT 1`

Chooses the shade (see the palette). Only `0` and `1` are allowed.

```basic id=r-bright px="10,10=2;20,10=10"
BRIGHT 0
INK 2
PLOT 10,10
BRIGHT 1
PLOT 20,10
```

## Shapes

### `PLOT` {#cmd-plot}

**Syntax:** `PLOT x,y`

Lights a single pixel in the current ink.

```basic id=r-plot px="128,96=15"
PLOT 128,96
```

### `LINE` {#cmd-line}

**Syntax:** `LINE x1,y1,x2,y2`

Draws a straight line, one pixel thick, between two points, including both ends. Lines go in any direction.

```basic id=r-line px="10,10=15;100,50=15;60,30=15"
LINE 10,10,100,50
PLOT 60,30
```

### `BOX` {#cmd-box}

**Syntax:** `BOX x,y,width,height`

The outline of a rectangle one pixel thick. `x,y` is the top-left corner; the box covers `width` × `height` pixels, so the right edge is at `x + width - 1`. Width and height must not be negative (`range` otherwise).

```basic id=r-box px="20,20=15;49,39=15;30,30=8"
BOX 20,20,30,20
```

### `FILLBOX` {#cmd-fillbox}

**Syntax:** `FILLBOX x,y,width,height`

A solid rectangle with the same corner rules as `BOX`.

```basic id=r-fillbox px="20,20=12;49,39=12;50,40=8"
INK 4
FILLBOX 20,20,30,20
```

### `CIRCLE` {#cmd-circle}

**Syntax:** `CIRCLE x,y,radius`

A circle outline, about one pixel thick, with its **centre** at `x,y`. The radius must not be negative.

```basic id=r-circle px="158,96=15;128,66=15;128,96=8"
CIRCLE 128,96,30
```

### `FILLCIRCLE` {#cmd-fillcircle}

**Syntax:** `FILLCIRCLE x,y,radius`

A solid disc with its centre at `x,y`. Large circles cost more drawing time than small shapes, so the machine pauses to draw after one.

```basic id=r-fillcircle px="128,96=9;158,96=9;160,96=8"
INK 1
FILLCIRCLE 128,96,30
```

### `TEXT` {#cmd-text}

**Syntax:** `TEXT x,y,value`

Writes text in the pixel font. `x,y` is the top-left corner of the first letter's box. The third value is turned into text if it is not already (so `TEXT 10,10,SCORE` works), and at most **120 characters** are drawn.

Letter shapes are proportional: most Latin letters are 4–10 pixels wide; wide characters (such as Japanese) are 16. The letter box is 18 pixels tall; capital letters occupy rows 3–12 of it. The font covers Latin with accents, Cyrillic, Greek and many Japanese characters; an unavailable character shows as a small crossed box. Text is not wrapped: anything beyond the right edge is clipped.

```basic id=r-text events=TEXT
INK 6
TEXT 20,20,"Hello, мир!"
TEXT 20,50,12345
```
