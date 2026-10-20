---
summary: RND and RANDOM, SIN, COS, ABS, ROUND, INT, MIN, MAX and MOD — the numeric functions.
---

# Reference: numbers

All of these are functions: they give back a value and must be used inside an expression (`X = ABS(Y)`), not alone on a line. `MOD` can also be written between two numbers, like `+` or `*`.

### `RND` {#fn-rnd}

**Syntax:** `RND(low, high)` → a random whole number from `low` to `high`, **both included**.

Both arguments must be whole numbers with `high >= low`; otherwise the `range` error.

### `RANDOM` {#fn-random}

**Syntax:** `RANDOM(low, high)` · exactly the same as `RND`.

```basic id=r-rnd vars="A>=1;A<=6;B=5"
A = RND(1,6)
B = RANDOM(5,5)
```

Every run gives a different sequence. The machine does not offer a way to choose a seed, so a program cannot repeat the same random run.

### `SIN` {#fn-sin}

**Syntax:** `SIN(angle)` · the angle is in **radians** (a full turn is about 6.2832). Result from −1 to 1.

### `COS` {#fn-cos}

**Syntax:** `COS(angle)` · the same, but the cosine.

To place something at an angle `A` and distance `R` from a centre `(CX,CY)` use `CX + COS(A) * R` and `CY + SIN(A) * R`. With the y-axis pointing down, increasing `A` goes clockwise on SCREEN.

```basic id=r-sincos output="0|1|1|0"
PRINT ROUND(SIN(0))
PRINT ROUND(COS(0))
PRINT ROUND(SIN(3.14159 / 2))
PRINT ROUND(COS(3.14159 / 2))
```

### `ABS` {#fn-abs}

**Syntax:** `ABS(x)` → `x` without its sign.

### `ROUND` {#fn-round}

**Syntax:** `ROUND(x)` → the nearest whole number. A fraction of exactly one half goes up (towards the larger number): `ROUND(2.5)` is 3 and `ROUND(-2.5)` is −2.

```basic id=r-abs-round output="7|3|-2|4"
PRINT ABS(-7)
PRINT ROUND(2.5)
PRINT ROUND(-2.5)
PRINT ROUND(3.6)
```

### `INT` {#fn-int}

**Syntax:** `INT(x)` → the whole number at or below `x`.

The fraction is cut off **downwards**: `INT(3.9)` is 3, and `INT(-0.5)` is −1 (not 0). `ROUND` goes to the *nearest* whole number; `INT` always goes down.

```basic id=r-int output="3|-1|5|4"
PRINT INT(3.9)
PRINT INT(-0.5)
PRINT INT(5)
PRINT INT(RND(40,49) / 10)
```

### `MIN` {#fn-min}

**Syntax:** `MIN(a, b)` → the smaller of the two numbers.

### `MAX` {#fn-max}

**Syntax:** `MAX(a, b)` → the bigger of the two numbers.

Both take exactly two numbers. Together they keep a value inside limits: `X = MAX(10, MIN(X, 246))` never lets `X` go below 10 or above 246.

```basic id=r-min-max output="3|7|-2|246"
PRINT MIN(3,7)
PRINT MAX(3,7)
PRINT MIN(-1,-2)
X = 300
PRINT MAX(10, MIN(X, 246))
```

### `MOD` {#fn-mod}

**Syntax:** `a MOD b` · or `MOD(a, b)` → the remainder after dividing `a` by `b`.

`7 MOD 3` is 1 because 7 is two threes and one left over. The result is never negative when `b` is positive, so `-1 MOD 8` is 7 (this keeps patterns going smoothly across zero). Fractions work too: `5.5 MOD 2` is 1.5. `MOD` by zero is the `zero` error. As an operator it binds like `*` and `/`: `2 + 7 MOD 4 * 2` is 8.

Typical uses: `N MOD 2 = 0` asks "is `N` even?", and `FRAME_NUMBER MOD 10 = 0` is true "every 10th time".

```basic id=r-mod output="1|1|7|true|8"
PRINT 7 MOD 3
PRINT MOD(7,3)
PRINT -1 MOD 8
PRINT 10 MOD 2 = 0
PRINT 2 + 7 MOD 4 * 2
```

The arguments of all these functions must be numbers (`number` error otherwise). `SIN`, `COS`, `ABS`, `ROUND` and `INT` take exactly one argument; `MIN`, `MAX` and `MOD` take exactly two (`args` error otherwise).

## Tricks with these functions

There is no `SQR` (square root). You can build what you need from what exists:

| You want | Write |
| --- | --- |
| is `N` even? | `N MOD 2 = 0` |
| whole part of `X` | `INT(X)` |
| keep `X` between 10 and 246 | `MAX(10, MIN(X, 246))` |
| wrap around: 0, 1, … 7, 0, 1, … | `N MOD 8` |
| distance of a point from the centre | find it with sprites and `HIT`, or compare squared distances: `DX * DX + DY * DY < R * R` |
| random choice from a list | `ITEM(LIST_NAME,RND(1,COUNT(LIST_NAME)))` |

```basic id=r-tricks output="true|3|5|true"
N = 10
PRINT N MOD 2 = 0
PRINT INT(3.7)
PRINT 13 MOD 8
DX = 3
DY = 4
PRINT DX * DX + DY * DY < 26
```
