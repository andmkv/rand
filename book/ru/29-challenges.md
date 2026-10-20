---
summary: Открытые проекты трёх уровней сложности, у каждого есть запускаемая заготовка и подсказки, чтобы попробовать самому.
---

# Задания

У тебя есть все инструменты. Это проекты, которые можно попробовать самому. У каждого есть заготовка, которая запускается, и отдельная подсказка, чтобы сначала попробовать самому. Нажми **Открыть в Sandbox**, измени и сделай своим.

## Лёгкие

### 1 · Закат

Нарисуй небо, которое сверху синее, а к низу краснеет, и солнце, наполовину скрытое горизонтом.

```basic id=x-sunset px="10,5=9;10,100=11;10,185=10"
CLS 1
FOR Y = 0 TO 180 STEP 6
  INK 1
  IF Y > 60 THEN
    INK 3
  END IF
  IF Y > 120 THEN
    INK 2
  END IF
  FILLBOX 0,Y,256,6
NEXT Y
```

<details>
<summary>Идеи</summary>

Добавь `INK 6` и `FILLCIRCLE 128,150,30`, а затем нарисуй землю поверх через `FILLBOX` цветом `INK 0`, начиная с `y = 150`. Добавь звёзды в тёмной части через `PLOT`.

</details>

### 2 · Табличка с именем

Напиши слово на ЭКРАНЕ по одной букве, каждую своим цветом, со звуком на каждую букву.

```basic id=x-banner events=TEXT,SFX
CLS 1
LETTERS = LIST("H","E","L","L","O")
FOR I = 1 TO COUNT(LETTERS)
  INK I + 1
  TEXT 20 + I * 30,90,ITEM(LETTERS,I)
  SFX "blip"
  WAIT 0.2
NEXT I
```

<details>
<summary>Идеи</summary>

Команды, которая режет строку на буквы, нет, поэтому буквы лежат в списке. Подставь своё имя. Заставь буквы подпрыгивать, рисуя каждую на своей высоте `y` через `SIN`. Буквы нельзя масштабировать, но можно нарисовать букву дважды со сдвигом на один пиксель, чтобы она казалась жирной.

</details>

## Средние

### 3 · Фейерверк

Запусти ракету снизу, взорви её в небе линиями цвета и повторяй это бесконечно.

```basic id=x-fireworks endless wait=6 events=LINE,SFX
CLS 1
DO
  X = RND(40,215)
  Y = RND(30,100)
  INK RND(2,7)
  FOR H = 180 TO Y STEP -8
    PLOT X,H
    WAIT 0.01
  NEXT H
  SFX "explosion"
  FOR A = 0 TO 6.3 STEP 0.4
    LINE X,Y,X + COS(A) * 24,Y + SIN(A) * 24
  NEXT A
  WAIT 0.5
  CLS 1
LOOP
```

<details>
<summary>Идеи</summary>

Сделай второе кольцо более коротких линий другого цвета. Нарисуй ракету спрайтом. Делай взрыв больше на каждом третьем фейерверке с помощью счётчика.

</details>

### 4 · Уклонись от слизней

Герой ходит влево и вправо, а слизни падают. Коснулся — игра окончена.

```basic id=x-dodge endless wait=8 keys=RIGHT vars="LIVES>=0"
HERO = SPAWN("traveler",128,176)
HERO.SIZE 12,16
SLIME = SPAWN("slime",RND(16,240),0)
SLIME.SIZE 12,14
LIVES = 3
DO
  IF KEY("LEFT") AND HERO.X > 16 THEN
    HERO.MOVE_BY -3,0
  END IF
  IF KEY("RIGHT") AND HERO.X < 240 THEN
    HERO.MOVE_BY 3,0
  END IF
  SLIME.MOVE_BY 0,3
  IF HIT(HERO,SLIME) THEN
    IF LIVES > 0 THEN
      LIVES = LIVES - 1
    END IF
    SFX "explosion"
    SLIME.MOVE RND(16,240),0
  END IF
  IF SLIME.Y > 200 THEN
    SLIME.MOVE RND(16,240),0
  END IF
  CLS 0
  INK 7
  TEXT 6,4,"LIVES " + LIVES
  FRAME
LOOP
```

