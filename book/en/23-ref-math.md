---
summary: RND and RANDOM, SIN, COS, ABS and ROUND — the numeric functions.
---

# Reference: numbers

All of these are functions: they give back a value and must be used inside an expression (`X = ABS(Y)`), not alone on a line.

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

The arguments of `SIN`, `COS`, `ABS` and `ROUND` must be numbers (`number` error otherwise) and each takes exactly one argument (`args` error otherwise).

## Tricks with only these functions

There is no `MOD` (remainder), `INT` (cut off the fraction) or `SQR` (square root). You can build what you need:

| You want | Write |
| --- | --- |
| is `N` even? | `N / 2 = ROUND(N / 2)` |
| whole part of positive `X` | `ROUND(X - 0.5)` |
| distance of a point from the centre | find it with sprites and `HIT`, or compare squared distances: `DX * DX + DY * DY < R * R` |
| random choice from a list | `ITEM(LIST_NAME,RND(1,COUNT(LIST_NAME)))` |

```basic id=r-tricks output="true|3|true"
N = 10
PRINT N / 2 = ROUND(N / 2)
PRINT ROUND(3.7 - 0.5)
DX = 3
DY = 4
PRINT DX * DX + DY * DY < 26
```
