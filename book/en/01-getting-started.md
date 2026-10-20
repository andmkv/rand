---
summary: Meet SCREEN and CODE, run your first program, and learn how Story, Sandbox, Examples and the Spellbook fit together.
---

# Getting started

**Goal of this chapter:** run a program, change it, and know where everything lives. You do not need an account, and you cannot break anything: your code is only text, and you can always press STOP.

## What Randomize USR is

Randomize USR is a small computer that lives in your browser. It is inspired by the home computers of the 1980s, such as the ZX Spectrum, but it is made for learning today. You write short programs in a BASIC-like language, and the machine draws pictures, moves sprites and plays sounds.

You will see two main places:

- **SCREEN** is the picture. It is exactly **256 pixels wide and 192 pixels tall**, drawn with chunky square pixels and a Spectrum-style palette of 16 colours.
- **CODE** is where you type your program.

Between them are the three program buttons:

| Button | What it does |
| --- | --- |
| **▶ RUN** | Starts your program from the top. You can also press `Ctrl + Enter` (`⌘ + Enter` on a Mac) while the cursor is in CODE. |
| **■ STOP** | Ends the program right now, even if it was waiting, playing a sound or looping forever. Your code stays. |
| **↺ RESET** | Clears SCREEN back to an empty picture and stops everything. |

> [!TIP]
> STOP always works. If a program does something surprising, press STOP, change one thing, and press RUN again. Experimenting is how programmers learn.

## Your first program

Open the editor (from the home page choose **Open sandbox**), select everything in CODE, and type this:

```basic id=c01-hello events=TEXT
CLS
INK 6
TEXT 60,90,"HELLO, WORLD"
```

Press **▶ RUN**. Yellow letters appear in the middle of SCREEN. Here is what each line did:

1. `CLS` cleared SCREEN, so every run starts from a clean picture.
2. `INK 6` chose colour number 6 (yellow) for the next thing we draw.
3. `TEXT 60,90,"HELLO, WORLD"` wrote the words with their top-left corner 60 pixels from the left edge and 90 pixels from the top.

A line of code is called a **statement**, and the machine runs the statements one after another, from top to bottom. The first word of a line is a **command**: it tells the machine what to do. The numbers after it are the **arguments**, separated by commas.

### Change it

Change `60` to `10` and run again. The words slide left. Change `"HELLO, WORLD"` to your name. Words in quotation marks are called **strings** and they can contain any letters, including other alphabets.

## Story and Sandbox

The editor has two modes, shown as two buttons at the top: **STORY** and **SANDBOX**.

- **STORY** is a short guided adventure, *The Tower With No Stairs*. It has nine chapters. Each chapter tells a little story, gives you a small task, and moves on when your program does what the chapter asked. A hint and a starter are always available if you get stuck, and the story remembers your code for each chapter.
- **SANDBOX** is an empty workshop. There are no goals, only your ideas. Everything in this handbook works in either mode, but the examples here are designed for Sandbox.

You can switch between the two at any time. This handbook's **Open in Sandbox** buttons always open Sandbox.

## The three drawers

On the side of the editor are three tabs that slide open:

- **SPELLBOOK** is a quick lookup of every command, with a short explanation and an example you can insert into your code. In this handbook, the long form of the same information is the [reference](book:ref-language). (Commands are called *spells* inside the app, because it is a magic world.)
- **EXAMPLES** are ready-made programs, from small toys to playable games. Load one, run it, then change it.
- **INVENTORY** shows everything you can bring into your world: the built-in sprites and sounds, and (for people with an account) your own. [Chapter 7](book:sprites) and the chapters on the [pixel editor](book:pixel-editor) and [Sound Lab](book:sound-lab) explain it.

## Your work is saved for you

While you type, the editor saves your project **in this browser**. The status next to the title says *Autosaved in this browser*. You do not need an account for this, and it keeps working without a network connection.

Two things to remember:

- That copy lives in *this* browser on *this* device. If you clear your browser data or switch computers, it is not there. To keep a safe copy, use the **Project** menu and choose **Save file**. You get a `.randusr` file you can open again later with **Open file**. [Chapter 17](book:saving-and-sharing) covers this in detail.
- An account adds cloud projects and sharing. It is optional.

## How to read the rest of this book

Each chapter has the same shape: a goal, a program you can run, an explanation, and exercises. Every BASIC program in this handbook is run automatically against the real engine each time the book is updated, so if it does not work for you, something is different on your side, and the [troubleshooting page](book:troubleshooting) will help.

Under every complete program you will find two buttons:

- **Copy** puts the code on your clipboard.
- **Open in Sandbox** opens the editor with that program. If you have your own code in the editor, the handbook asks before replacing it and lets you save your current project to a file first.

> [!NOTE]
> Some code blocks are labelled *Part of a program*. They show one idea inside a larger program, so they have no **Open in Sandbox** button.

## Try it

1. Add the line `BORDER 2` at the top of your first program. What changes?
2. Replace `INK 6` with `INK 3`. Which colour do you get?
3. Add a second `TEXT` line lower down, for example at `60,120`.

<details>
<summary>Hints and answers</summary>

1. The coloured frame around SCREEN turns red. `BORDER` does not draw inside the 256 × 192 picture; it colours the edge.
2. Colour 3 is magenta (purple-pink). The full list of colours is in the next chapter.
3. Use the same `x` (60) and a larger `y`. A bigger `y` means lower on the screen, because the top edge is 0.

</details>

## What you learned

- SCREEN is 256 × 192 pixels; CODE holds your program.
- RUN starts, STOP ends, RESET clears.
- A program is a list of statements, run from top to bottom.
- Story is guided, Sandbox is free, and your work is saved automatically in this browser.

Next: [your first picture](book:first-picture).
