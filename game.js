/* ══════════════════════════════════════════════
   CRYPTVAULT — RETRO HORROR GAME ENGINE
   game.js  |  ES2020, no dependencies
══════════════════════════════════════════════ */

"use strict";

/* ──────────────────────────────────────────────
   SCREEN ROUTER
────────────────────────────────────────────── */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

/* ──────────────────────────────────────────────
   TITLE SCREEN MENU NAVIGATION
────────────────────────────────────────────── */
(function initMenu() {
  const items = document.querySelectorAll('.menu-item');
  let selectedIndex = 0;

  function updateSelection(id) {
    document.querySelectorAll('#titleScreen .menu-item').forEach((el, i) => {
      el.classList.toggle('selected', i === selectedIndex);
    });
  }

  document.addEventListener('keydown', e => {
    if (!document.getElementById('titleScreen').classList.contains('active')) return;

    if (e.key === 'ArrowDown' || e.key === 's') {
      selectedIndex = (selectedIndex + 1) % 3;
      updateSelection();
    }
    if (e.key === 'ArrowUp' || e.key === 'w') {
      selectedIndex = (selectedIndex + 2) % 3;
      updateSelection();
    }
    if (e.key === 'Enter') {
      [startGame, () => showScreen('controlsScreen'), () => showScreen('creditsScreen')][selectedIndex]();
    }
  });

  document.getElementById('menuStart').addEventListener('click', startGame);
  document.getElementById('menuControls').addEventListener('click', () => showScreen('controlsScreen'));
  document.getElementById('menuCredits').addEventListener('click', () => showScreen('creditsScreen'));
})();

/* ──────────────────────────────────────────────
   CONSTANTS & CONFIG
────────────────────────────────────────────── */
const TILE   = 40;         // pixels per tile
const COLS   = 21;         // map width  (must be odd)
const ROWS   = 17;         // map height (must be odd)
const FPS    = 60;

const COLORS = {
  wall:       '#3a1a1a',
  wallEdge:   '#5a2a2a',
  floor:      '#1e1414',
  floorAlt:   '#241818',
  player:     '#00ff41',
  playerGlow: 'rgba(0,255,65,0.45)',
  enemy:      '#e05050',
  enemyGlow:  'rgba(220,80,80,0.55)',
  bullet:     '#ffe566',
  bomb:       '#ff8c00',
  chest:      '#c8930a',
  chestOpen:  '#8a6208',
  door:       '#7a3a00',
  doorOpen:   '#3a1800',
  exit:       '#00ff41',
  health:     '#ff4444',
  ammo:       '#ffcc00',
  key:        '#ffe033',
  darkness:   'rgba(0,0,0,0.45)',
  flashlight: 'rgba(255,220,150,0.18)',
  blood:      '#aa1111',
};

const TILE_EMPTY  = 0;
const TILE_WALL   = 1;
const TILE_DOOR   = 2;
const TILE_CHEST  = 3;
const TILE_EXIT   = 4;

/* ──────────────────────────────────────────────
   GAME STATE
────────────────────────────────────────────── */
const state = {
  running:     false,
  paused:      false,
  floor:       1,
  score:       0,
  map:         [],
  player:      null,
  enemies:     [],
  bullets:     [],
  particles:   [],
  items:       [],
  keys:        {},           // currently pressed keys
  flashlight:  true,
  weapon:      0,            // 0=blade, 1=pistol, 2=bomb
  ammo:        [Infinity, 20, 3],
  lastTime:    0,
  msgTimeout:  null,
  doorKeys:    0,
  animFrame:   null,
};

/* ──────────────────────────────────────────────
   CANVAS SETUP
────────────────────────────────────────────── */
const canvas    = document.getElementById('gameCanvas');
const ctx       = canvas.getContext('2d');
const mmCanvas  = document.getElementById('minimap');
const mmCtx     = mmCanvas.getContext('2d');

function resizeCanvas() {
  const W = window.innerWidth;
  const H = window.innerHeight - 52;
  canvas.width  = W;
  canvas.height = H;
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';
}

window.addEventListener('resize', () => {
  resizeCanvas();
});

/* ──────────────────────────────────────────────
   MAP GENERATION — DFS maze + safe door/key placement
────────────────────────────────────────────── */
function generateMap(floor) {
  const map = Array.from({ length: ROWS }, () => Array(COLS).fill(TILE_WALL));

  // Carve passages using iterative DFS (no stack overflow on large maps)
  function carve(startR, startC) {
    const stack = [[startR, startC]];
    map[startR][startC] = TILE_EMPTY;
    while (stack.length) {
      const [r, c] = stack[stack.length - 1];
      const dirs = shuffle([[-2,0],[2,0],[0,-2],[0,2]]);
      let moved = false;
      for (const [dr, dc] of dirs) {
        const nr = r + dr, nc = c + dc;
        if (nr > 0 && nr < ROWS-1 && nc > 0 && nc < COLS-1 && map[nr][nc] === TILE_WALL) {
          map[r + dr/2][c + dc/2] = TILE_EMPTY;
          map[nr][nc] = TILE_EMPTY;
          stack.push([nr, nc]);
          moved = true;
          break;
        }
      }
      if (!moved) stack.pop();
    }
  }
  carve(1, 1);

  // Place exit on far end
  map[ROWS-2][COLS-2] = TILE_EXIT;

  // Add chests (before doors so doors don't block chest cells)
  for (let i = 0; i < 4 + floor; i++) {
    const pos = randomEmpty(map);
    if (pos) map[pos.r][pos.c] = TILE_CHEST;
  }

  return map;
}

/* ──────────────────────────────────────────────
   FLOOD FILL — returns Set of "r,c" strings reachable from (sr,sc)
   treating blockedTile as impassable
────────────────────────────────────────────── */
function floodFill(map, sr, sc, blockedTile) {
  const visited = new Set();
  const queue = [[sr, sc]];
  visited.add(`${sr},${sc}`);
  while (queue.length) {
    const [r, c] = queue.shift();
    for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      const nr = r+dr, nc = c+dc;
      if (nr<0||nr>=ROWS||nc<0||nc>=COLS) continue;
      const key = `${nr},${nc}`;
      if (visited.has(key)) continue;
      const t = map[nr][nc];
      if (t === TILE_WALL) continue;
      if (blockedTile !== undefined && t === blockedTile) continue;
      visited.add(key);
      queue.push([nr, nc]);
    }
  }
  return visited;
}

