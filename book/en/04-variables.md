---
summary: Store numbers and words under names, calculate with them, join text, roll dice with RND and use PRINT to look inside your program.
---

# Variables, numbers and words

**Goal:** give things names so you can reuse and change them, and make the computer calculate for you.

## A variable is a labelled box

A **variable** is a name that holds a value. You create one by writing the name, an equals sign and a value:

```basic id=c04-size px="158,96=15;178,96=15"
SIZE = 30
CIRCLE 128,96,SIZE
SIZE = SIZE + 20
CIRCLE 128,96,SIZE
PRINT SIZE
```

Run it. Two circles appear and a number, **50**, is printed in the text area under SCREEN.

- `SIZE = 30` makes a variable called `SIZE` and puts 30 in it.
- `CIRCLE 128,96,SIZE` uses the variable where a number would go.
- `SIZE = SIZE + 20` means: *take what is in SIZE, add 20, and put the answer back into SIZE.* It is not a puzzle about equality. The `=` here means **store**.
- `PRINT SIZE` writes the value in the text area (see below).

Now change the first line to `SIZE = 10` and run again. Both circles change, because the program uses the variable instead of repeating the number. That is the main reason to use variables: change one place, and everything that depends on it follows.

### Rules for names

- A name starts with a letter or an underscore, and can then contain letters, digits and underscores: `SCORE`, `PLAYER_X`, `LIFE2`.
- Uppercase and lowercase are the same: `score` and `SCORE` are one variable. Any alphabet works: `ИМЯ = "Аня"` is fine.
- Names can be up to 64 characters long.
- Do not use the words of the language itself as names (`IF`, `FOR`, `LOOP`, `TRUE`, and so on).
- A variable must be given a value *before* you read it. Reading a name you never set gives the error *Give SCORE a value first.*
- Every time you press RUN, all variables start empty.

The word `LET` is optional: `LET SIZE = 30` means the same as `SIZE = 30`.

## Four kinds of value

A variable can hold:

| Kind | Examples | Used for |
| --- | --- | --- |
| number | `7`, `3.14`, `-2` | positions, sizes, scores |
| string (text) | `"Mia"`, `"GAME OVER"` | words and messages |
| true/false | `TRUE`, `FALSE` | questions with a yes/no answer |
| sprite or list | see chapters 7 and 9 | characters and collections |

Numbers have no quotation marks; strings always do. `"7"` is a string that looks like a number, and `7` is a number. They behave differently, as you will see below.

## Arithmetic

You can calculate with `+`, `-`, `*` and `/`. As in maths class, multiplication and division happen before addition and subtraction, and brackets go first.

```basic id=c04-math output="14|20|3.5|3|7"
PRINT 2 + 3 * 4
PRINT (2 + 3) * 4
PRINT 7 / 2
PRINT ROUND(2.5)
PRINT ABS(-7)
```

- `/` always gives an exact answer, so `7 / 2` is `3.5`. Dividing by zero is an error: *Dividing by zero does not fit in this world.*
- `ROUND(x)` rounds to the nearest whole number (halves go up: `ROUND(2.5)` is 3).
- `ABS(x)` removes a minus sign: `ABS(-7)` is 7.

There are also `SIN(x)` and `COS(x)`, used for circles and waves. They take angles in **radians**, where a full turn is about 6.283. You will use them in the next chapter.

## Words: strings and joining

The `+` sign also **joins** words. If either side is a string, the other side is turned into text and glued on.

```basic id=c04-words output="Hello, Mia!|Level 3|You have 12 stars"
NAME = "Mia"
PRINT "Hello, " + NAME + "!"
LEVEL = 3
PRINT "Level " + LEVEL
STARS = 5 + 7
PRINT "You have " + STARS + " stars"
```

This is also how you put a number into `TEXT`: `TEXT 10,10,"SCORE " + SCORE`.

Strings cannot contain a quotation mark inside them, and a string must start and end on the same line. A string can be up to 2000 characters long.

> [!WARNING]
> `"2" + "3"` joins the words and gives `"23"`. But `2 + 3` adds the numbers and gives `5`. When a program gives a surprising answer, check whether each value is a number or a string.

## PRINT: look inside

`PRINT value` writes one value as a line in the text area under SCREEN. It is the programmer's flashlight: when you are not sure what a variable holds, print it. `PRINT` takes exactly **one** value; use `+` to combine several things into one string.

## RND: dice and surprises

`RND(low,high)` gives a random whole number from `low` to `high`, *including both ends*. `RANDOM` is another name for the same thing. Both numbers must be whole, and `high` must not be smaller than `low`.

```basic id=c04-random vars="X>=10;X<=20;DIE>=1;DIE<=6"
X = RND(10,20)
DIE = RND(1,6)
PRINT "You rolled " + DIE
```

Every run gives different numbers, which is what makes games feel alive. Use it to pick positions, colours (`INK RND(1,7)`), or delays.

## A picture that uses variables

Here is a tiny design where one variable controls the whole picture. Change `R` and everything resizes together.

```basic id=c04-flower px="128,96=14;128,40=10"
R = 30
CLS 1
INK 2
FILLCIRCLE 128,96 - R,R
FILLCIRCLE 128,96 + R,R
FILLCIRCLE 128 - R,96,R
FILLCIRCLE 128 + R,96,R
INK 6
FILLCIRCLE 128,96,R
```

Look at `128,96 - R,R`. Is that `128`, then `96 - R`, then `R`? Yes: commas separate the three numbers, and the arithmetic lives inside each one. So the top petal is centred at `128, 66`.

## Try it

1. Change `R` in the flower to 15 and then to 40. At which size do the petals leave SCREEN?
2. Make a variable called `GREETING` that holds your favourite word, and print it three times with `PRINT`.
3. Roll two dice with `RND(1,6)` and print their total.

<details>
<summary>Hints and answers</summary>

1. The top petal is at y = 96 − R, with radius R. It leaves the top edge when 96 − 2R is below 0, so at R = 49 and bigger.
2. `GREETING = "Hello"` followed by three lines `PRINT GREETING`.
3. `A = RND(1,6)`, `B = RND(1,6)`, `PRINT A + B`. If you wrote `"Total " + A + B`, you get text joined, not a sum; use `"Total " + (A + B)`.

</details>

## What you learned

- A variable stores a value under a name; `NAME = value` stores, and `NAME` reads.
- `+ - * /` calculate, brackets go first, and `+` also joins text.
- `PRINT` shows one value; `RND(low,high)` rolls a random whole number.

Next: [loops](book:loops).
