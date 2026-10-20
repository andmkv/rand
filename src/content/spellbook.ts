import { spriteAssets } from "../runtime/assets.ts";
import { spellSummaries } from "./spell-summaries.ts";
export interface Spell {
  id: string;
  category: string;
  name: string;
  description: string;
  /** One kid-friendly sentence (at most 12 words); `description` holds the technical note. */
  summary: string;
  syntax: string;
  code: string;
  tags: string;
}
const entry = (
  category: string,
  name: string,
  description: string,
  syntax: string,
  code: string,
  tags = "",
): Spell => {
  const id =
    (
      {
        "Variables are boxes with names": "variables",
        "A loop repeats magic": "loop-concept",
        "IF lets the computer choose": "if-concept",
      } as Record<string, string>
    )[name] ??
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  return {
    id,
    category,
    name,
    description,
    summary: spellSummaries[id] ?? description,
    syntax,
    code,
    tags,
  };
};
export const spells: Spell[] = [
  entry(
    "FLOW",
    "FRAME",
    "Show this frame and yield briefly (about 1/60 second). Use it once per game loop. Heavy work still yields safely. Click SCREEN to resume keyboard control after editing.",
    "FRAME",
    'DO\n  CLS\n  TEXT 20,90,"HELLO FRAME"\n  FRAME\nLOOP',
    "game animation tick",
  ),
  entry(
    "LOGIC",
    "KEY",
    "Read a held key: LEFT, RIGHT, UP, DOWN, SPACE, ENTER, or a letter/number. RUN focuses SCREEN when KEY is first used. Click CODE to edit; keys there never steer the game. STOP releases input.",
    'KEY("LEFT")',
    'DO\n  IF KEY("SPACE") THEN\n    INK RND(1,7)\n    PLOT RND(0,255),RND(0,191)\n  END IF\n  FRAME\nLOOP',
    "keyboard game controls",
  ),
  entry(
    "LOGIC",
    "HIT",
    "TRUE when two visible, living sprites overlap. Uses centered rectangular bounds (rotation does not change collision bounds). Hidden or destroyed sprites do not hit.",
    "HIT(A,B)",
    'A=SPAWN("cat",80,100)\nB=SPAWN("star",88,100)\nPRINT HIT(A,B)',
    "collision overlap",
  ),
  entry(
    "WORLD",
    ".SIZE",
    "Resize a sprite in whole pixels. X/Y stay at its center. WIDTH, HEIGHT, VISIBLE and ALIVE let your code inspect it; ALIVE also works after DESTROY.",
    "OBJECT.SIZE width,height",
    'BAT=SPAWN("paddle",128,170)\nBAT.SIZE 48,8\nPRINT BAT.WIDTH',
    "bounds dimensions resize",
  ),
  entry(
    "LOGIC",
    "AND / OR / NOT",
    "Combine choices. NOT flips a condition; AND needs both; OR needs either. AND and OR skip the right side when the result is already known.",
    "IF condition AND NOT other THEN … END IF",
    'IF 2+3*4=14 AND NOT FALSE OR 1=2 THEN\n  PRINT "BOTH TRUE"\nEND IF',
    "boolean conditions",
  ),
  entry(
    "LOGIC",
    "ELSE",
    "Choose what happens when IF is false.",
    "IF condition THEN … ELSE … END IF",
    'IF RND(1,2)=1 THEN\n  PRINT "HEADS"\nELSE\n  PRINT "TAILS"\nEND IF',
    "branch choice",
  ),
  entry(
    "LOGIC",
    "LIST / PUSH / ITEM / COUNT",
    "Keep up to 128 numbers, words or sprites in a flat list. PUSH adds one item; ITEM reads a 1-based position; COUNT tells how many. Use loops for a whole wave or wall.",
    "ITEM(list,index) · PUSH list,value · COUNT(list)",
    'FRIENDS=LIST()\nFOR N=1 TO 3\n  PUSH FRIENDS,SPAWN("alien",N*50,80)\nNEXT N\nFOR N=1 TO COUNT(FRIENDS)\n  FRIEND=ITEM(FRIENDS,N)\n  FRIEND.MOVE_BY 0,20\nNEXT N',
    "collection wave row",
  ),
  entry(
    "SOUND",
    "SFX",
    "Play a named effect without pausing movement. SOUND waits; SFX lets a game continue. At most 32 sound events per second, shared with other audio commands.",
    'SFX "coin"',
    'SFX "coin"\nTEXT 50,90,"NO WAIT!"',
    "game audio nonblocking",
  ),
  entry(
    "LOGIC",
    "DO / LOOP",
    "Keep repeating until you press STOP; the screen stays ready for your next click.",
    "DO … LOOP",
    "DO\n  INK RND(1,7)\n  PLOT RND(0,255),RND(0,191)\n  WAIT 0.05\nLOOP",
    "endless repeat animation",
  ),
  entry(
    "DRAW",
    "CLS",
    "Wipe away drawings and choose a fresh paper color.",
    "CLS [color]",
    "CLS 1",
  ),
  ...["INK", "PAPER", "BORDER"].map((name) =>
    entry(
      "DRAW",
      name,
      {
        INK: "Choose the color of your next drawing.",
        PAPER: "Choose the background color.",
        BORDER: "Color the frame around your world.",
      }[name]!,
      `${name} color (0–7)`,
      `${name} 3`,
      "color palette black blue red magenta green cyan yellow white",
    ),
  ),
  entry(
    "DRAW",
    "BRIGHT",
    "Choose bright (1) or softer (0) colors.",
    "BRIGHT 0|1",
    "BRIGHT 1",
  ),
  entry(
    "DRAW",
    "PLOT",
    "Place one tiny pixel.",
    "PLOT x,y",
    "INK 6\nPLOT 128,96",
  ),
  entry(
    "DRAW",
    "LINE",
    "Join two points with a straight line.",
    "LINE x1,y1,x2,y2",
    "INK 5\nLINE 20,20,230,170",
  ),
  ...["BOX", "FILLBOX"].map((name) =>
    entry(
      "DRAW",
      name,
      name === "BOX"
        ? "Draw the outline of a rectangle."
        : "Draw a solid rectangle.",
      `${name} x,y,width,height`,
      `INK 4\n${name} 70,60,100,60`,
      "square shape",
    ),
  ),
  ...["CIRCLE", "FILLCIRCLE"].map((name) =>
    entry(
      "DRAW",
      name,
      name === "CIRCLE" ? "Draw a round outline." : "Draw a solid circle.",
      `${name} x,y,radius`,
      `INK 6\n${name} 128,96,40`,
      "round shape",
    ),
  ),
  entry(
    "DRAW",
    "TEXT",
    "Write pixel letters into the world.",
    'TEXT x,y,"words"',
    'INK 6\nTEXT 30,90,"HELLO WORLD"',
  ),
  entry(
    "LOGIC",
    "Variables are boxes with names",
    "Variables are boxes with names: put a value in a name, then use it again.",
    "NAME = value",
    "SIZE = 30\nCIRCLE 128,96,SIZE",
    "boxes names",
  ),
  entry(
    "LOGIC",
    "A loop repeats magic",
    "Put a spell inside FOR and NEXT to repeat it; the named box changes each time.",
    "FOR name = start TO end … NEXT name",
    "FOR R = 10 TO 50 STEP 10\n  CIRCLE 128,96,R\nNEXT R",
    "concept loop repeat",
  ),
  entry(
    "LOGIC",
    "IF lets the computer choose",
    "A true condition opens the little door to the spells inside; a false one skips them.",
    "IF condition THEN … END IF",
    "SIZE = 30\nIF SIZE > 20 THEN\n  CIRCLE 128,96,SIZE\nEND IF",
    "concept choose condition",
  ),
  entry(
    "LOGIC",
    "Arithmetic",
    "Mix numbers with +, −, * and /; parentheses go first.",
    "+ - * / ( )",
    "SIZE = (4 + 6) * 3 - 2 / 2\nCIRCLE 128,96,SIZE",
    "math numbers",
  ),
  entry(
    "LOGIC",
    "Comparisons",
    "Ask whether two values match, or one is bigger.",
    "= <> < > <= >=",
    'A = 5\nB = 3\nIF A >= B AND A <> B THEN\n  PRINT "Five is bigger!"\nEND IF\nIF A <= B OR A < B OR A > B OR A = 0 THEN\n  PRINT 1\nEND IF',
    "choose",
  ),
  entry(
    "LOGIC",
    "IF",
    "IF lets the computer choose: do the magic inside only when the condition is true.",
    "IF condition THEN … END IF",
    'IF RND(1,2) = 1 THEN\n  TEXT 30,90,"SURPRISE!"\nEND IF',
    "choose condition",
  ),
  entry(
    "LOGIC",
    "FOR",
    "A loop repeats magic: change the number each time around.",
    "FOR name = start TO end [STEP amount] … NEXT name",
    "FOR R = 10 TO 70 STEP 10\n  CIRCLE 128,96,R\nNEXT R",
    "loop repeat NEXT STEP",
  ),
  entry(
    "LOGIC",
    "RND / RANDOM",
    "Pick a whole number between the two numbers, including both ends.",
    "RND(min,max)",
    "INK RND(1,7)\nCIRCLE RND(30,220),96,20",
    "random surprise",
  ),
  ...["SIN", "COS", "ABS", "ROUND"].map((name) =>
    entry(
      "LOGIC",
      name,
      {
        SIN: "Turn radians into a smooth up-and-down wave.",
        COS: "Turn radians into a smooth sideways wave.",
        ABS: "Make a negative number positive.",
        ROUND: "Round to the nearest whole number.",
      }[name]!,
      `${name}(number)`,
      `PRINT ${name}(${name === "ABS" ? "-3" : name === "ROUND" ? "2.7" : "0"})`,
      "math wave",
    ),
  ),
  entry(
    "WORLD",
    "SPAWN",
    "Summon a tiny friend or toy. Open INVENTORY for every asset, its pixel preview and exact ID.",
    'TOY = SPAWN("kind",x,y)',
    'CAT = SPAWN("cat",70,120)',
    spriteAssets.map((asset) => asset.id).join(" "),
  ),
  ...Object.entries({
    MOVE: ["Go to a point.", "x,y", "180,120"],
    MOVE_BY: ["Move a little from where you are.", "dx,dy", "20,-10"],
    TURN: ["Turn your toy in degrees.", "degrees", "45"],
    SHOW: ["Make your toy visible.", "", ""],
    HIDE: ["Make your toy invisible.", "", ""],
    DESTROY: ["Remove your toy.", "", ""],
    SAY: ["Give your toy a speech bubble.", '"words"', '"MEOW!"'],
    EXPLODE: ["Light the fuse and clear nearby toys and drawings.", "", ""],
  }).map(([name, [description, syntax, args]]) =>
    entry(
      "WORLD",
      "." + name,
      description,
      `TOY.${name} ${syntax}`,
      `TOY = SPAWN("${name === "EXPLODE" ? "dynamite" : "cat"}",128,96)\nTOY.${name}${args ? " " + args : ""}`,
      "move sprite object",
    ),
  ),
  entry(
    "WORLD",
    ".X / .Y / .VISIBLE",
    "Ask where a toy is or whether it can be seen.",
    "TOY.X / TOY.Y / TOY.VISIBLE",
    'CAT = SPAWN("cat",70,120)\nPRINT CAT.X',
  ),
  entry(
    "SOUND",
    "BEEP",
    "Make a robot bleep; duration is in seconds.",
    "BEEP frequency,duration",
    "BEEP 440,0.2",
    "music robot",
  ),
  entry(
    "SOUND",
    "NOTE",
    "Play a musical note for a number of beats. Add an Instrument alias to shape its sound.",
    'NOTE "C4",beats[,"@instrument"]',
    'NOTE "C4",0.5',
    "music melody",
  ),
  entry(
    "SOUND",
    "REST",
    "Leave a quiet space measured in beats.",
    "REST beats",
    'NOTE "C4",0.5\nREST 0.5\nNOTE "G4",0.5',
    "music rhythm",
  ),
  entry(
    "SOUND",
    "TEMPO",
    "Choose how many beats fit in a minute (30–300).",
    "TEMPO bpm",
    'TEMPO 150\nPLAY "C4 E4 G4 C5"',
    "music speed",
  ),
  entry(
    "SOUND",
    "PLAY",
    "Play a little tune, one beat for each note. Add an Instrument alias to shape every note.",
    'PLAY "notes"[,"@instrument"]',
    'PLAY "C4 D4 E4 G4 A4 G4 E4 C4"',
    "music melody",
  ),
  entry(
    "SOUND",
    "SOUND",
    'Play a built-in effect by ID or a saved effect by alias, such as SOUND "@laser". Open INVENTORY for built-in sounds; use SFX for movement without a pause.',
    'SOUND "effect" | SOUND "@alias"',
    'SOUND "laser"',
    "music effects",
  ),
  entry(
    "FLOW",
    "WAIT",
    "Pause in seconds so you can watch the magic.",
    "WAIT seconds",
    "CIRCLE 128,96,30\nWAIT 0.5\nCIRCLE 128,96,60",
    "animation pause",
  ),
  entry(
    "FLOW",
    "PRINT",
    "Write a message below the world.",
    "PRINT value",
    'PRINT "What if you change me?"',
    "console",
  ),
  entry(
    "FLOW",
    "INPUT",
    "Ask a question; set the variable to a number first if you want a numeric answer.",
    'INPUT "question",NAME',
    'INPUT "Your name?",NAME\nTEXT 30,90,NAME',
    "ask name number",
  ),
  entry(
    "LOGIC",
    "Comments",
    "Leave a note for yourself that the computer skips.",
    "' comment or REM comment",
    "' A round little moon\nCIRCLE 128,96,30",
    "REM",
  ),
];