/* ──────────────────────────────────────────────
   SAFE DOOR + KEY PLACEMENT
   Each door is placed only on a corridor tile that:
     1. Is not adjacent to the player start
     2. Does NOT fully disconnect the exit from the start
   Each key is placed in a cell reachable from start WITHOUT crossing that door.
────────────────────────────────────────────── */
function placeDoorsSafe(map, floor) {
  const doorKeyPairs = [];   // [{door:{r,c}, key:{r,c}}]
  const wantDoors = 2 + floor;
  let placed = 0;

  // Collect all corridor (EMPTY) candidates for a door:
  // must be a single-width chokepoint (exactly 2 passable neighbours in a line)
  const candidates = [];
  for (let r = 2; r < ROWS-2; r++) {
    for (let c = 2; c < COLS-2; c++) {
      if (map[r][c] !== TILE_EMPTY) continue;
      // Skip cells too close to player start
      if (r <= 2 && c <= 2) continue;

      const n = map[r-1][c] !== TILE_WALL;
      const s = map[r+1][c] !== TILE_WALL;
      const w = map[r][c-1] !== TILE_WALL;
      const e = map[r][c+1] !== TILE_WALL;
      const passCount = [n,s,w,e].filter(Boolean).length;

      // A chokepoint has exactly 2 passable neighbours (corridor, not junction)
      if (passCount === 2 && ((n&&s&&!w&&!e)||(w&&e&&!n&&!s))) {
        candidates.push({r, c});
      }
    }
  }
  shuffle(candidates);

  for (const door of candidates) {
    if (placed >= wantDoors) break;

    // Temporarily place door and test connectivity
    map[door.r][door.c] = TILE_DOOR;

    // Check exit is still reachable from player start (treating DOOR as blocked)
    const reachable = floodFill(map, 1, 1, TILE_DOOR);
    const exitReachable = reachable.has(`${ROWS-2},${COLS-2}`);

    if (!exitReachable) {
      // This door would trap the player — skip it
      map[door.r][door.c] = TILE_EMPTY;
      continue;
    }

    // Find a cell on the PLAYER side (reachable without crossing this door)
    // to place the key — at least 3 tiles away from the door
    const playerSideCells = [];
    for (const cellKey of reachable) {
      const [kr, kc] = cellKey.split(',').map(Number);
      if (map[kr][kc] !== TILE_EMPTY) continue;
      const dist = Math.abs(kr - door.r) + Math.abs(kc - door.c);
      if (dist >= 3) playerSideCells.push({r: kr, c: kc});
    }

    if (playerSideCells.length === 0) {
      map[door.r][door.c] = TILE_EMPTY;
      continue;
    }

    // Pick a random cell from player side for the key
    const keyCell = playerSideCells[Math.floor(Math.random() * playerSideCells.length)];
    doorKeyPairs.push({ door, key: keyCell });
    placed++;
  }

  return doorKeyPairs;
}

