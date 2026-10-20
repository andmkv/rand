---
summary: Keep many values or many sprites together in a LIST, and visit them one by one with COUNT, ITEM and PUSH.
---

# Lists: many things at once

**Goal:** keep a whole crowd of values (colours, scores, sprites) under one name, and treat them all in a loop.

## The problem

You can make six ghosts with six variables: `G1`, `G2`, `G3`… but what about sixty? And how would a loop pick "ghost number I"? A **list** solves this: one variable that holds many values in order.

## Making and reading a list

```basic id=c09-basics output="3|2|4|5"
COLORS = LIST(2,4,6)
PRINT COUNT(COLORS)
PRINT ITEM(COLORS,1)
PUSH COLORS,5
PRINT COUNT(COLORS)
PRINT ITEM(COLORS,4)
```

- `LIST(2,4,6)` makes a list holding three values. `LIST()` makes an empty one.
- `COUNT(list)` gives the number of items.
- `ITEM(list,n)` gives the item in position *n*.
- `PUSH list,value` adds a value to the end. It is a command, not a function, so it has no brackets.

> [!WARNING]
> Positions start at **1**, not 0. The first item is `ITEM(list,1)` and the last is `ITEM(list,COUNT(list))`. Asking for item 0 or one past the end gives the error *That item is outside the list.*

A list can hold numbers, strings, `TRUE`/`FALSE` and sprites, and the same list can mix them. A list **cannot hold another list**, and it can hold at most **128 items**. There is no command to remove an item; to start again, make a new list.

## Visiting every item

Combine `COUNT` with a `FOR` loop and you can process any list, whatever its length:

```basic id=c09-rainbow px="30,40=10;30,60=14;30,84=12"
COLORS = LIST(2,6,4,5,1,3)
FOR I = 1 TO COUNT(COLORS)
  INK ITEM(COLORS,I)
  FILLBOX 20,10 + I * 24,216,20
NEXT I
```

Add a seventh colour to the list and the picture grows a seventh stripe, with no other change.

## Lists of sprites

The real power is a list of sprites. Create them in a loop, and push each one:

```basic id=c09-ghosts sprites=5 output="1|2|3|4|5"
GHOSTS = LIST()
FOR I = 1 TO 5
  G = SPAWN("ghost",30 + I * 40,100)
  PUSH GHOSTS,G
NEXT I
FOR I = 1 TO COUNT(GHOSTS)
  G = ITEM(GHOSTS,I)
  G.MOVE_BY 0,-20
  G.SAY I
  PRINT I
NEXT I
```

`ITEM(GHOSTS,I)` gives back the actual sprite, so you can call its methods or read its properties exactly as before. The list does not store *copies*; it stores references to the same ghosts that are on SCREEN.

The same goes for lists themselves: `B = A` does not copy a list, it gives the same list a second name.

## A wave of ghosts

Put a list, a loop and `SIN` together:

```basic id=c09-wave endless wait=4 vars="T>0"
GHOSTS = LIST()
FOR I = 1 TO 8
  PUSH GHOSTS,SPAWN("ghost",20 + I * 28,100)
NEXT I
T = 0
DO
  T = T + 0.1
  FOR I = 1 TO COUNT(GHOSTS)
    G = ITEM(GHOSTS,I)
    G.MOVE 20 + I * 28,100 + SIN(T + I * 0.7) * 30
  NEXT I
  FRAME
LOOP
```

Note that `SPAWN(...)` can be written right inside `PUSH`. The result of a function is a value like any other.

## Lists of words, lists of positions

Lists are also good for data tables. A list of messages, chosen at random:

```basic id=c09-words vars="N>=1;N<=4"
MESSAGES = LIST("Hello!","Be brave","Try again","Well done")
N = RND(1,COUNT(MESSAGES))
PRINT ITEM(MESSAGES,N)
```

Use `RND(1,COUNT(list))` whenever you need a random item.

## Try it

1. Add `"orange"` as a new colour name in a list of 5 colour words, and print them all in order with a loop.
2. Make a row of 10 stars and make the one in the middle bigger.
3. Spawn 20 slimes in a list, then `DESTROY` only the ones whose position in the list is even. (Hint: the halve-and-round trick from chapter 6.)

<details>
<summary>Hints and answers</summary>

1. `NAMES = LIST("red","green","blue")`, `PUSH NAMES,"orange"`, then `FOR I = 1 TO COUNT(NAMES)` with `PRINT ITEM(NAMES,I)`.
2. Positions 5 and 6 are the middle of ten. `ITEM(STARS,5).SIZE` does not work (a method needs a variable), so first store it: `S = ITEM(STARS,5)` and then `S.SIZE 32,32`.
3. `IF I / 2 = ROUND(I / 2) THEN` followed by `S = ITEM(SLIMES,I)` and `S.DESTROY`. Destroyed sprites stay in the list; asking one for its `ALIVE` gives `false`.

</details>

## What you learned

- `LIST(...)`, `COUNT`, `ITEM` and `PUSH` make and use lists. Counting starts at 1.
- Lists hold up to 128 flat values, including sprites, and are shared, not copied.
- `FOR I = 1 TO COUNT(list)` visits every item.

Next: [sound](book:sound).
