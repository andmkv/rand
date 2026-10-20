import type { Example } from "./examples.ts";

export const games: Example[] = [
  {
    id: "alien-attack",
    title: "ALIEN ATTACK",
    game: true,
    description: "Ten visitors, one tiny ship. Clear the sky before they land!",
    controls:
      "← → move · SPACE fire · R restart after win/loss. Click SCREEN to return to the controls.",
    tweak: "Change SPEED = 0.24 to 0.4 for faster aliens.",
    code: `' ALIEN ATTACK: all movement and rules live here.
SPEED = 0.24
SHIP = SPAWN("ship",128,176)
SHOT = SPAWN("ball",128,160)
SHOT.SIZE 3,8
ALIENS = LIST()
FOR N = 1 TO 10
  PUSH ALIENS,SPAWN("alien",0,0)
NEXT N
STATE = 0
DO
  IF KEY("R") AND STATE > 1 THEN
    STATE = 0
  END IF
  IF STATE = 0 THEN
    SCORE = 0
    WAVE_X = 40
    WAVE_Y = 38
    DIRECTION = 1
    SHIP.MOVE 128,176
    SHOT.HIDE
    FOR N = 1 TO COUNT(ALIENS)
      ALIEN = ITEM(ALIENS,N)
      ALIEN.SHOW
    NEXT N
    STATE = 1
  END IF
  IF STATE = 1 THEN
    IF KEY("LEFT") AND SHIP.X > 10 THEN
      SHIP.MOVE_BY -3,0
    END IF
    IF KEY("RIGHT") AND SHIP.X < 246 THEN
      SHIP.MOVE_BY 3,0
    END IF
    IF KEY("SPACE") AND NOT SHOT.VISIBLE THEN
      SHOT.MOVE SHIP.X,164
      SHOT.SHOW
      SFX "laser"
    END IF
    IF SHOT.VISIBLE THEN
      SHOT.MOVE_BY 0,-4
      IF SHOT.Y < 20 THEN
        SHOT.HIDE
      END IF
    END IF
    WAVE_X = WAVE_X + SPEED*DIRECTION
    IF WAVE_X > 86 OR WAVE_X < 14 THEN
      DIRECTION = -DIRECTION
      WAVE_Y = WAVE_Y + 10
    END IF
    FOR N = 1 TO COUNT(ALIENS)
      ALIEN = ITEM(ALIENS,N)
      COLUMN = N-1
      ROW = 0
      IF N > 5 THEN
        COLUMN = N-6
        ROW = 1
      END IF
      ALIEN.MOVE WAVE_X+COLUMN*38,WAVE_Y+ROW*26
      IF HIT(SHOT,ALIEN) THEN
        ALIEN.HIDE
        SHOT.HIDE
        SCORE = SCORE+10
        SFX "coin"
      END IF
      IF STATE = 1 AND ALIEN.VISIBLE AND ALIEN.Y > 154 THEN
        STATE = 3
        SFX "explosion"
      END IF
    NEXT N
    IF SCORE = 100 THEN
      STATE = 2
    END IF
  END IF
  CLS 0
  BORDER 1
  INK 5
  TEXT 6,5,"ALIEN ATTACK"
  INK 7
  TEXT 170,5,"SCORE "+SCORE
  INK 1
  LINE 0,188,255,188
  IF STATE = 2 THEN
    INK 6
    TEXT 68,100,"SKY CLEARED!"
  END IF
  IF STATE = 3 THEN
    INK 2
    TEXT 68,100,"THEY LANDED!"
  END IF
  IF STATE > 1 THEN
    INK 7
    TEXT 80,112,"R TO RESTART"
  END IF
  FRAME
LOOP`,
  },
  {
    id: "brick-breaker",
    title: "BRICK BREAKER",
    game: true,
    description:
      "Keep a little comet bouncing. Pop every brick in the rainbow wall.",
    controls:
      "← → move paddle · R restart after win/loss. Click SCREEN to return to the controls.",
    tweak: "Change PADDLE.SIZE 40,8 to 60,8 for an easier catch.",
    code: `' BRICK BREAKER: try a wider paddle or a faster ball.
PADDLE = SPAWN("paddle",128,174)
PADDLE.SIZE 40,8
BALL = SPAWN("ball",128,158)
BALL.SIZE 6,6
BRICKS = LIST()
FOR ROW = 1 TO 3
  FOR COLUMN = 1 TO 6
    KIND = "brick_red"
    IF ROW = 2 THEN
      KIND = "brick_cyan"
    END IF
    IF ROW = 3 THEN
      KIND = "brick_yellow"
    END IF
    BRICK = SPAWN(KIND,COLUMN*36+2,26+ROW*14)
    BRICK.SIZE 30,10
    PUSH BRICKS,BRICK
  NEXT COLUMN
NEXT ROW
STATE = 0
DO
  IF KEY("R") AND STATE > 1 THEN
    STATE = 0
  END IF
  IF STATE = 0 THEN
    SCORE = 0
    X = 128
    Y = 156
    VX = 1.5
    VY = -2
    PADDLE.MOVE 128,174
    FOR N = 1 TO COUNT(BRICKS)
      BRICK = ITEM(BRICKS,N)
      BRICK.SHOW
    NEXT N
    STATE = 1
  END IF
  IF STATE = 1 THEN
    IF KEY("LEFT") AND PADDLE.X-PADDLE.WIDTH/2 > 2 THEN
      PADDLE.MOVE_BY -3,0
    END IF
    IF KEY("RIGHT") AND PADDLE.X+PADDLE.WIDTH/2 < 254 THEN
      PADDLE.MOVE_BY 3,0
    END IF
    OLD_Y = Y
    X = X+VX
    Y = Y+VY
    IF X < 4 OR X > 252 THEN
      VX = -VX
      X = X+VX
    END IF
    IF Y < 22 THEN
      VY = ABS(VY)
    END IF
    BALL.MOVE X,Y
    IF HIT(BALL,PADDLE) AND VY > 0 THEN
      Y = PADDLE.Y-PADDLE.HEIGHT/2-BALL.HEIGHT/2
      VY = -ABS(VY)
      VX = (X-PADDLE.X)/10
      IF ABS(VX) < 0.8 THEN
        VX = 0.8
      END IF
      SFX "jump"
    END IF
    TOUCHED = FALSE
    FOR N = 1 TO COUNT(BRICKS)
      BRICK = ITEM(BRICKS,N)
      IF NOT TOUCHED AND HIT(BALL,BRICK) THEN
        BRICK.HIDE
        SCORE = SCORE+10
        IF ABS(OLD_Y-BRICK.Y) >= (BRICK.HEIGHT+BALL.HEIGHT)/2 THEN
          VY = -VY
        ELSE
          VX = -VX
        END IF
        TOUCHED = TRUE
        SFX "coin"
      END IF
    NEXT N
    BALL.MOVE X,Y
    IF Y > 195 THEN
      STATE = 3
      SFX "explosion"
    END IF
    IF SCORE = 180 THEN
      STATE = 2
    END IF
  END IF
  CLS 0
  BORDER 3
  INK 5
  TEXT 6,5,"BRICK BREAKER"
  INK 7
  TEXT 170,5,"SCORE "+SCORE
  IF STATE = 2 THEN
    INK 6
    TEXT 74,104,"WALL POPPED!"
  END IF
  IF STATE = 3 THEN
    INK 2
    TEXT 74,104,"COMET LOST!"
  END IF
  IF STATE > 1 THEN
    INK 7
    TEXT 80,116,"R TO RESTART"
  END IF
  FRAME
LOOP`,
  },
  {
    id: "pixel-quest",
    title: "PIXEL QUEST",
    game: true,
    description:
      "Hop between floating gardens. Gather two stars and find the golden door.",
    controls:
      "← → walk · SPACE jump (release between jumps) · R restart after win/loss. Avoid gaps and the roaming slime.",
    tweak: "Change JUMP = -4.8 to -5.4 to leap higher.",
    code: `' PIXEL QUEST: an original one-screen garden adventure.
JUMP = -4.8
HERO = SPAWN("traveler",24,166)
HERO.SIZE 12,16
DOOR = SPAWN("door",244,164)
ENEMY = SPAWN("slime",220,166)
ENEMY.SIZE 12,16
PLATFORMS = LIST()
GROUND = SPAWN("platform",32,180)
GROUND.SIZE 64,12
PUSH PLATFORMS,GROUND
LEDGE = SPAWN("platform",112,148)
LEDGE.SIZE 48,12
PUSH PLATFORMS,LEDGE
LEDGE = SPAWN("platform",184,120)
LEDGE.SIZE 48,12
PUSH PLATFORMS,LEDGE
GROUND = SPAWN("platform",232,180)
GROUND.SIZE 48,12
PUSH PLATFORMS,GROUND
STARS = LIST(SPAWN("star",112,128),SPAWN("star",184,100))
STATE = 0
DO
  JUMP_HELD = KEY("SPACE")
  IF KEY("R") AND STATE > 1 THEN
    STATE = 0
  END IF
  IF STATE = 0 THEN
    X = 24
    Y = 166
    VY = 0
    SCORE = 0
    GROUNDED = TRUE
    WAS_JUMP = FALSE
    ENEMY_X = 220
    ENEMY_SPEED = 0.5
    FOR N = 1 TO COUNT(STARS)
      STAR = ITEM(STARS,N)
      STAR.SHOW
    NEXT N
    STATE = 1
  END IF
  IF STATE = 1 THEN
    IF KEY("LEFT") AND X > 7 THEN
      X = X-1.8
    END IF
    IF KEY("RIGHT") AND X < 249 THEN
      X = X+1.8
    END IF
    IF JUMP_HELD AND NOT WAS_JUMP AND GROUNDED THEN
      VY = JUMP
      SFX "jump"
    END IF
    OLD_BOTTOM = Y+HERO.HEIGHT/2
    VY = VY+0.22
    Y = Y+VY
    GROUNDED = FALSE
    FOR N = 1 TO COUNT(PLATFORMS)
      LEDGE = ITEM(PLATFORMS,N)
      TOP = LEDGE.Y-LEDGE.HEIGHT/2
      IF VY >= 0 AND OLD_BOTTOM <= TOP AND Y+HERO.HEIGHT/2 >= TOP THEN
        IF ABS(X-LEDGE.X) < (LEDGE.WIDTH+HERO.WIDTH)/2 THEN
          Y = TOP-HERO.HEIGHT/2
          VY = 0
          GROUNDED = TRUE
        END IF
      END IF
    NEXT N
    HERO.MOVE X,Y
    ENEMY_X = ENEMY_X+ENEMY_SPEED
    IF ENEMY_X < 215 OR ENEMY_X > 235 THEN
      ENEMY_SPEED = -ENEMY_SPEED
    END IF
    ENEMY.MOVE ENEMY_X,166
    FOR N = 1 TO COUNT(STARS)
      STAR = ITEM(STARS,N)
      IF HIT(HERO,STAR) THEN
        STAR.HIDE
        SCORE = SCORE+1
        SFX "coin"
      END IF
    NEXT N
    IF HIT(HERO,DOOR) AND SCORE = 2 THEN
      STATE = 2
      SFX "coin"
    ELSE
      IF Y > 202 OR HIT(HERO,ENEMY) THEN
        STATE = 3
        SFX "explosion"
      END IF
    END IF
  END IF
  WAS_JUMP = JUMP_HELD
  CLS 0
  BORDER 4
  INK 5
  TEXT 6,5,"PIXEL QUEST"
  INK 6
  TEXT 176,5,"STARS "+SCORE+"/2"
  INK 1
  PLOT 20,40
  PLOT 76,68
  PLOT 222,48
  IF STATE = 2 THEN
    INK 6
    TEXT 64,56,"GARDEN FOUND!"
  END IF
  IF STATE = 3 THEN
    INK 2
    TEXT 68,56,"TRY THAT HOP!"
  END IF
  IF STATE > 1 THEN
    INK 7
    TEXT 80,68,"R TO RESTART"
  END IF
  FRAME
LOOP`,
  },
];
