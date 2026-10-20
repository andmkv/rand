---
summary: LIST, ITEM, COUNT, PUSH and SET — creating, reading, growing and changing lists, and their limits.
---

# Reference: lists

A **list** is an ordered row of values. Lists are values like any other: store them in a variable, pass them around, compare them.

## Rules

- Items are numbered from **1**.
- A list holds up to **128** items. Pushing the 129th is the `limit` error.
- Items can be numbers, strings, booleans and sprites, mixed freely. A list cannot contain another list (`list` error).
- Lists are **shared, not copied**: after `B = A`, both names are the same list, and `PUSH B,1` or `SET B,1,5` changes what `A` sees.
- `SET` replaces an item that is already there. There is no command to remove or insert items. Make a new list instead.
- A list used where a number is expected is the `number` error; a non-list given to `ITEM`, `COUNT`, `PUSH` or `SET` is the `list` error.

## Functions and commands

### `LIST` {#fn-list}

**Syntax:** `LIST(value, value, …)` → a list. `LIST()` is empty.

Builds a list from its arguments, which are worked out first. At most 128 arguments; none may be a list.

### `ITEM` {#fn-item}

**Syntax:** `ITEM(list, index)` → the value at that position.

`index` must be a whole number from 1 to `COUNT(list)`; otherwise the `index` error ("That item is outside the list").

### `COUNT` {#fn-count}

**Syntax:** `COUNT(list)` → the number of items.

### `PUSH` {#cmd-push}

**Syntax:** `PUSH list, value` · a command, not a function.

Adds `value` to the end of the list. The value may be any non-list value, including a freshly made sprite: `PUSH ENEMIES,SPAWN("slime",20,20)`.

### `SET` {#cmd-set}

**Syntax:** `SET list, index, value` · a command, not a function.

Puts `value` into the item at position `index`, in place of what was there. `index` must be a whole number from 1 to `COUNT(list)`: `SET` changes an item, it never makes the list longer, so use `PUSH` for that (otherwise the `index` error). The value may be any non-list value; a list inside a list is the `list` error. The list is changed itself, so every name that holds it sees the change.

```basic id=r-set output="0|50|3"
SCORES = LIST(0,0,0)
PRINT ITEM(SCORES,1)
SET SCORES,2,50
PRINT ITEM(SCORES,2)
PRINT COUNT(SCORES)
```

Together, `SET` and `ITEM` behave like the "arrays" of other BASICs: a row of numbered boxes you can read and write.

```basic id=r-list output="3|20|30|4|99|b"
NUMBERS = LIST(10,20,30)
PRINT COUNT(NUMBERS)
PRINT ITEM(NUMBERS,2)
ALIAS = NUMBERS
PUSH ALIAS,99
PRINT ITEM(NUMBERS,3)
PRINT COUNT(NUMBERS)
PRINT ITEM(NUMBERS,4)
WORDS = LIST("a","b")
PRINT ITEM(WORDS,2)
```

The program prints the count (3), the second item (20), then pushes 99 through the alias `ALIAS` and prints the third item (30), the new count (4), the fourth item (99), and finally a word from another list.
