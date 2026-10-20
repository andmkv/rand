import { games } from "./games.ts";
export interface Example {
  id: string;
  title: string;
  description: string;
  tweak: string;
  code: string;
  endless?: boolean;
  game?: boolean;
  controls?: string;
}
export const examples: Example[] = [
  {
    id: "tunnel",
    title: "RAINBOW TUNNEL",
    description:
      "Open a rainbow portal. One circle becomes a tunnel to somewhere strange.",
    tweak: "Change STEP -8 to STEP -3. Where does the tunnel go?",
    code: `BORDER 3
FOR R = 88 TO 8 STEP -8
  INK RND(1,7)
  CIRCLE 128,96,R
  WAIT 0.04
NEXT R
INK 0
FILLBOX 80,88,96,16
INK 7
TEXT 88,94,"HELLO MAGIC"
SOUND "coin"`,
  },
  {
    id: "fireworks",
    title: "FIREWORKS",
    description: "A pocket-sized celebration, with a different sky every time.",
    endless: true,
    tweak: "Change WAIT 0.5 to WAIT 0.1 for a faster celebration.",
    code: `SUB LAUNCH
  FOR H = 180 TO Y STEP -6
    PLOT X,H
    WAIT 0.01
  NEXT H
END SUB
SUB BURST
  FOR A = 0 TO 6.3 STEP 0.4
    LINE X,Y,X+COS(A)*SIZE,Y+SIN(A)*SIZE
  NEXT A
  SOUND "explosion"
  WAIT 0.5
END SUB
DO
  X = RND(30,225)
  Y = RND(30,120)
  SIZE = RND(12,32)
  INK RND(1,7)
  CALL LAUNCH
  CALL BURST
LOOP`,
  },
  {
    id: "robot",
    title: "ROBOT SONG",
    description:
      "This robot sings in beeps. Nobody has told it the right notes yet.",
    tweak: "Change 200,1200 to 40,300 for a sleepy robot.",
    code: `ROBOT = SPAWN("wizard",128,110)
ROBOT.SAY "BEEP BOOP"
FOR N = 1 TO 8
  INK RND(1,7)
  CIRCLE 128,96,N*10
  BEEP RND(200,1200),0.15
NEXT N`,
  },
  {
    id: "ghosts",
    title: "GHOST PARTY",
    description:
      "Invite the ghosts. They are much better at dancing than haunting.",
    tweak: "Try spawning slime instead of ghost.",
    code: `BORDER 5
FOR G = 1 TO 6
  BOO = SPAWN("ghost",G*35,110)
  BOO.SAY "BOO!"
  BOO.MOVE_BY 0,-25
  WAIT 0.15
  BOO.MOVE_BY 0,25
NEXT G
PLAY "C4 E4 G4 C5"`,
  },
  {
    id: "wall",
    title: "BREAK THE WALL",
    description: "Build a wall. Then discover why the cat packed dynamite.",
    tweak: "Move the dynamite from 128,100 to 90,100.",
    code: `INK 2
FOR X = 80 TO 160 STEP 16
  FOR Y = 60 TO 140 STEP 16
    BOX X,Y,15,15
  NEXT Y
NEXT X
BOMB = SPAWN("dynamite",128,100)
WAIT 0.4
BOMB.EXPLODE`,
  },
  {
    id: "stars",
    title: "STARFIELD",
    description:
      "Watch a sky that never settles. Tiny stars wink in and out, one patch at a time.",
    endless: true,
    tweak: "Change WAIT 0.03 to WAIT 0.01 for faster twinkling.",
    code: `DO
  X = RND(0,255)
  Y = RND(0,191)
  INK 0
  FILLBOX X,Y,8,8
  INK RND(5,7)
  PLOT X,Y
  WAIT 0.03
LOOP`,
  },
  {
    id: "name",
    title: "MAGIC NAME",
    description:
      "The world is waiting for your name. Give it a very silly one.",
    tweak: "Change the final sound from coin to laser.",
    code: `INPUT "What is your magic name?", NAME
BORDER 3
INK 6
TEXT 20,80,NAME
FOR R = 10 TO 70 STEP 15
  CIRCLE 128,96,R
NEXT R
SOUND "coin"`,
  },
  {
    id: "number",
    title: "NUMBER WIZARD",
    description:
      "The wizard is thinking of a number from 1 to 5. You get three guesses.",
    tweak: "Change RND(1,5) to RND(1,10).",
    code: `SECRET = RND(1,5)
GUESS = 0
FOR TRY = 1 TO 3
  INPUT "Guess a number from 1 to 5", GUESS
  IF GUESS = SECRET THEN
    TEXT 50,90,"YOU FOUND IT!"
    SOUND "coin"
    EXIT FOR
  END IF
  PRINT "Try again!"
NEXT TRY
PRINT "The number was " + SECRET`,
  },
  {
    id: "cat",
    title: "BOUNCING CAT",
    description:
      "A cat with a very important appointment on both sides of the screen.",
    tweak: "Change SPEED = 8 to SPEED = 16.",
    code: `CAT = SPAWN("cat",30,110)
SPEED = 8
FOR FRAME = 1 TO 50
  IF CAT.X > 230 THEN
    SPEED = -8
  END IF
  IF CAT.X < 20 THEN
    SPEED = 8
  END IF
  CAT.MOVE_BY SPEED,0
  WAIT 0.04
NEXT FRAME`,
  },
  {
    id: "machine",
    title: "DRAWING MACHINE",
    description: "Turn a little maths into a flower from another planet.",
    tweak: "Change SIN(A*3) to SIN(A*5).",
    code: `BORDER 1
FOR A = 0 TO 6.28 STEP 0.05
  INK RND(3,7)
  X = 128 + COS(A)*70
  Y = 96 + SIN(A*3)*65
  LINE 128,96,X,Y
NEXT A
SOUND "jump"`,
  },
  {
    id: "cards",
    title: "FALLING CARDS",
    description:
      "A victory cascade: each bouncing card leaves a ribbon of its past positions.",
    endless: true,
    tweak: "Change X = X + 3 to X = X + 6 for wider trail spacing.",
    code: `DO
  X = RND(0,80)
  Y = 12
  SPEED = 1
  FOR FRAME = 1 TO 70
    INK 7
    FILLBOX X,Y,14,20
    INK 2
    TEXT X+3,Y+4,"A"
    X = X + 3
    Y = Y + SPEED
    SPEED = SPEED + 0.6
    IF Y > 165 THEN
      Y = 165
      SPEED = -ABS(SPEED)*0.8
    END IF
    WAIT 0.025
  NEXT FRAME
LOOP`,
  },
  {
    id: "radio",
    title: "ROBOT RADIO",
    description: "Tune into a robot station that invents its own song forever.",
    endless: true,
    tweak: "Change 200,1200 to 80,400 for a sleepy station.",
    code: `DO
  INK RND(1,7)
  FILLBOX RND(0,245),RND(0,180),10,10
  BEEP RND(200,1200),0.15
  REST 0.25
LOOP`,
  },
  ...games,
];