function randomEmpty(map) {
  const empties = [];
  for (let r = 1; r < ROWS-1; r++)
    for (let c = 1; c < COLS-1; c++)
      if (map[r][c] === TILE_EMPTY) empties.push({ r, c });
  if (empties.length === 0) return null;
  return empties[Math.floor(Math.random() * empties.length)];
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ──────────────────────────────────────────────
   PLAYER
────────────────────────────────────────────── */
function createPlayer() {
  return {
    x: TILE * 1.5,
    y: TILE * 1.5,
    w: TILE * 0.65,
    h: TILE * 0.65,
    hp: 100,
    maxHp: 100,
    speed: 2.8,
    facing: { x: 0, y: 1 },
    attackCooldown: 0,
    invincibleTime: 0,
    frame: 0,
    frameTimer: 0,
  };
}

/* ──────────────────────────────────────────────
   ENEMY FACTORY
────────────────────────────────────────────── */
const ENEMY_TYPES = [
  { name: 'GHOUL',   color: '#cc2200', glow: 'rgba(200,40,0,0.6)',   hp: 25,  spd: 1.0, dmg: 8,  score: 100, size: 0.6 },
  { name: 'SPECTER', color: '#aa44ff', glow: 'rgba(170,68,255,0.6)',hp: 15,  spd: 1.8, dmg: 5,  score: 150, size: 0.55 },
  { name: 'REAPER',  color: '#4444cc', glow: 'rgba(80,80,220,0.65)',  hp: 60,  spd: 0.7, dmg: 20, score: 300, size: 0.8 },
  { name: 'CRAWLER', color: '#55aa00', glow: 'rgba(80,160,0,0.55)',   hp: 35,  spd: 1.4, dmg: 12, score: 200, size: 0.5 },
];

function spawnEnemies(map, floor) {
  const enemies = [];
  const count = 6 + floor * 2;
  for (let i = 0; i < count; i++) {
    const type = ENEMY_TYPES[Math.floor(Math.random() * ENEMY_TYPES.length)];
    let pos;
    let attempts = 0;
    do {
      pos = randomEmpty(map);
      attempts++;
    } while (attempts < 100 && pos.r < 3 && pos.c < 3);

    enemies.push({
      ...type,
      x: pos.c * TILE + TILE / 2,
      y: pos.r * TILE + TILE / 2,
      vx: 0, vy: 0,
      maxHp: type.hp,
      state: 'idle',    // idle | chase | attack
      stateTimer: 0,
      frame: 0,
      frameTimer: 0,
      alertRange: 200 + Math.random() * 100,
      attackCooldown: 0,
      id: i,
    });
  }
  return enemies;
}

/* ──────────────────────────────────────────────
   ITEMS — keys placed safely on player side of each door
────────────────────────────────────────────── */
function spawnItems(map, doorKeyPairs) {
  const items = [];

  // Place one key per door, guaranteed on the player-reachable side
  for (const pair of doorKeyPairs) {
    items.push({
      x: pair.key.c * TILE + TILE / 2,
      y: pair.key.r * TILE + TILE / 2,
      type: 'key',
      collected: false,
      forDoor: pair.door,   // visual hint data (future use)
    });
  }

  // Extra random pickups (health / ammo)
  const extras = Math.floor(4 + state.floor * 1.5);
  for (let i = 0; i < extras; i++) {
    const pos = randomEmpty(map);
    if (!pos) continue;
    const roll = Math.random();
    items.push({
      x: pos.c * TILE + TILE / 2,
      y: pos.r * TILE + TILE / 2,
      type: roll < 0.55 ? 'health' : 'ammo',
      collected: false,
    });
  }
  return items;
}

/* ──────────────────────────────────────────────
   START / RESET GAME
────────────────────────────────────────────── */
function startGame() {
  if (state.animFrame) cancelAnimationFrame(state.animFrame);
  state.floor  = 1;
  state.score  = 0;
  state.weapon = 0;
  state.ammo   = [Infinity, 20, 3];
  state.doorKeys = 0;
  resetGame(false);
  buildLevel();
  showScreen('gameScreen');
  resizeCanvas();
  state.running = true;
  state.paused  = false;
  state.lastTime = performance.now();
  state.animFrame = requestAnimationFrame(gameLoop);
  updateHUD();
}

function resetGame(full = true) {
  if (full) {
    state.running = false;
    state.paused  = false;
  }
  state.enemies   = [];
  state.bullets   = [];
  state.particles = [];
  state.items     = [];
  state.keys      = {};
}

function buildLevel() {
  state.map          = generateMap(state.floor);
  // Place doors safely and get matching key positions
  const doorKeyPairs = placeDoorsSafe(state.map, state.floor);
  state.player       = createPlayer();
  state.enemies      = spawnEnemies(state.map, state.floor);
  state.items        = spawnItems(state.map, doorKeyPairs);
  state.bullets      = [];
  state.particles    = [];
  document.getElementById('floorLabel').textContent =
    `FLOOR ${state.floor} — ${FLOOR_NAMES[Math.min(state.floor-1, FLOOR_NAMES.length-1)]}`;
  buildMinimap();
}

const FLOOR_NAMES = [
  'THE CATACOMBS', 'BONE CORRIDOR', 'SHADOW LAIR', 'THE ABYSS',
  'CRYPTS BELOW', 'WAILING HALLS', 'THE SANCTUM', 'FINAL DESCENT',
];

function nextLevel() {
  state.floor++;
  buildLevel();
  showScreen('gameScreen');
  state.running = true;
  state.paused  = false;
  state.lastTime = performance.now();
  state.animFrame = requestAnimationFrame(gameLoop);
  updateHUD();
}

function resumeGame() {
  state.paused = false;
  showScreen('gameScreen');
  state.lastTime = performance.now();
  state.animFrame = requestAnimationFrame(gameLoop);
}

/* ──────────────────────────────────────────────
   INPUT HANDLING
────────────────────────────────────────────── */
document.addEventListener('keydown', e => {
  state.keys[e.key.toLowerCase()] = true;

  if (!state.running) return;

  switch (e.key.toLowerCase()) {
    case 'escape':
      if (!state.paused) {
        state.paused = true;
        cancelAnimationFrame(state.animFrame);
        showScreen('pauseScreen');
      }
      break;
    case 'f':
      state.flashlight = !state.flashlight;
      document.getElementById('flashlightStatus').textContent = state.flashlight ? 'ON' : 'OFF';
      break;
    case '1': selectWeapon(0); break;
    case '2': selectWeapon(1); break;
    case '3': selectWeapon(2); break;
    case ' ':
      e.preventDefault();
      triggerAttack();
      break;
    case 'e':
      tryInteract();
      break;
    case 'r':
      tryUseItem();
      break;
  }
});

document.addEventListener('keyup', e => {
  state.keys[e.key.toLowerCase()] = false;
});

function selectWeapon(idx) {
  state.weapon = idx;
  document.querySelectorAll('.weapon-slot').forEach((el, i) =>
    el.classList.toggle('selected', i === idx));
  document.getElementById('ammoText').textContent =
    state.ammo[idx] === Infinity ? '∞' : state.ammo[idx];
}

/* ──────────────────────────────────────────────
   ATTACK
────────────────────────────────────────────── */
function triggerAttack() {
  const p = state.player;
  if (p.attackCooldown > 0) return;

  if (state.weapon === 0) {
    // BLADE — melee arc
    p.attackCooldown = 25;
    spawnMeleeParticles(p);
    meleeHit(p, 60, 20);
  } else if (state.weapon === 1) {
    // PISTOL
    if (state.ammo[1] <= 0) { showMessage('NO AMMO!'); return; }
    state.ammo[1]--;
    p.attackCooldown = 18;
    fireBullet(p, p.facing.x, p.facing.y, 6, 15, COLORS.bullet);
    spawnMuzzleFlash(p);
  } else if (state.weapon === 2) {
    // BOMB
    if (state.ammo[2] <= 0) { showMessage('NO BOMBS!'); return; }
    state.ammo[2]--;
    p.attackCooldown = 60;
    throwBomb(p);
  }
  updateHUD();
}

function meleeHit(p, range, dmg) {
  state.enemies.forEach(e => {
    const dx = e.x - p.x, dy = e.y - p.y;
    if (Math.hypot(dx, dy) < range) {
      hurtEnemy(e, dmg);
    }
  });
}

function fireBullet(p, dx, dy, speed, dmg, color) {
  const len = Math.hypot(dx, dy) || 1;
  state.bullets.push({
    x: p.x, y: p.y,
    vx: dx/len * speed, vy: dy/len * speed,
    dmg, color,
    life: 80,
    fromPlayer: true,
  });
}

function throwBomb(p) {
  state.bullets.push({
    x: p.x, y: p.y,
    vx: p.facing.x * 3, vy: p.facing.y * 3,
    dmg: 0,
    color: COLORS.bomb,
    life: 50,
    isBomb: true,
    fromPlayer: true,
  });
}

/* ──────────────────────────────────────────────
   INTERACT / USE ITEM
────────────────────────────────────────────── */
function tryInteract() {
  const p = state.player;
  const pr = Math.floor(p.y / TILE), pc = Math.floor(p.x / TILE);
  const neighbors = [[0,0],[0,1],[0,-1],[1,0],[-1,0]];
  for (const [dr, dc] of neighbors) {
    const r = pr + dr, c = pc + dc;
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) continue;
    const tile = state.map[r][c];
    if (tile === TILE_DOOR) {
      if (state.doorKeys > 0) {
        state.doorKeys--;
        state.map[r][c] = TILE_EMPTY;
        showMessage('DOOR UNLOCKED!');
        spawnParticles(c*TILE+TILE/2, r*TILE+TILE/2, '#f1c40f', 12);
      } else {
        showMessage('NEED A KEY!');
      }
      return;
    }
    if (tile === TILE_CHEST) {
      state.map[r][c] = TILE_EMPTY; // mark opened
      const reward = Math.random();
      if (reward < 0.4) {
        const heal = 20 + Math.floor(Math.random()*20);
        p.hp = Math.min(p.maxHp, p.hp + heal);
        showMessage(`+${heal} HP!`);
      } else if (reward < 0.7) {
        const bullets = 8 + Math.floor(Math.random()*10);
        state.ammo[1] += bullets;
        showMessage(`+${bullets} AMMO!`);
      } else {
        state.ammo[2] += 1;
        showMessage('+1 BOMB!');
      }
      state.score += 50;
      spawnParticles(c*TILE+TILE/2, r*TILE+TILE/2, COLORS.chest, 15);
      updateHUD();
      return;
    }
    if (tile === TILE_EXIT) {
      triggerLevelComplete();
      return;
    }
  }
}

function tryUseItem() {
  // R key: use health from items picked up
  const p = state.player;
  if (p.hp < p.maxHp) {
    p.hp = Math.min(p.maxHp, p.hp + 30);
    showMessage('USED MEDKIT +30 HP');
    updateHUD();
  }
}

/* ──────────────────────────────────────────────
   LEVEL COMPLETE / GAME OVER
────────────────────────────────────────────── */
function triggerLevelComplete() {
  state.running = false;
  cancelAnimationFrame(state.animFrame);
  document.getElementById('lcScore').textContent = state.score;
  showScreen('levelCompleteScreen');
}