<details>
<summary>Идеи</summary>

Добавь `STATE` с сообщением о конце игры и перезапуском по `R`. Сделай список слизней с разными скоростями. Пусть слизни со временем ускоряются (счётчик, который увеличивает `SPEED`).

</details>

## Сложные

### 5 · Понг на двоих

Две ракетки, один мяч. W/S двигают левую ракетку, стрелки — правую. Кто первым наберёт пять очков, тот победил.

```basic id=x-pong endless wait=8 vars="LEFT_SCORE>=0;RIGHT_SCORE>=0"
LEFT_PADDLE = SPAWN("paddle",12,96)
LEFT_PADDLE.SIZE 8,36
RIGHT_PADDLE = SPAWN("paddle",244,96)
RIGHT_PADDLE.SIZE 8,36
BALL = SPAWN("ball",128,96)
BALL.SIZE 8,8
VX = 2
VY = 1
LEFT_SCORE = 0
RIGHT_SCORE = 0
DO
  IF KEY("W") AND LEFT_PADDLE.Y > 28 THEN
    LEFT_PADDLE.MOVE_BY 0,-3
  END IF
  IF KEY("S") AND LEFT_PADDLE.Y < 164 THEN
    LEFT_PADDLE.MOVE_BY 0,3
  END IF
  IF KEY("UP") AND RIGHT_PADDLE.Y > 28 THEN
    RIGHT_PADDLE.MOVE_BY 0,-3
  END IF
  IF KEY("DOWN") AND RIGHT_PADDLE.Y < 164 THEN
    RIGHT_PADDLE.MOVE_BY 0,3
  END IF
  BALL.MOVE_BY VX,VY
  IF BALL.Y < 8 OR BALL.Y > 184 THEN
    VY = -VY
  END IF
  IF HIT(BALL,LEFT_PADDLE) AND VX < 0 THEN
    VX = -VX
    SFX "blip"
  END IF
  IF HIT(BALL,RIGHT_PADDLE) AND VX > 0 THEN
    VX = -VX
    SFX "blip"
  END IF
  IF BALL.X < 0 THEN
    RIGHT_SCORE = RIGHT_SCORE + 1
    BALL.MOVE 128,96
  END IF
  IF BALL.X > 256 THEN
    LEFT_SCORE = LEFT_SCORE + 1
    BALL.MOVE 128,96
  END IF
  CLS 0
  INK 7
  TEXT 100,4,LEFT_SCORE + " : " + RIGHT_SCORE
  FRAME
LOOP
```

<details>
<summary>Идеи</summary>

Останови игру на пяти очках (переменная `STATE`). Ускоряй мяч при каждом ударе о ракетку. Направляй мяч в зависимости от того, куда он попал на ракетке, как в *Разбей кирпичи*. Обрати внимание на проверки `VX < 0` и `VX > 0` в заготовке: мяч перекрывает ракетку несколько кадров подряд, и без них он разворачивался бы снова и снова и застревал.

</details>

### 6 · Твой собственный мир

Объедини всё: сцена, как в Истории, с героем, врагами, предметом для сбора, счётом, тремя экранами (через `STATE`), собственной пиксельной графикой и своими звуками. Опубликуй её с текстом *Как играть* и отправь ссылку другу.

## Когда застрял

1. Запусти заготовку и поменяй одно число.
2. Прочитай соответствующую главу и страницу справочника.
3. Урежь программу, пока она не заработает, а потом добавляй обратно по кусочку.
4. Загляни в три игры во вкладке ПРИМЕРЫ: твою задачу там, скорее всего, уже кто-то решил.
