---
summary: BEEP, NOTE, REST, TEMPO, PLAY, SOUND and SFX — blocking and non-blocking sound, note names, instruments and limits.
---

# Reference: sound

## How sound works

- Sound starts only after a user gesture in the browser (pressing RUN counts). If the browser refuses audio, the program carries on silently.
- Some commands **block** (the next line waits until the sound has finished) and some do not. See the table.
- STOP and RESET silence everything immediately.
- **Safety limits:** at most **32 sound starts per second** (more are dropped silently); a program without `DO … LOOP` may start at most **256** sounds in total (then `limit`); eight sounds can play at once; the master volume is capped.
- Every number below can be a variable or a calculation.

| Command | Blocks? | Time unit | Plays |
| --- | --- | --- | --- |
| `BEEP` | yes | seconds | a tone by frequency |
| `NOTE` | yes | beats | a tone by note name, optionally with an instrument |
| `REST` | yes | beats | nothing (silence) |
| `PLAY` | yes | beats (1 per note) | a row of notes |
| `SOUND` | yes, 0.2 s | seconds | an effect |
| `SFX` | **no** | seconds | an effect |
| `TEMPO` | no | — | sets the length of a beat |

## Tempo and beats

### `TEMPO` {#cmd-tempo}

**Syntax:** `TEMPO bpm` · 30 to 300 beats per minute; default **120** at the start of every RUN. Other values give `range`.

One beat lasts `60 / bpm` seconds: 0.5 s at the default. `NOTE`, `REST` and `PLAY` are measured in beats.

## Tones

### `BEEP` {#cmd-beep}

**Syntax:** `BEEP frequency, seconds` · frequency 30–4000 Hz; seconds 0–10. Blocking.

A square-wave tone. Outside the ranges: `range` ("sound").

```basic id=r-beep events=BEEP
BEEP 440,0.25
```

### `NOTE` {#cmd-note}

**Syntax:** `NOTE name, beats [, instrument]` · blocking.

Plays a note for `beats` beats (decimals allowed). `name` is a string: a letter `A`–`G`, an optional `#` (sharp) or `b` (flat), and an octave `0`–`8`; not case-sensitive. A4 is 440 Hz and C4 is middle C. The resulting frequency must be 30–4000 Hz (so roughly B0 to B7), or `range`. Anything that is not a note name is `range` ("NOTE").

The optional third argument is the `"@alias"` of an **instrument** saved in the project. An unknown alias, or an alias that is a sound effect, is the `sound` error.

```basic id=r-note events=NOTE
NOTE "A4",1
NOTE "C#5",0.5
NOTE "Bb3",0.5
```

### `REST` {#cmd-rest}

**Syntax:** `REST beats` · blocking. Silence for that many beats.

```basic id=r-rest events=REST,TEMPO
TEMPO 240
NOTE "C4",1
REST 1
NOTE "C4",1
```

### `PLAY` {#cmd-play}

**Syntax:** `PLAY notes [, instrument]` · blocking.

`notes` is a string of note names separated by spaces, played **one beat each**. At most 64 notes (`limit`). There are no rests or lengths inside a `PLAY`; use `NOTE` and `REST` for rhythm. The optional second argument is an instrument alias, as for `NOTE`.

```basic id=r-play events=PLAY
PLAY "C4 E4 G4 C5"
```

## Effects

### `SOUND` {#cmd-sound}

**Syntax:** `SOUND name` · blocking for 0.2 seconds.

Plays an effect and then waits 0.2 s. `name` is a built-in effect id (not case-sensitive; see [assets](book:ref-assets)) or the `@alias` of a sound saved in the project. Unknown names are the `sound` error. (An instrument alias also works here, playing a short A4.)

### `SFX` {#cmd-sfx}

**Syntax:** `SFX name` · not blocking.

The same as `SOUND`, but the program continues immediately. Use it in game loops.

```basic id=r-sfx events=SOUND,SFX
SOUND "coin"
SFX "laser"
SFX "explosion"
```

## Making your own

Effects and instruments with an `@alias` come from the Sound Lab: see [chapter 16](book:sound-lab). Their recipe limits are: frequency 30–4000 Hz, effect length 50 ms – 5 s, attack/decay/release at most 2 s each and not longer than the effect together, tuning ±1200 cents, up to 16 sounds in a project.
