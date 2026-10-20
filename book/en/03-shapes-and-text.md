---
summary: Draw boxes, circles and text with BOX, FILLBOX, CIRCLE, FILLCIRCLE and TEXT, and learn how later drawings cover earlier ones.
---

# Shapes and text

**Goal:** draw a whole scene from a handful of shapes, and write words on SCREEN.

## Boxes

`BOX x,y,width,height` draws the *outline* of a rectangle. Its top-left corner is at `x,y`, and it is `width` pixels wide and `height` pixels tall. `FILLBOX` takes the same four numbers but fills the rectangle in solid.

```basic id=c03-boxes px="20,30=15;59,30=15;40,59=15;40,40=8;100,30=10;130,50=10"
BOX 20,30,40,30
INK 2
FILLBOX 100,30,40,30
```

Width and height must not be negative. Because the first rectangle is 40 wide starting at x = 20, its pixels run from x = 20 to x = 59.

## Circles

`CIRCLE x,y,r` draws a circle outline with its **centre** at `x,y` and radius `r`. `FILLCIRCLE` fills it. The radius is measured in pixels and cannot be negative.

```basic id=c03-circles px="90,96=15;60,66=15;60,96=8;190,96=12;190,70=12"
CIRCLE 60,96,30
INK 4
FILLCIRCLE 190,96,30
```

Notice the difference between rectangles and circles: for a rectangle the numbers describe the *corner*, for a circle the *centre*. That is a good thing to double-check whenever a shape lands somewhere you did not expect.

## TEXT: writing on SCREEN

`TEXT x,y,"words"` writes words in the pixel font. The `x,y` is the top-left of the letter box. A line of text is a drawing like any other: it uses the current ink, and later drawings can cover it.

About sizes, so you can plan layouts: the letters in a line are between 4 and 10 pixels wide (narrow letters such as `i` are narrow, wide letters such as `W` are wider), so a line of 256 pixels fits roughly 30 to 36 letters. The visible capital letters are about 10 pixels tall and start 3 pixels below `y`. A single `TEXT` call writes up to 120 characters.

The font includes more than English letters. You can write Russian, Greek, accented letters, and many Japanese characters. If a character is not in the font, you see a small crossed box in its place instead of a wrong letter.

```basic id=c03-text events=TEXT
CLS
INK 7
TEXT 20,40,"Hello!"
INK 5
TEXT 20,70,"Привет!"
INK 6
TEXT 20,100,"こんにちは"
```

To print a **number** with `TEXT`, join it to words using `+`. You will practise that in the next chapter.

## Later drawings cover earlier ones

SCREEN is a flat picture. When two shapes overlap, whichever was drawn *last* wins. That is why drawing order matters: paint the sky first, then the hill, then the house, then the door.

## A little house

Here is a complete scene made only of the commands you know. Read it from top to bottom and picture each step.

```basic id=c03-house px="10,10=13;10,170=12;100,120=10;125,130=9;220,36=14;128,60=15"
CLS 5
BORDER 4
INK 4
FILLBOX 0,150,256,42
INK 2
FILLBOX 90,100,76,50
INK 6
FILLCIRCLE 220,36,18
INK 7
LINE 80,100,128,60
LINE 128,60,176,100
LINE 80,100,176,100
INK 1
FILLBOX 118,120,20,30
INK 7
TEXT 100,166,"HOME"
```

- `CLS 5` paints the whole sky cyan in one go.
- The green grass is a wide `FILLBOX` along the bottom (y from 150 to 191).
- The house walls are red; the sun is a yellow `FILLCIRCLE`.
- The roof is three `LINE` statements joining three corners.
- The blue door is drawn after the wall so it sits on top of it.

> [!TIP]
> Draw the **big background things first** and the **small details last**. If a detail disappears, ask whether something drawn later covered it.

### Layers

SCREEN really has two layers. The bottom layer is the *drawing*: everything made by `PLOT`, `LINE`, `BOX`, `CIRCLE` and `TEXT`. On top are **sprites**, the little characters you meet in [chapter 7](book:sprites). Sprites are always in front of the drawing, no matter which order you wrote them in.

## Try it

1. Add a window to the house: a small `FILLBOX` in white on the wall, with a blue `BOX` around it.
2. Make a second, smaller sun with `CIRCLE` in front of the first one. Does the outline show through? (Remember the order.)
3. Write your name at the bottom of SCREEN, in two different colours: first half in one colour, second half in another.

<details>
<summary>Hints and answers</summary>

1. After the wall: `INK 7` then `FILLBOX 100,110,14,14`; then `INK 1` and `BOX 99,109,16,16`.
2. Yes, an outline circle shows through because it only draws a thin ring. If you used `FILLCIRCLE` in another colour, it would cover the first sun.
3. Use two `TEXT` calls with an `INK` between them. Add the width of the first half (about 7 pixels per letter) to the x of the second.

</details>

## What you learned

- `BOX` and `FILLBOX` take a corner, a width and a height. `CIRCLE` and `FILLCIRCLE` take a centre and a radius.
- `TEXT` writes words, in any alphabet the font has.
- Later drawings cover earlier ones; sprites are always on top of the drawing.

Next: [variables](book:variables).