function triggerGameOver() {
  state.running = false;
  cancelAnimationFrame(state.animFrame);
  document.getElementById('finalScore').textContent = state.score;
  showScreen('gameOverScreen');
}

/* ──────────────────────────────────────────────
   ENEMY LOGIC
────────────────────────────────────────────── */
function hurtEnemy(e, dmg) {
  e.hp -= dmg;
  spawnParticles(e.x, e.y, COLORS.blood, 6);
  if (e.hp <= 0) {
    killEnemy(e);
  }
}

function killEnemy(e) {
  state.score += e.score;
  spawnParticles(e.x, e.y, COLORS.blood, 18);
  spawnParticles(e.x, e.y, e.color, 8);
  state.enemies = state.enemies.filter(en => en !== e);
  // chance to drop health
  if (Math.random() < 0.35) {
    state.items.push({ x: e.x, y: e.y, type: 'health', collected: false });
  }
  updateHUD();
}

function updateEnemies(dt) {
  const p = state.player;
  for (const e of state.enemies) {
    if (e.attackCooldown > 0) e.attackCooldown--;

    const dx = p.x - e.x, dy = p.y - e.y;
    const dist = Math.hypot(dx, dy);

    // State machine
    if (dist < e.alertRange) {
      e.state = 'chase';
    } else {
      e.state = 'idle';
    }

    if (e.state === 'chase') {
      // Move towards player with simple wall avoidance
      const spd = e.spd * (dt / 16);
      let nx = e.x + (dx / dist) * spd;
      let ny = e.y + (dy / dist) * spd;

      // wall slide
      if (!collidesWithWall(nx, e.y, e.size * TILE)) nx = e.x;
      if (!collidesWithWall(e.x, ny, e.size * TILE)) ny = e.y;
      if (collidesWithWall(nx, e.y, e.size * TILE) && collidesWithWall(e.x, ny, e.size * TILE)) {
        // try random step
        nx = e.x + (Math.random()-0.5)*2;
        ny = e.y + (Math.random()-0.5)*2;
      }
      e.x = nx; e.y = ny;

      // Attack if close
      if (dist < TILE * 0.8 && e.attackCooldown <= 0) {
        e.attackCooldown = 60;
        hurtPlayer(e.dmg, e);
      }

      // Enemy projectiles (SPECTER type)
      if (e.name === 'SPECTER' && dist < 300 && e.attackCooldown === 45) {
        fireBullet({ x: e.x, y: e.y, facing: { x: dx/dist, y: dy/dist } },
          dx/dist, dy/dist, 3.5, 8, e.color);
        state.bullets[state.bullets.length-1].fromPlayer = false;
      }
    } else {
      // Idle wander
      e.stateTimer++;
      if (e.stateTimer % 120 === 0) {
        e.vx = (Math.random()-0.5) * 1.2;
        e.vy = (Math.random()-0.5) * 1.2;
      }
      const nx = e.x + e.vx;
      const ny = e.y + e.vy;
      if (!collidesWithWall(nx, e.y, e.size * TILE)) e.x = nx; else e.vx *= -1;
      if (!collidesWithWall(e.x, ny, e.size * TILE)) e.y = ny; else e.vy *= -1;
    }

    e.frameTimer++;
    if (e.frameTimer > 10) { e.frame = (e.frame + 1) % 4; e.frameTimer = 0; }
  }
}

/* ──────────────────────────────────────────────
   PLAYER UPDATE
────────────────────────────────────────────── */
function updatePlayer(dt) {
  const p = state.player;
  const k = state.keys;
  const spd = p.speed * (dt / 16);

  let mx = 0, my = 0;
  if (k['w'] || k['arrowup'])    my -= 1;
  if (k['s'] || k['arrowdown'])  my += 1;
  if (k['a'] || k['arrowleft'])  mx -= 1;
  if (k['d'] || k['arrowright']) mx += 1;

  if (mx !== 0 || my !== 0) {
    const len = Math.hypot(mx, my);
    mx /= len; my /= len;
    p.facing = { x: mx, y: my };

    const nx = p.x + mx * spd;
    const ny = p.y + my * spd;

    if (!collidesWithWall(nx, p.y, p.w)) p.x = nx;
    if (!collidesWithWall(p.x, ny, p.w)) p.y = ny;

    p.frameTimer++;
    if (p.frameTimer > 8) { p.frame = (p.frame + 1) % 4; p.frameTimer = 0; }
  }

  if (p.attackCooldown > 0) p.attackCooldown--;
  if (p.invincibleTime > 0) p.invincibleTime--;

  // Item pickup
  for (const item of state.items) {
    if (item.collected) continue;
    if (Math.hypot(item.x - p.x, item.y - p.y) < TILE * 0.75) {
      collectItem(item);
    }
  }
  state.items = state.items.filter(i => !i.collected);

  // Check exit
  const pr = Math.floor(p.y / TILE), pc = Math.floor(p.x / TILE);
  if (state.map[pr]?.[pc] === TILE_EXIT) {
    triggerLevelComplete();
  }
}

function hurtPlayer(dmg, source) {
  const p = state.player;
  if (p.invincibleTime > 0) return;
  p.hp -= dmg;
  p.invincibleTime = 45;

  // Red flash
  const overlay = document.getElementById('damageOverlay') ||
    (() => { const d = document.createElement('div'); d.id='damageOverlay'; document.body.appendChild(d); return d; })();
  overlay.classList.remove('hit');
  void overlay.offsetWidth;
  overlay.classList.add('hit');

  updateHUD();
  if (p.hp <= 0) triggerGameOver();
}

function collectItem(item) {
  item.collected = true;
  spawnParticles(item.x, item.y, item.type === 'health' ? COLORS.health : COLORS.ammo, 8);
  if (item.type === 'health') {
    const heal = 15 + Math.floor(Math.random()*15);
    state.player.hp = Math.min(state.player.maxHp, state.player.hp + heal);
    showMessage(`+${heal} HP`);
  } else if (item.type === 'ammo') {
    const bullets = 6 + Math.floor(Math.random()*8);
    state.ammo[1] += bullets;
    showMessage(`+${bullets} AMMO`);
  } else if (item.type === 'key') {
    state.doorKeys++;
    showMessage(`🗝 KEY FOUND! You have ${state.doorKeys} — press E near a locked door 🔒`);
  }
  state.score += 25;
  updateHUD();
}

