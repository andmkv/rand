---
summary: Design your own sound effects and instruments in the Sound Lab, and play them from BASIC with SOUND, SFX, NOTE and PLAY.
---

# The Sound Lab: your own sounds

**Goal:** build a laser, a jump and a coin sound, make an instrument, and use them in a program.

## Who can use it

Like the pixel editor, the Sound Lab needs a registered account (or a **Demo** session) to save sounds. Anyone can *play* the sounds that come with a project. The **workshop** sample bundle that this handbook opens with has two: an effect `@zap` and an instrument `@pluck`, so you can try the code below right now.

## Personal sounds in BASIC

A personal sound is called by its `@name`, just like a personal sprite. There are two kinds, and they are used differently:

| Kind | Used with | Example |
| --- | --- | --- |
| **Sound effect** | `SOUND` and `SFX` | `SFX "@zap"` |
| **Instrument** | the third argument of `NOTE`, or the second of `PLAY` | `NOTE "C4",1,"@pluck"` |

```basic id=c16-zap assets=workshop events=SFX,SOUND
SFX "@zap"
WAIT 0.5
SOUND "@zap"
SOUND "@zap"
PRINT "zapped"
```

`SFX` plays and continues; `SOUND` plays and waits briefly, exactly as for the built-in sounds (see [the sound chapter](book:sound)).

An **instrument** is a sound that can play *any note*. The pitch comes from your `NOTE` or `PLAY`, not from the sound itself:

```basic id=c16-pluck assets=workshop events=NOTE,PLAY
TEMPO 140
NOTE "C4",1,"@pluck"
NOTE "E4",1,"@pluck"
NOTE "G4",2,"@pluck"
PLAY "G4 E4 C4 E4 G4 C5","@pluck"
```

You can use the same melody with different instruments. Without the last argument, the note is played by the plain square-wave voice, as before.

> [!NOTE]
> If you give an effect where an instrument is expected (or the other way round), or a name that is not in the project, you get the error *That sound is not in INVENTORY.*

## Open the Sound Lab

1. Open **INVENTORY** and press **New sound**. The lab opens full screen.
2. Choose the **kind** at the top: *Sound effect* ("one short sound for SOUND in your code") or *Instrument* ("a sound that plays any note"). The kind cannot be changed after you save.
3. Start from a **preset** — Laser, Coin, Jump, Explosion, Power-up, Blip, Drum or Wind — or from scratch.
4. Shape the sound with the controls (below), press **▶ Preview** to hear it, **Save**, and then **Insert in CODE**.

The lab never plays a sound when you merely move a slider, unless you turn on *Play after each change*. **Preview** and **Stop** are buttons you press. **Mute** silences the lab until you close it. **Undo**, **Redo**, **Reset** and **Randomize** help you explore.

### The controls

| Control | What it does |
| --- | --- |
| **Waveform** | The character of the tone. *Square* is buzzy and retro, *Triangle* is soft, *Saw* is bright, *Sine* is pure, *Noise* is hiss and crash. |
| **Start pitch / End pitch** | How high the sound begins and ends, in Hz. A lower end makes it slide down (*Falling*), a higher one up (*Rising*). **Swap** exchanges them. *Instruments have no fixed pitch; the note supplies it.* |
| **Length** | How long the effect lasts (0.05 to 5 seconds). |
| **Volume** | How loud; a safe maximum always applies. |
| **Attack, Decay, Sustain, Release** | The *envelope*, the shape of the loudness over time: how fast the sound fades in, how fast it falls to the held level, what level it holds, and how fast it fades out. |
| **Advanced: pulse width** | For square waves: 50% is a plain square; other values sound thinner and buzzier. |
| **Advanced: noise mix** | A layer of hiss under the tone. |
| **Advanced: fine tune** | Instruments only: shifts every note up or down in cents (100 cents is one semitone). |

The lab draws three small graphs from your settings: **Pitch**, **Volume** and **Wave**. They are a picture of what you will hear: a laser's pitch graph falls from left to right, a coin's rises.

### Three recipes

These are the same settings the built-in sounds use. Make them yourself to see how they work.

- **Laser:** Saw wave, start pitch 1600, end pitch 80, length 0.22 s, a very short attack, and a quick fall. A big downward glide sounds like something zooming away.
- **Jump:** Square wave, start 180, end 720, length 0.2 s. A quick rising glide sounds like a spring.
- **Coin:** Square wave, start 880, end 1760, length 0.18 s. A short rise by one octave, fast, bright, and ending quickly.

Then try your own: Triangle with a long Attack makes a soft swell; Noise with a short Decay makes a drum; a long Release makes a ringing end.

## Instruments

Choose *Instrument* as the kind. The pitch controls disappear, and you get **audition keys** instead: press the on-screen piano or the keys `A S D F G H J K` to hear notes, with an **Octave** switch. Shape the waveform and envelope until it sounds like an instrument you like: a plucked string is a fast attack and a quick decay to a low sustain (as `@pluck` does); an organ is a full sustain.

Save it, and the lab gives you the line for your code: `NOTE "C4",0.5,"@your-name"`.

## Limits that keep sound safe

- Frequencies from 30 to 4000 Hz; effects from 50 ms to 5 seconds.
- Attack, decay and release can each be up to 2 seconds and together cannot be longer than the effect.
- Up to 16 personal sounds in one project; up to 8 voices at once; at most 32 sounds start per second. Extra ones are silently dropped.
- There is a master-volume ceiling; no sound can be deafening.

## A game with your own sound

Put your effect into *Gem hunt* from the previous chapter: replace `SFX "@zap"` with your own sound's alias. Because the aliases are packed into the project, people who open your published game hear them too.

## Try it

1. Add `SFX "@zap"` to a program every time the robot reaches the gem.
2. Play a four-note melody with `@pluck`, then play it again with the plain `NOTE` (no instrument). What is the difference?
3. (Account) Make a sound effect with the *Noise* waveform and a short decay. What does it sound like? Use it for a footstep.

<details>
<summary>Hints and answers</summary>

1. Put the `SFX` line right after the loop of the first program in the previous chapter.
2. The plain voice is a flat square wave; the instrument has the shape of attack, decay and release you designed.
3. A footstep is a short noise burst: length around 0.08 s, attack 0, decay 40 ms, low sustain.

</details>

## What you learned

- Effects are played with `SOUND "@name"` or `SFX "@name"`; instruments with `NOTE "C4",1,"@name"` and `PLAY "...","@name"`.
- The Sound Lab turns a few controls (waveform, pitch glide, length, envelope) into sounds.
- Sounds are packed into the project, like sprites.

Next: [saving and sharing](book:saving-and-sharing).
