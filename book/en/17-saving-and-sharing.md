---
summary: Where your projects live (this browser, a .randusr file, the cloud), how history works, and how to share, publish and remix safely.
---

# Saving, sharing and remixing

**Goal:** never lose your work, move it between computers, and show it to other people when you decide to.

## Three places for a project

| Where | Needs an account? | What it is |
| --- | --- | --- |
| **This browser** | No | The editor autosaves your project here as you type. |
| **A `.randusr` file** | No | A file you keep, copy, e-mail or open on another computer. |
| **The cloud** | Yes | Your private library of projects, with history and sharing. |

### This browser

Your current project is saved automatically in the browser you are using. The status next to the title says *Autosaved in this browser*. This works offline and for guests. But it belongs to that one browser on that one device: clearing the browser's site data deletes it. A second browser or another computer starts with its own empty project.

### Files: `.randusr`

Open the **Project** menu and choose **Save file**. Your browser downloads a file such as `my-game.randusr`. Choose **Open file** to load one back (the editor asks first, because it replaces the current project). The file is plain text in a documented format (JSON), up to 1 MB:

```json
{
  "format": "randusr",
  "version": 2,
  "title": "My game",
  "instructions": "Arrow keys move. Catch the stars.",
  "sourceCode": "CLS\nINK 6\nTEXT 20,20,\"HELLO\"",
  "mode": "sandbox",
  "createdAt": "2026-10-20T10:00:00.000Z",
  "updatedAt": "2026-10-20T10:05:00.000Z",
  "storyId": "tower",
  "sceneId": 0,
  "unlocked": 0,
  "exampleId": null
}
```

Your code is in `sourceCode`. If the project uses your own sprites or sounds, a block called `assetManifest` carries them too, so the file runs anywhere. It never contains your account details, only the pictures and sounds the project uses. A newer file format is refused with a message asking you to update the app, and the editor always keeps your current project unchanged when an import fails.

> [!TIP]
> Save a file before you try something risky, before you clear your browser data, and whenever you finish something you are proud of. Files are the best backup.

### Project info and "How to play"

Press the **ⓘ** button next to the title. You can write a title and a short **How to play** text (up to 2000 characters, plain text). It is shown under SCREEN, and on your shared page. Tell players which keys to press and what to try first.

## The cloud

A registered account adds a private library. Open **My projects** from the **Project** menu (or from the home page) to see it, search it and open or delete projects.

- **Save to cloud** copies the project you are editing into your library. It is **private** at first.
- After that, edits are saved to the cloud automatically a moment after you stop typing. If the network drops, your work stays in the browser and the editor offers *Retry*, and it never silently overwrites a newer version from another tab.
- **History** (in the **Project** menu) keeps checkpoints. Open it to read an earlier version, **Save a copy of this version**, or restore it (restoring makes a *new* checkpoint; old ones are never rewritten). By default the last 50 checkpoints or 30 days are kept.
- Every project is private to you unless you decide otherwise.

An account is optional and is also what you need to save your own sprites and sounds (chapters 15 and 16). On a given server, registration may be limited (for example during a closed test).

### Demo

If the server offers it, **Try Demo** gives you a disposable, account-like session without e-mail or password, so you can try the cloud features. A demo is *not* an account: nothing goes into a real profile, projects disappear when the session ends (after an hour of inactivity, or a day at most), and any link you share from a demo stops working then. Demo projects never appear in the public gallery.

## Sharing

Press **Share** in the editor header (it appears once the project is in the cloud) and choose who can see the project:

| Choice | Who can open it |
| --- | --- |
| **Only me** | Nobody else. |
| **Anyone with the link** | People you give the link to. It is not listed anywhere else. |
| **Shown in the gallery** | Everyone, and it appears in the community gallery on the home page. |

Give the project a **title**, a short **description** and **tags** (Game, Art, Music, Story). The gallery card shows a preview picture of SCREEN; **Update preview** in the **Project** menu refreshes it.

### Sharing is a snapshot

When you publish, the editor shares a **saved version** of the project, pinned at that moment. If you keep editing, visitors still see the version you published. To show the new version, open **Share** again and update it. To stop sharing, choose **Only me**. **Replace link** closes the old link and makes a new one.

### What visitors can do

Anyone, **with no account**, can open `/p/<code>`, press **PLAY**, read the code (read-only) and see the *How to play* text. They can also open a copy in their own editor (after a confirmation, so their own work is not replaced by accident). Viewing never changes the viewer's own projects.

With an account, a visitor can **Remix**: the published version is copied into their own library as a new, private project, with credit to the original ("Remixed from … by …"). The original is never changed, and the remixer gets no editing rights to it. Remixing is how people learn from each other's work: read it, run it, change one thing.

If a shared project seems to break the rules (spam, personal information, rights concerns), use **Report project**. A moderator reviews each report.

## Sharing safely

- Share **projects**, not personal information. There are no comments, no direct messages and no chat. Your public name is a display name, never your e-mail address.
- Do not put your full name, address, school or phone number in a title, a description or in text drawn on SCREEN.
- Check that a project is the version you want to share: run it from the top once more.
- Your own sprites and sounds are packed into the shared version, but your private library is never opened up.
- If you work with a child, decide together whether a project should be a link-only one, a gallery one, or private.

## Guest, Demo, account: what is available

| | Guest | Demo | Account |
| --- | --- | --- | --- |
| Write and run BASIC; Story; Examples; Spellbook | ✓ | ✓ | ✓ |
| Autosave in this browser; `.randusr` files | ✓ | ✓ | ✓ |
| Run and read public or link-only projects | ✓ | ✓ | ✓ |
| Cloud projects, history | | temporary | ✓ |
| Share links, gallery | | temporary | ✓ |
| Remix | | temporary | ✓ |
| Draw your own sprites and sounds | | temporary | ✓ |

## Try it

1. Save your *Star Catcher* game as a file and open it again in another browser.
2. Write a **How to play** text for it that a stranger could follow without asking you.
3. If you have an account: share it with "Anyone with the link", open the link in a private window, and play it as a guest.

<details>
<summary>Hints and answers</summary>

1. **Project menu → Save file**, then **Open file** in the other browser.
2. Say which keys to press, what the goal is, and how to restart: "← → move the cat. Catch ten stars. Three misses and it is over. Press R to play again."
3. The private window has no account and no autosaved work, which is exactly what a visitor sees.

</details>

## What you learned

- Autosave protects you from a closed tab; files protect you from everything else.
- The cloud adds history, sharing and remixing, and projects stay private until you share them.
- A published project is a snapshot, and visitors never need an account to play it.

Next is the reference: [the language](book:ref-language).