/* ──────────────────────────────────────────────
   BULLET UPDATE
────────────────────────────────────────────── */
function updateBullets(dt) {
  for (let i = state.bullets.length - 1; i >= 0; i--) {
    const b = state.bullets[i];
    b.x += b.vx * (dt/16);
    b.y += b.vy * (dt/16);
    b.life--;

    // Wall collision
    if (collidesWithWall(b.x, b.y, 4)) {
      if (b.isBomb) explodeBomb(b);
      spawnParticles(b.x, b.y, b.color, 4);
      state.bullets.splice(i, 1);
      continue;
    }

    if (b.life <= 0) {
      if (b.isBomb) explodeBomb(b);
      state.bullets.splice(i, 1);
      continue;
    }

    // Hit detection
    if (b.fromPlayer) {
      for (let j = state.enemies.length-1; j >= 0; j--) {
        const e = state.enemies[j];
        if (Math.hypot(b.x - e.x, b.y - e.y) < TILE * e.size * 0.6) {
          hurtEnemy(e, b.dmg);
          spawnParticles(b.x, b.y, b.color, 5);
          if (!b.isBomb) { state.bullets.splice(i, 1); break; }
        }
      }
    } else {
      // Enemy bullet
      if (Math.hypot(b.x - state.player.x, b.y - state.player.y) < TILE * 0.4) {
        hurtPlayer(b.dmg);
        spawnParticles(b.x, b.y, COLORS.blood, 5);
        state.bullets.splice(i, 1);
      }
    }
  }
}

function explodeBomb(b) {
  spawnParticles(b.x, b.y, COLORS.bomb, 30);
  spawnParticles(b.x, b.y, '#ffcc00', 20);
  state.enemies.forEach(e => {
    const d = Math.hypot(e.x - b.x, e.y - b.y);
    if (d < TILE * 3) hurtEnemy(e, Math.floor(45 * (1 - d / (TILE*3))));
  });
  const pd = Math.hypot(state.player.x - b.x, state.player.y - b.y);
  if (pd < TILE * 2.5) hurtPlayer(10);
}

/* ──────────────────────────────────────────────
   PARTICLES
────────────────────────────────────────────── */
function spawnParticles(x, y, color, count) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 0.5 + Math.random() * 3;
    state.particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 20 + Math.floor(Math.random() * 25),
      maxLife: 45,
      color,
      size: 1 + Math.random() * 3,
    });
  }
}

function spawnMeleeParticles(p) {
  for (let i = 0; i < 8; i++) {
    const spread = (Math.random() - 0.5) * 1.5;
    const dist = 20 + Math.random() * 20;
    state.particles.push({
      x: p.x + p.facing.x * dist + spread,
      y: p.y + p.facing.y * dist + spread,
      vx: p.facing.x * (1+Math.random()*2) + (Math.random()-0.5)*2,
      vy: p.facing.y * (1+Math.random()*2) + (Math.random()-0.5)*2,
      life: 12, maxLife: 12,
      color: '#ffcc44',
      size: 2 + Math.random() * 2,
    });
  }
}

function spawnMuzzleFlash(p) {
  for (let i = 0; i < 5; i++) {
    state.particles.push({
      x: p.x + p.facing.x * 16,
      y: p.y + p.facing.y * 16,
      vx: p.facing.x * 2 + (Math.random()-0.5)*3,
      vy: p.facing.y * 2 + (Math.random()-0.5)*3,
      life: 8, maxLife: 8,
      color: '#fff',
      size: 3,
    });
  }
}

function updateParticles() {
  for (let i = state.particles.length-1; i >= 0; i--) {
    const p = state.particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vx *= 0.9; p.vy *= 0.9;
    p.life--;
    if (p.life <= 0) state.particles.splice(i, 1);
  }
}

/* ──────────────────────────────────────────────
   COLLISION HELPERS
────────────────────────────────────────────── */
function collidesWithWall(x, y, size) {
  const half = size / 2;
  const corners = [
    [x - half, y - half],
    [x + half, y - half],
    [x - half, y + half],
    [x + half, y + half],
  ];
  for (const [cx, cy] of corners) {
    const tr = Math.floor(cy / TILE);
    const tc = Math.floor(cx / TILE);
    if (tr < 0 || tr >= ROWS || tc < 0 || tc >= COLS) return true;
    const tile = state.map[tr]?.[tc];
    if (tile === TILE_WALL || tile === TILE_DOOR) return true;
  }
  return false;
}

/* ──────────────────────────────────────────────
   HUD & UI
────────────────────────────────────────────── */
function updateHUD() {
  const p = state.player;
  if (!p) return;
  const pct = Math.max(0, p.hp / p.maxHp * 100);
  document.getElementById('hpBar').style.width = pct + '%';
  // Color shift: green → yellow → red
  const r = pct < 50 ? 255 : Math.round(255 * (100-pct)/50);
  const g = pct > 50 ? 255 : Math.round(255 * pct/50);
  document.getElementById('hpBar').style.background = `rgb(${r},${g},0)`;
  document.getElementById('hpText').textContent = Math.max(0, p.hp);
  document.getElementById('scoreText').textContent = String(state.score).padStart(6,'0');
  const ammo = state.ammo[state.weapon];
  document.getElementById('ammoText').textContent = ammo === Infinity ? '∞' : ammo;
  const keyEl = document.getElementById('keyText');
  if (keyEl) {
    keyEl.textContent = state.doorKeys;
    keyEl.style.color = state.doorKeys > 0 ? '#ffe033' : '#555';
  }
}

function showMessage(text) {
  const box = document.getElementById('messageBox');
  const txt = document.getElementById('messageText');
  box.classList.remove('hidden');
  txt.textContent = text;
  box.style.animation = 'none';
  void box.offsetWidth;
  box.style.animation = 'msgFade 3s forwards';
  if (state.msgTimeout) clearTimeout(state.msgTimeout);
  state.msgTimeout = setTimeout(() => box.classList.add('hidden'), 3000);
}

/* ──────────────────────────────────────────────
   MINIMAP
────────────────────────────────────────────── */
const MM_TILE = 5;
function buildMinimap() {
  mmCanvas.width  = COLS * MM_TILE;
  mmCanvas.height = ROWS * MM_TILE;
}

function drawMinimap() {
  const ctx2 = mmCtx;
  ctx2.clearRect(0, 0, mmCanvas.width, mmCanvas.height);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const t = state.map[r][c];
      if (t === TILE_WALL) { ctx2.fillStyle = '#1a0000'; }
      else if (t === TILE_DOOR) { ctx2.fillStyle = '#8B4513'; }
      else if (t === TILE_CHEST){ ctx2.fillStyle = '#8B6914'; }
      else if (t === TILE_EXIT) { ctx2.fillStyle = '#00ff41'; }
      else { ctx2.fillStyle = '#222'; }
      ctx2.fillRect(c*MM_TILE, r*MM_TILE, MM_TILE, MM_TILE);
    }
  }
  // Enemies
  ctx2.fillStyle = '#c0392b';
  for (const e of state.enemies) {
    ctx2.fillRect(
      Math.floor(e.x / TILE) * MM_TILE + 1,
      Math.floor(e.y / TILE) * MM_TILE + 1,
      MM_TILE-2, MM_TILE-2
    );
  }
  // Player
  const p = state.player;
  ctx2.fillStyle = '#00ff41';
  ctx2.fillRect(
    Math.floor(p.x / TILE) * MM_TILE,
    Math.floor(p.y / TILE) * MM_TILE,
    MM_TILE, MM_TILE
  );
}

