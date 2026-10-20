---
summary: Every built-in sprite and sound by id, the rules for @aliases, and the limits of personal assets.
---

# Reference: sprites and sounds that come with the machine

## Built-in sprites

Use the id with `SPAWN("id",x,y)`. Ids are not case-sensitive. The **INVENTORY** drawer shows each picture and pastes the code for you. These pictures are 8 × 8 pixels of original art, displayed at 16 × 16.

| id | Picture |
| --- | --- |
| `cat` | a cat |
| `wizard` | a wizard in a pointed hat |
| `ghost` | a friendly ghost |
| `key` | a key |
| `door` | a door |
| `star` | a star |
| `crate` | a wooden crate |
| `dynamite` | a stick of dynamite |
| `rocket` | a rocket |
| `slime` | a slime |
| `alien` | an alien |
| `ship` | a spaceship |
| `paddle` | a bat for ball games |
| `ball` | a ball |
| `brick_red` | a red brick |
| `brick_cyan` | a cyan brick |
| `brick_yellow` | a yellow brick |
| `platform` | a platform |
| `traveler` | a small hero |

```basic id=r-all-sprites sprites=19
KINDS = LIST("cat","wizard","ghost","key","door","star","crate","dynamite","rocket","slime")
PUSH KINDS,"alien"
PUSH KINDS,"ship"
PUSH KINDS,"paddle"
PUSH KINDS,"ball"
PUSH KINDS,"brick_red"
PUSH KINDS,"brick_cyan"
PUSH KINDS,"brick_yellow"
PUSH KINDS,"platform"
PUSH KINDS,"traveler"
FOR I = 1 TO COUNT(KINDS)
  S = SPAWN(ITEM(KINDS,I),10 + I * 12,90)
NEXT I
```

## Built-in sounds

Use the id with `SOUND "id"` or `SFX "id"`. Hear them in INVENTORY with **▶ Play**.

| id | Sounds like | Wave | Pitch glide | Length |
| --- | --- | --- | --- | --- |
| `explosion` | a blast | noise | 140 → 30 Hz | 0.56 s |
| `coin` | a sparkling reward | square | 880 → 1760 Hz | 0.18 s |
| `laser` | a space shot | saw | 1600 → 80 Hz | 0.22 s |
| `jump` | a spring | square | 180 → 720 Hz | 0.20 s |
| `power-up` | a rising charge | triangle | 260 → 980 Hz | 0.50 s |
| `blip` | a short tap | pulse | 740 Hz flat | 0.12 s |
| `drum` | a beat | noise | 160 → 50 Hz | 0.24 s |
| `wind` | a gust | noise | 280 → 90 Hz | 0.85 s |

```basic id=r-all-sounds events=SFX
SFX "explosion"
SFX "coin"
SFX "laser"
SFX "jump"
SFX "power-up"
SFX "blip"
SFX "drum"
SFX "wind"
```

## Personal assets and aliases

Sprites and sounds you create (with an account) get an **alias**: `@` followed by a lower-case letter and then up to 30 lower-case letters, digits, hyphens or underscores. It is built from the name you give, never changes when you rename the asset, and is unique across all your sprites and sounds (`@hero`, `@hero-2`). A name that contains no Latin letters becomes `@sprite` (sounds too), with a number added if that is taken.

| Use | Syntax |
| --- | --- |
| a personal sprite | `SPAWN("@hero",x,y)` |
| a personal sound effect | `SOUND "@zap"` or `SFX "@zap"` |
| a personal instrument | `NOTE "C4",1,"@pluck"` and `PLAY "C4 E4","@pluck"` |

A project **carries** the assets it uses (in its `assetManifest`), so the program runs for guests, on other computers and in published pages. A project can carry up to 16 sprites and 16 sounds, and the manifest is limited to 512 KiB.

## Limits of personal assets

| What | Limit |
| --- | --- |
| sprite size | up to 64 × 64 pixels (4,096), 15 colours and a transparent slot |
| animation | up to 32 frames, 1–12 frames per second, loop on or off |
| assets in an account | 64 (sprites and sounds together), 100 versions each, 5 MiB in total |
| sound effect length | 50 ms to 5 s |
| sound frequency | 30 to 4000 Hz |
