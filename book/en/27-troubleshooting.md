---
summary: Symptoms and fixes — nothing happens, no sound, keys not working, empty screen, lost work — in the order you are likely to meet them.
---

# Troubleshooting

Find what you see, and try the fixes in order.

## My program does nothing when I press RUN

1. Look under CODE: an error message with a line number means the program was refused. Fix that line first; see [error messages](book:ref-errors).
2. Is CODE empty, or is everything after a `'` or `REM`? Those parts are comments and do nothing.
3. A program that only sets variables draws nothing. Add a drawing command such as `CIRCLE 128,96,30`.
4. Press **↺ RESET**, then **▶ RUN** again.

## SCREEN is empty, but there was no error

- **The ink matches the background.** `INK 0` on `PAPER 0` is black on black. Remember `INK 7` is white and the default.
- **The drawing is outside SCREEN.** x must be 0–255 and y 0–191. A shape at `300,100` is clipped away.
- **Something drew over it.** A later `FILLBOX` or `FILLCIRCLE` covers earlier drawings. Draw the background first.
- **`CLS` came after the drawing.** `CLS` wipes everything drawn before it.
- **A `WAIT` or `INPUT` is still running.** The drawing may not have started yet.
- **The sprite is hidden or destroyed.** Print `S.VISIBLE` and `S.ALIVE` to find out.

## The wrong colour

- Colours go from 0 to 7. `INK 8` is an error. The shade is chosen by `BRIGHT 0` or `BRIGHT 1`.
- `INK` only affects what is drawn *after* it. If you want a red box, put `INK 2` *before* the `BOX`.
- Black is the same in both shades.

## The keys do nothing

- The keys go to **SCREEN**, not CODE. Click on SCREEN.
- Only keys that the program asks about with `KEY("...")` do anything. Check the spelling of the name: `"LEFT"`, not `"ARROWLEFT"`.
- Combinations with `Ctrl`, `⌘` or `Alt` are ignored.
- If you switched to another tab or window, all keys are released. Click SCREEN and press again.
- A game without `FRAME` or `WAIT` inside its loop may react slowly. Add `FRAME` at the end of the loop.

## I hear nothing

1. Sound starts only after you have clicked or pressed a key on the page. Press RUN again.
2. Is the device muted, or the browser tab muted (look for a speaker icon on the tab)?
3. In the Sound Lab, **Mute** silences the lab's own audition. Close the lab, or press **Unmute**.
4. Did the program print an error? An unknown sound name is the `sound` error.
5. More than 32 sound starts in one second are dropped. A loop with `SFX` and no `WAIT` plays only the first few.
6. After STOP or RESET, all sound is cut off on purpose.

## The program is too fast, or too slow

- Too fast: a game loop without `FRAME` or `WAIT`. Add `FRAME` (about 60 steps per second).
- Too slow: you may be drawing a lot per frame. Draw only what changed, or use sprites instead of redrawing shapes. Make steps bigger rather than doing more steps.
- Changing the speed: a speed variable (`SPEED = 3`) is easier to tune than numbers repeated all over.

## "That is a lot of magic!"

You hit a safety limit. Check, in order:

- a `FOR` with more than 10,000 passes;
- a nested loop whose total goes beyond 10,000 passes;
- more than 128 living sprites, or 512 created in a program without `DO … LOOP`;
- more than 256 sounds in one run, or a list with more than 128 items;
- a string over 2000 characters.

If your program is meant to run forever, give it a `DO … LOOP`; programs with one are not stopped by the total limits.

## HIT does not seem to work

- Both sprites must be **alive and visible**.
- The box is `WIDTH` × `HEIGHT`, which is 16 × 16 unless you called `SIZE`. For your own sprites call `SIZE` with the sprite's real size.
- Touching edges is not a hit; the centres must be closer than half the sum of the sizes.
- Test it: `PRINT HIT(A,B)` on the frame where they should touch. Is the answer `true`?
- Fast sprites can jump over thin ones between two frames. Move in smaller steps, or make the target taller.

## My text is cut off or in the wrong place

- `TEXT x,y,…`: x,y is the **top-left** corner. A line of 30 letters is about 210 pixels wide. Text is not wrapped.
- At most 120 characters are drawn per `TEXT`.
- To show a number, join it to words: `"SCORE " + SCORE`.

## My loop gives a surprising answer

- Print the variable inside the loop: `PRINT I`.
- Remember `STEP`: `FOR I = 10 TO 1` does not run at all, because the default step is +1. Write `STEP -1`.
- Decimal steps (`STEP 0.1`) add up tiny errors. Do not compare them with `=`; compare with `<` or `>`.

## I lost my work

- **Reload the editor page.** The autosaved copy in this browser comes back. Do not use *New* or *Reset project*, which replace it deliberately.
- With an account, open **Project → History**: earlier versions are kept (50 checkpoints or 30 days by default).
- If you saved a `.randusr` file, use **Open file**.
- Clearing browser data deletes the local copy. This is why files and the cloud exist: see [chapter 17](book:saving-and-sharing).

## The handbook's Open in Sandbox replaced my code

The handbook asks first and offers **Save current project as a file** before replacing anything. If you chose *Replace and open* by accident and had not saved a file, your earlier code is gone from the browser's autosave; check **History** if the project was in the cloud.

## A `.randusr` file will not open

*That file is not a Randomize USR project* means the file is damaged or is not a project file. *Newer version* means the app is older than the file: reload the page to get the latest app. Files over 1 MB are refused. Your current project is never changed by a failed open.

## Things look wrong on my phone

SCREEN scales to the largest whole-number size that fits. On a very small screen, rotate the device. The handbook itself works on phones: the contents are behind the **Contents** button.

## A shared link says "expired" or "unavailable"

- A link from a **Demo** session stops working when that demo ends.
- The owner may have switched the project to private, replaced the link, or removed it.
- A project can be unavailable if a moderator has taken it down.

## Still stuck?

Cut the program down until it works, then add lines back one by one. When you add a line and it breaks again, you have found the problem. This is the oldest and best debugging trick there is.