/* ──────────────────────────────────────────────
   RENDER — Camera-followed top-down view
────────────────────────────────────────────── */
function render() {
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0e0808';
  ctx.fillRect(0, 0, W, H);

  const p = state.player;

  // Camera offset (center on player)
  const camX = p.x - W / 2;
  const camY = p.y - H / 2;

  ctx.save();
  ctx.translate(-camX, -camY);

  // ── Tiles ──
  const startC = Math.max(0, Math.floor(camX / TILE));
  const endC   = Math.min(COLS, Math.ceil((camX + W) / TILE));
  const startR = Math.max(0, Math.floor(camY / TILE));
  const endR   = Math.min(ROWS, Math.ceil((camY + H) / TILE));

  for (let r = startR; r < endR; r++) {
    for (let c = startC; c < endC; c++) {
      const t = state.map[r][c];
      const tx = c * TILE, ty = r * TILE;

      if (t === TILE_WALL) {
        ctx.fillStyle = COLORS.wall;
        ctx.fillRect(tx, ty, TILE, TILE);
        // stone brick shading
        ctx.fillStyle = COLORS.wallEdge;
        ctx.fillRect(tx, ty, TILE, 4);
        ctx.fillRect(tx, ty, 4, TILE);
        // inner corner glint
        ctx.fillStyle = 'rgba(255,180,120,0.07)';
        ctx.fillRect(tx+1, ty+1, TILE-2, 2);
        ctx.fillRect(tx+1, ty+1, 2, TILE-2);
        // dark bottom/right edges
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.fillRect(tx, ty+TILE-3, TILE, 3);
        ctx.fillRect(tx+TILE-3, ty, 3, TILE);
      } else {
        // Checkerboard floor with subtle warm tint
        ctx.fillStyle = (r+c)%2 === 0 ? COLORS.floor : COLORS.floorAlt;
        ctx.fillRect(tx, ty, TILE, TILE);
        // faint floor grid line
        ctx.strokeStyle = 'rgba(120,60,60,0.12)';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(tx, ty, TILE, TILE);
      }

      if (t === TILE_DOOR) {
        ctx.fillStyle = COLORS.door;
        ctx.fillRect(tx+4, ty+4, TILE-8, TILE-8);
        ctx.fillStyle = '#f1c40f';
        ctx.font = `${TILE*0.5}px VT323`;
        ctx.textAlign = 'center';
        ctx.fillText('🔒', tx + TILE/2, ty + TILE*0.7);
      }
      if (t === TILE_CHEST) {
        ctx.fillStyle = COLORS.chest;
        ctx.fillRect(tx+6, ty+8, TILE-12, TILE-14);
        ctx.fillStyle = '#f1c40f';
        ctx.fillRect(tx+6, ty+8, TILE-12, 5);
      }
      if (t === TILE_EXIT) {
        ctx.fillStyle = '#001a00';
        ctx.fillRect(tx, ty, TILE, TILE);
        // Pulsing exit glow
        const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 300);
        ctx.fillStyle = `rgba(0,255,65,${0.15 + pulse*0.2})`;
        ctx.fillRect(tx, ty, TILE, TILE);
        ctx.fillStyle = '#00ff41';
        ctx.font = `${TILE*0.7}px VT323`;
        ctx.textAlign = 'center';
        ctx.fillText('▼', tx + TILE/2, ty + TILE*0.75);
      }
    }
  }

  // ── Items ──
  for (const item of state.items) {
    const t = Date.now();
    const pulse  = 0.5 + 0.5 * Math.sin(t / 350 + item.x);
    const bob    = Math.sin(t / 500 + item.y) * 3;  // gentle up/down float

    ctx.save();

    if (item.type === 'key') {
      // ── Big golden key with strong glow ring ──
      const kr = TILE * 0.38;

      // Outer glow (2 layers for intensity)
      const glow1 = ctx.createRadialGradient(item.x, item.y + bob, 0, item.x, item.y + bob, kr * 2.2);
      glow1.addColorStop(0,   `rgba(255, 220, 0, ${0.35 + pulse * 0.25})`);
      glow1.addColorStop(0.5, `rgba(255, 180, 0, ${0.15 + pulse * 0.1})`);
      glow1.addColorStop(1,   'rgba(255,180,0,0)');
      ctx.fillStyle = glow1;
      ctx.beginPath();
      ctx.arc(item.x, item.y + bob, kr * 2.2, 0, Math.PI * 2);
      ctx.fill();

      // Bright circle background
      ctx.fillStyle = `rgba(40, 30, 0, 0.85)`;
      ctx.beginPath();
      ctx.arc(item.x, item.y + bob, kr, 0, Math.PI * 2);
      ctx.fill();

      // Key icon — drawn large and bright
      ctx.globalAlpha = 0.95;
      ctx.font = `${TILE * 0.50}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🗝', item.x, item.y + bob);

      // Animated sparkle ring
      ctx.strokeStyle = `rgba(255, 215, 0, ${0.6 + pulse * 0.4})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(item.x, item.y + bob, kr * 1.3 + pulse * 2.5, 0, Math.PI * 2);
      ctx.stroke();

      // KEY label below
      ctx.fillStyle = `rgba(255, 215, 0, ${0.7 + pulse * 0.3})`;
      ctx.font = `bold ${TILE * 0.22}px VT323`;
      ctx.textBaseline = 'top';
      ctx.fillText('KEY', item.x, item.y + bob + kr + 2);

    } else if (item.type === 'health') {
      // ── Red heart with glow ──
      const glow = ctx.createRadialGradient(item.x, item.y + bob, 0, item.x, item.y + bob, TILE * 0.8);
      glow.addColorStop(0,   `rgba(255,50,50,${0.25 + pulse * 0.2})`);
      glow.addColorStop(1,   'rgba(255,50,50,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(item.x, item.y + bob, TILE * 0.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.9 + pulse * 0.1;
      ctx.font = `${TILE * 0.65}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('♥', item.x, item.y + bob);

    } else if (item.type === 'ammo') {
      // ── Yellow ammo box ──
      const glow = ctx.createRadialGradient(item.x, item.y + bob, 0, item.x, item.y + bob, TILE * 0.7);
      glow.addColorStop(0,   `rgba(255,200,0,${0.2 + pulse * 0.15})`);
      glow.addColorStop(1,   'rgba(255,200,0,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(item.x, item.y + bob, TILE * 0.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.9 + pulse * 0.1;
      ctx.font = `${TILE * 0.6}px VT323`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = COLORS.ammo;
      ctx.fillText('⊕', item.x, item.y + bob);
    }

    ctx.restore();
  }

  // ── Particles (behind entities) ──
  for (const part of state.particles) {
    const alpha = part.life / part.maxLife;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = part.color;
    ctx.fillRect(part.x - part.size/2, part.y - part.size/2, part.size, part.size);
  }
  ctx.globalAlpha = 1;

  // ── Enemies ──
  for (const e of state.enemies) {
    drawEnemy(e);
  }

  // ── Bullets ──
  for (const b of state.bullets) {
    ctx.save();
    if (b.isBomb) {
      ctx.fillStyle = COLORS.bomb;
      ctx.beginPath();
      ctx.arc(b.x, b.y, 5, 0, Math.PI*2);
      ctx.fill();
      // fuse spark
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(b.x + b.vx*2, b.y + b.vy*2, 2, 0, Math.PI*2);
      ctx.fill();
    } else {
      ctx.fillStyle = b.color;
      ctx.shadowColor = b.color;
      ctx.shadowBlur = 6;
      ctx.fillRect(b.x - 3, b.y - 3, 6, 6);
    }
    ctx.restore();
  }

  // ── Flashlight / Darkness overlay (drawn BEFORE player so player appears on top) ──
  drawDarkness(p, W, H, camX, camY);

  ctx.restore(); // end camera transform

  // ── Player drawn last in screen-space so it's always visible ──
  drawPlayerScreen(p, camX, camY);

  // ── Minimap ──
  drawMinimap();
}

// Offscreen canvas for the darkness mask — created once, resized as needed
let darkCanvas = document.createElement('canvas');
let darkCtx    = darkCanvas.getContext('2d');

function drawDarkness(p, W, H, camX, camY) {
  // Keep offscreen canvas in sync with main canvas size
  if (darkCanvas.width !== W || darkCanvas.height !== H) {
    darkCanvas.width  = W;
    darkCanvas.height = H;
  }

  // Screen-space player position
  const sx = p.x - camX;
  const sy = p.y - camY;
  const angle    = Math.atan2(p.facing.y, p.facing.x);
  const range    = TILE * 11;
  const fovAngle = Math.PI / 1.5;   // 120° cone

  const dc = darkCtx;
  dc.clearRect(0, 0, W, H);

  // Fill solid darkness
  dc.fillStyle = 'rgba(0,0,0,0.72)';
  dc.fillRect(0, 0, W, H);

  // Punch out ambient circle (always-visible zone around player)
  dc.globalCompositeOperation = 'destination-out';
  const ambR = TILE * 3.0;
  const ambG = dc.createRadialGradient(sx, sy, 0, sx, sy, ambR);
  ambG.addColorStop(0,    'rgba(0,0,0,1)');
  ambG.addColorStop(0.5,  'rgba(0,0,0,0.85)');
  ambG.addColorStop(1,    'rgba(0,0,0,0)');
  dc.fillStyle = ambG;
  dc.beginPath();
  dc.arc(sx, sy, ambR, 0, Math.PI * 2);
  dc.fill();

  if (state.flashlight) {
    // Punch out flashlight cone in the facing direction
    const coneG = dc.createRadialGradient(sx, sy, 0, sx, sy, range);
    coneG.addColorStop(0,    'rgba(0,0,0,1)');
    coneG.addColorStop(0.45, 'rgba(0,0,0,0.98)');
    coneG.addColorStop(0.80, 'rgba(0,0,0,0.5)');
    coneG.addColorStop(1,    'rgba(0,0,0,0)');
    dc.fillStyle = coneG;
    dc.beginPath();
    dc.moveTo(sx, sy);
    dc.arc(sx, sy, range, angle - fovAngle, angle + fovAngle);
    dc.closePath();
    dc.fill();
  }

  dc.globalCompositeOperation = 'source-over';

  // Warm torch tint inside cone
  if (state.flashlight) {
    const warmG = dc.createRadialGradient(sx, sy, 0, sx, sy, range * 0.65);
    warmG.addColorStop(0,    'rgba(255, 220, 100, 0.18)');
    warmG.addColorStop(0.4,  'rgba(255, 170,  50, 0.09)');
    warmG.addColorStop(1,    'rgba(0,0,0,0)');
    dc.fillStyle = warmG;
    dc.beginPath();
    dc.moveTo(sx, sy);
    dc.arc(sx, sy, range * 0.65, angle - fovAngle, angle + fovAngle);
    dc.closePath();
    dc.fill();
  }

  // Stamp the finished darkness mask onto the main canvas (no transform needed)
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);  // reset any leftover transform
  ctx.drawImage(darkCanvas, 0, 0);
  ctx.restore();
}

// Draw player in screen space so it always appears on top of darkness
function drawPlayerScreen(p, camX, camY) {
  const x = Math.round(p.x - camX);
  const y = Math.round(p.y - camY);
  const s = TILE * 0.35;
  const blink = p.invincibleTime > 0 && Math.floor(p.invincibleTime / 4) % 2 === 0;
  if (blink) return;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);  // screen space, no camera offset

  // Shadow puddle
  ctx.fillStyle = 'rgba(0,255,65,0.15)';
  ctx.beginPath();
  ctx.ellipse(x, y + s*1.4, s*1.1, s*0.4, 0, 0, Math.PI*2);
  ctx.fill();

  // Body
  ctx.fillStyle = '#006622';
  roundRect(ctx, x - s*0.7, y - s*0.5, s*1.4, s*1.6, 3);
  ctx.fill();

  // Head
  ctx.fillStyle = '#00ee44';
  roundRect(ctx, x - s*0.55, y - s*1.4, s*1.1, s*0.9, 4);
  ctx.fill();

  // Eyes (follow facing direction)
  const ex = x + p.facing.x * s*0.3;
  const ey = y - s*1.0 + p.facing.y * s*0.2;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(ex - s*0.35, ey - s*0.12, s*0.28, s*0.24);
  ctx.fillRect(ex + s*0.08, ey - s*0.12, s*0.28, s*0.24);
  ctx.fillStyle = '#111';
  ctx.fillRect(ex - s*0.22, ey - s*0.1, s*0.14, s*0.2);
  ctx.fillRect(ex + s*0.2,  ey - s*0.1, s*0.14, s*0.2);

  // Weapon indicator
  ctx.strokeStyle = state.weapon === 0 ? '#cccccc' : state.weapon === 1 ? '#aaaaaa' : '#ff8800';
  ctx.lineWidth = 3;
  if (state.weapon === 0) {
    // Blade — line pointing in facing direction
    ctx.beginPath();
    ctx.moveTo(x + p.facing.x * s*0.8, y + p.facing.y * s*0.8 - s*0.2);
    ctx.lineTo(x + p.facing.x * s*2.0, y + p.facing.y * s*2.0 - s*0.2);
    ctx.stroke();
  } else if (state.weapon === 1) {
    // Pistol barrel
    ctx.fillStyle = '#999';
    ctx.fillRect(
      x + p.facing.x * s*0.7 - Math.abs(p.facing.y)*s*0.1,
      y + p.facing.y * s*0.7 - s*0.15 - Math.abs(p.facing.x)*s*0.1,
      p.facing.x !== 0 ? s*0.9 : s*0.25,
      p.facing.y !== 0 ? s*0.9 : s*0.25
    );
  } else {
    // Bomb dot
    ctx.fillStyle = '#ff6600';
    ctx.beginPath();
    ctx.arc(x + p.facing.x * s*1.2, y + p.facing.y * s*1.2, s*0.25, 0, Math.PI*2);
    ctx.fill();
  }

  // Green glow ring around player
  const grd = ctx.createRadialGradient(x, y, s*0.5, x, y, s*2.8);
  grd.addColorStop(0,   'rgba(0,255,65,0.18)');
  grd.addColorStop(1,   'rgba(0,255,65,0)');
  ctx.fillStyle = grd;
  ctx.beginPath();
  ctx.arc(x, y, s*2.8, 0, Math.PI*2);
  ctx.fill();

  ctx.restore();
}

/* ──────────────────────────────────────────────
   PIXEL ART CHARACTERS
────────────────────────────────────────────── */

function drawEnemy(e) {
  const x = Math.round(e.x), y = Math.round(e.y);
  const s = TILE * e.size * 0.4;

  ctx.save();

  // Glow
  const grd = ctx.createRadialGradient(x, y, 0, x, y, s*3);
  grd.addColorStop(0, e.glow);
  grd.addColorStop(1, 'transparent');
  ctx.fillStyle = grd;
  ctx.beginPath();
  ctx.arc(x, y, s*3, 0, Math.PI*2);
  ctx.fill();

  // Body (different per type)
  ctx.fillStyle = e.color;
  if (e.name === 'GHOUL') {
    // Hunched shape
    ctx.beginPath();
    ctx.ellipse(x, y, s*0.9, s*1.3, 0, 0, Math.PI*2);
    ctx.fill();
    // Skull face
    ctx.fillStyle = 'rgba(255,220,200,0.55)';
    ctx.beginPath();
    ctx.arc(x, y - s*0.4, s*0.55, 0, Math.PI*2);
    ctx.fill();
    // Eyes
    ctx.fillStyle = '#ff000088';
    ctx.fillRect(x - s*0.35, y - s*0.6, s*0.22, s*0.18);
    ctx.fillRect(x + s*0.12, y - s*0.6, s*0.22, s*0.18);
  } else if (e.name === 'SPECTER') {
    // Ghost wavy shape
    const bob = Math.sin(Date.now()/400 + e.id) * 3;
    ctx.beginPath();
    ctx.arc(x, y - s*0.3 + bob, s*0.8, Math.PI, 0);
    ctx.lineTo(x + s*0.8, y + s*0.9 + bob);
    ctx.lineTo(x + s*0.4, y + s*0.5 + bob);
    ctx.lineTo(x, y + s*0.9 + bob);
    ctx.lineTo(x - s*0.4, y + s*0.5 + bob);
    ctx.lineTo(x - s*0.8, y + s*0.9 + bob);
    ctx.closePath();
    ctx.globalAlpha = 0.75;
    ctx.fill();
    ctx.globalAlpha = 1;
    // Eyes
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x - s*0.3, y - s*0.3 + bob, s*0.18, 0, Math.PI*2);
    ctx.arc(x + s*0.3, y - s*0.3 + bob, s*0.18, 0, Math.PI*2);
    ctx.fill();
  } else if (e.name === 'REAPER') {
    // Tall cloaked figure
    ctx.beginPath();
    ctx.moveTo(x, y - s*1.6);
    ctx.lineTo(x + s*1.0, y + s*0.8);
    ctx.lineTo(x - s*1.0, y + s*0.8);
    ctx.closePath();
    ctx.fill();
    // Scythe
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y - s*0.5);
    ctx.lineTo(x + s*1.5, y - s*1.5);
    ctx.stroke();
    ctx.strokeStyle = '#aaa';
    ctx.beginPath();
    ctx.arc(x + s*1.5, y - s*1.5, s*0.5, Math.PI, Math.PI*1.7);
    ctx.stroke();
    // Eyes
    ctx.fillStyle = '#ff000099';
    ctx.fillRect(x - s*0.3, y - s*0.9, s*0.22, s*0.14);
    ctx.fillRect(x + s*0.1, y - s*0.9, s*0.22, s*0.14);
  } else {
    // CRAWLER — low crawling shape
    ctx.beginPath();
    ctx.ellipse(x, y + s*0.3, s*1.3, s*0.7, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.fillStyle = '#fff2';
    ctx.fillRect(x - s*0.35, y, s*0.2, s*0.16);
    ctx.fillRect(x + s*0.15, y, s*0.2, s*0.16);
    // legs animation
    const legPhase = Math.sin(Date.now()/100 + e.id) * s*0.3;
    ctx.strokeStyle = e.color;
    ctx.lineWidth = 2;
    for (let li = -1; li <= 1; li += 2) {
      ctx.beginPath();
      ctx.moveTo(x + li * s*0.5, y + s*0.3);
      ctx.lineTo(x + li * (s*1.0 + legPhase), y + s*0.9);
      ctx.stroke();
    }
  }

  // Health bar
  const bw = s * 2.2;
  ctx.fillStyle = '#300';
  ctx.fillRect(x - bw/2, y - s*1.8, bw, 4);
  ctx.fillStyle = '#e74c3c';
  ctx.fillRect(x - bw/2, y - s*1.8, bw * (e.hp/e.maxHp), 4);

  ctx.restore();
}

/* ──────────────────────────────────────────────
   UTILITY — rounded rect
────────────────────────────────────────────── */
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.lineTo(x+w-r, y);
  ctx.arcTo(x+w, y, x+w, y+r, r);
  ctx.lineTo(x+w, y+h-r);
  ctx.arcTo(x+w, y+h, x+w-r, y+h, r);
  ctx.lineTo(x+r, y+h);
  ctx.arcTo(x, y+h, x, y+h-r, r);
  ctx.lineTo(x, y+r);
  ctx.arcTo(x, y, x+r, y, r);
  ctx.closePath();
}

/* ──────────────────────────────────────────────
   GAME LOOP
────────────────────────────────────────────── */
function gameLoop(timestamp) {
  if (!state.running || state.paused) return;
  const dt = Math.min(timestamp - state.lastTime, 50); // cap at 50ms
  state.lastTime = timestamp;

  updatePlayer(dt);
  updateEnemies(dt);
  updateBullets(dt);
  updateParticles();
  render();

  state.animFrame = requestAnimationFrame(gameLoop);
}

/* ──────────────────────────────────────────────
   INIT — Add damage overlay div
────────────────────────────────────────────── */
(function init() {
  const overlay = document.createElement('div');
  overlay.id = 'damageOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9990;background:transparent;';
  document.body.appendChild(overlay);
  showScreen('titleScreen');
})();