---
summary: Learn the coordinates of SCREEN, the 16 colours, and the commands CLS, INK, PAPER, BORDER, BRIGHT, PLOT and LINE.
---

# Your first picture

**Goal:** put exactly the pixel you want exactly where you want it, in the colour you want.

## Where is a pixel?

Every pixel on SCREEN has two numbers, an **x** and a **y**.

- **x** counts across, starting at **0** on the left edge and ending at **255** on the right edge.
- **y** counts down, starting at **0** at the *top* edge and ending at **191** at the bottom edge.

This is different from the graphs you may know from maths class, where y counts *up*. On a computer screen, y counts down. So the point `0,0` is the top-left corner, `255,0` is the top-right corner, and `255,191` is the bottom-right corner. The centre is about `128,96`.

```text
 (0,0) ──────────────► x  (255,0)
   │
   │          (128,96)
   ▼
   y
 (0,191)                  (255,191)
```

## PLOT: one pixel

`PLOT x,y` lights one pixel with the current **ink** colour.

```basic id=c02-dot px="128,96=14;0,0=8"
INK 6
PLOT 128,96
```

A single pixel is tiny. Look closely at the middle of SCREEN, or hold the page nearer your face. Everything else on SCREEN is just many pixels, so this humble command is the root of every picture.

Now draw the four corners:

```basic id=c02-corners px="0,0=15;255,0=15;0,191=15;255,191=15"
PLOT 0,0
PLOT 255,0
PLOT 0,191
PLOT 255,191
```

The default ink is white, so these are four white dots in the corners. If you try `PLOT 256,0` nothing appears, because x = 256 is outside SCREEN. The machine does not complain about points off the edge; it just does not draw them. (The numbers do have to be sane, though: coordinates beyond ±10000 are an error.)

## INK: choosing a colour

`INK n` chooses the colour used by everything you draw *after* it, until you change it again. The colours are numbered 0 to 7:

| n | Colour |
| --- | --- |
| 0 | black |
| 1 | blue |
| 2 | red |
| 3 | magenta |
| 4 | green |
| 5 | cyan |
| 6 | yellow |
| 7 | white |

Any other number is an error, so `INK 8` will not work. Whole numbers only: `INK 2.5` is also an error.

## LINE: from here to there

`LINE x1,y1,x2,y2` draws a straight line from one point to another, including both ends.

```basic id=c02-line px="0,0=10;255,191=10;0,191=14;255,0=14"
INK 2
LINE 0,0,255,191
INK 6
LINE 0,191,255,0
```

You get a big red-and-yellow cross. Notice that you told the machine only the two *ends*; it worked out all the pixels in between.

## BRIGHT: two shades of every colour

Every colour comes in a **normal** and a **bright** shade, like on the old computers. `BRIGHT 1` is the default and gives vivid colours. `BRIGHT 0` gives softer, darker ones. Here are all sixteen:

```basic id=c02-palette px="20,40=0;50,40=1;170,40=13;220,40=15"
CLS
BRIGHT 0
INK 0
LINE 20,40,20,150
INK 1
LINE 50,40,50,150
INK 2
LINE 80,40,80,150
INK 3
LINE 110,40,110,150
BRIGHT 1
INK 4
LINE 140,40,140,150
INK 5
LINE 170,40,170,150
INK 6
LINE 200,40,200,150
INK 7
LINE 220,40,220,150
```

> [!NOTE]
> `BRIGHT` is remembered by the machine, just like `INK`. It affects the colours you pick *after* it. The picture also uses the current `BRIGHT` for its background: change `BRIGHT` after drawing and the empty background changes shade too.

## PAPER, CLS and BORDER

- `PAPER n` chooses the background colour for empty space (colours 0 to 7).
- `CLS` clears everything you have drawn so far. `CLS n` clears **and** sets the paper to colour *n* in one step.
- `BORDER n` colours the frame around SCREEN. It is outside the 256 × 192 picture, so you cannot draw on it.

```basic id=c02-sky px="10,10=9;128,96=14"
BORDER 2
PAPER 1
CLS
INK 6
PLOT 128,96
```

Run this and you get a deep blue night with one yellow star-dot in the middle.

Why start programs with `CLS`? When you press RUN, the machine already starts from an empty picture, so `CLS` is not needed at the top. But as soon as your program draws, waits and then wants to start a new scene, `CLS` is how you wipe the old one.

## A bigger picture: a starry sky

Put it together. A sky, some stars at hand-picked places, and a moon made of lines. Do not worry about how long it is: it is the same few commands, repeated.

```basic id=c02-night px="10,10=9;40,30=15;200,20=14"
BORDER 1
PAPER 1
CLS
INK 7
PLOT 40,30
PLOT 90,60
PLOT 150,25
PLOT 220,70
PLOT 70,110
INK 6
PLOT 200,20
PLOT 201,20
PLOT 200,21
PLOT 201,21
INK 5
LINE 0,170,255,170
INK 4
LINE 0,175,255,175
```

Typing so many `PLOT` lines is slow. In [chapter 5](book:loops) you will meet loops, which draw hundreds of stars with a few lines.

## Try it

1. Draw a red box outline (four lines) around the edge of SCREEN, from `0,0` to `255,191`.
2. Draw the letter **X** across SCREEN in two colours.
3. Make a rainbow: eight horizontal lines, one for each INK colour, one under the other.

<details>
<summary>Hints and answers</summary>

1. The four corners are `0,0`, `255,0`, `255,191` and `0,191`. Join them in order with four `LINE` statements. (There is also a one-line way, `BOX`, in the next chapter.)
2. Two diagonal lines: `0,0` to `255,191` and `255,0` to `0,191`, with an `INK` between them.
3. Use `LINE 0,20,255,20`, then `INK 2`, then `LINE 0,30,255,30`, and so on, adding 10 to y each time.

</details>

## What you learned

- x runs 0–255 left to right; y runs 0–191 top to bottom.
- `PLOT` draws a pixel; `LINE` draws a line between two points.
- `INK`, `PAPER`, `BORDER` take a colour from 0 to 7; `BRIGHT 0` or `BRIGHT 1` picks the shade.
- `CLS` wipes the picture, and `CLS n` also paints the paper.

Next: [shapes and text](book:shapes-and-text).
