---
summary: Beep, play notes and tunes, use rests and tempo, and choose between SOUND and SFX for effects.
---

# Sound: beeps, notes and effects

**Goal:** add sound to your programs: simple tones, little tunes and game effects.

> [!NOTE]
> Browsers only allow sound after a person has clicked or pressed a key on the page. Pressing **RUN** counts, so your programs can make sound normally. If you hear nothing, click RUN again and check that your device is not muted.

## BEEP: a tone by frequency

`BEEP pitch,seconds` plays a square-wave tone. *Pitch* is a frequency in hertz (Hz): bigger means higher. The standard orchestra note A is 440 Hz. The pitch must be between **30 and 4000**, and the length up to 10 seconds. The program **waits** until the beep has finished.

```basic id=c10-beep events=BEEP
BEEP 440,0.3
BEEP 880,0.3
BEEP 220,0.6
```

## NOTE: a tone by name

Musicians do not say "440 Hz", they say "A". `NOTE "A4",1` plays that note for a number of **beats**. A note name is:

1. a letter, `A` to `G`,
2. an optional `#` (sharp, a little higher) or `b` (flat, a little lower),
3. an octave number, 0 to 8. `C4` is "middle C".

So `"C4"`, `"F#3"`, `"Bb4"`, `"E5"` are all notes. A name that is not a note, such as `"H4"`, gives an error. The note also has to be within the range of the sound engine (30–4000 Hz), which means from about `B0` to `B7`.

How long is a beat? That depends on the **tempo**. `TEMPO n` sets the speed in beats per minute (30 to 300). The default is 120, so one beat is half a second. `REST beats` is a silence of that many beats.

```basic id=c10-melody events=NOTE,REST,TEMPO
TEMPO 100
NOTE "C4",1
NOTE "C4",1
NOTE "G4",1
NOTE "G4",1
NOTE "A4",1
NOTE "A4",1
NOTE "G4",2
REST 1
NOTE "F4",1
NOTE "F4",1
NOTE "E4",1
NOTE "E4",1
NOTE "D4",1
NOTE "D4",1
NOTE "C4",2
```

Change `TEMPO 100` to `TEMPO 200` for a fast version. Change one of the `1`s to `0.5` for a short note.

## PLAY: a tune in one line

`PLAY "notes"` plays a whole row of notes, **one beat each**, separated by spaces. Up to 64 notes.

```basic id=c10-play events=PLAY
TEMPO 180
PLAY "C4 D4 E4 F4 G4 A4 B4 C5"
PLAY "C5 B4 A4 G4 F4 E4 D4 C4"
```

`PLAY` has no rests and no note lengths. For rhythm, use `NOTE` and `REST`.

## Sound effects: SOUND and SFX

A game needs bangs and zaps. The machine includes eight ready-made effects:

| Name | Sounds like |
| --- | --- |
| `explosion` | a blast |
| `coin` | a sparkling reward |
| `laser` | a space shot |
| `jump` | a spring |
| `power-up` | a rising charge |
| `blip` | a short tap |
| `drum` | a beat |
| `wind` | a gust |

There are two ways to play them, and the difference matters:

- `SOUND "name"` plays the effect and then **waits a fifth of a second** before the next line.
- `SFX "name"` plays the effect and goes on **immediately**.

```basic id=c10-effects events=SOUND,SFX
SOUND "coin"
SOUND "jump"
SFX "laser"
SFX "explosion"
PRINT "done"
```

Use `SOUND` in demonstrations and short scripts, when a short pause between sounds is fine. Use `SFX` in games, where the picture must keep moving while the sound plays.

An unknown name gives the error *That sound is not in INVENTORY.* The **INVENTORY** drawer lists every available effect, lets you hear it with **▶ Play**, and pastes the right line. People with an account can make their own effects in the [Sound Lab](book:sound-lab), and play them by name, such as `SFX "@laser2"`.

## Sound in a game loop

Fire a laser every 0.3 seconds, while a ship keeps its position:

```basic id=c10-shots events=SFX
SHIP = SPAWN("ship",128,150)
FOR I = 1 TO 5
  SFX "laser"
  SHOT = SPAWN("star",128,140)
  FOR Y = 140 TO 20 STEP -20
    SHOT.MOVE 128,Y
    FRAME
  NEXT Y
  SHOT.DESTROY
NEXT I
```

## Limits that protect your ears

- At most **32 sound events per second** are played; extra ones are dropped silently, so a loop with `SFX` cannot become a wall of noise.
- A program that has no `DO … LOOP` may start at most 256 sounds in total.
- Only a few sounds sound at once (eight voices), and there is a master volume cap, so nothing is ever deafening.
- STOP and RESET silence everything immediately.

## A robot radio

Here is a program that never ends. It paints random squares and beeps, forever:

```basic id=c10-radio endless wait=4 events=BEEP,REST
DO
  INK RND(1,7)
  FILLBOX RND(0,245),RND(0,180),10,10
  BEEP RND(200,1200),0.15
  REST 0.25
LOOP
```

## Try it

1. Write the first four notes of a song you know, using `NOTE`.
2. Use `REST` to add a pause after every second note.
3. Add a `coin` sound that plays when a star is collected, using `SFX` so the game does not stop.

<details>
<summary>Hints and answers</summary>

1. Look up the notes of your song. `NOTE "E4",1` is a note of one beat.
2. After each pair: `REST 0.5`.
3. `SFX "coin"` inside the `IF` that detects the collection (see [chapter 12](book:collisions-and-score)).

</details>

## What you learned

- `BEEP` uses Hz and seconds; `NOTE` uses names and beats; `TEMPO` sets the beat speed; `REST` is silence; `PLAY` plays a row of notes.
- `SOUND "name"` waits a little; `SFX "name"` does not.
- Sound is limited for safety, and STOP silences it.

You have finished Part II. Next, Part III turns all these pieces into games: [the keyboard](book:keyboard).
