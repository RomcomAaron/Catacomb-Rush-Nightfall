/* ══════════════════════════════════════════════
  Catacomb Rush Nighfall — RETRO HORROR GAME ENGINE
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

const SAVE_KEY = 'catacomb-rush-nighfall-save-v1';
let refreshTitleMenuState = () => {};

/* ──────────────────────────────────────────────
   TITLE SCREEN MENU NAVIGATION
────────────────────────────────────────────── */
(function initMenu() {
  const items = Array.from(document.querySelectorAll('#titleScreen .menu-item'));
  const continueItem = document.getElementById('menuContinue');
  let selectedIndex = 0;

  function selectableIndexes() {
    return items
      .map((el, i) => (el.classList.contains('disabled') ? -1 : i))
      .filter(i => i >= 0);
  }

  function updateSelection() {
    const selectable = selectableIndexes();
    if (!selectable.includes(selectedIndex)) selectedIndex = selectable[0] ?? 0;
    items.forEach((el, i) => {
      el.classList.toggle('selected', i === selectedIndex);
    });
  }

  function moveSelection(delta) {
    const selectable = selectableIndexes();
    if (selectable.length === 0) return;
    let pos = selectable.indexOf(selectedIndex);
    if (pos === -1) pos = 0;
    pos = (pos + delta + selectable.length) % selectable.length;
    selectedIndex = selectable[pos];
    updateSelection();
  }

  function activateSelection() {
    const el = items[selectedIndex];
    if (!el || el.classList.contains('disabled')) return;
    if (el.id === 'menuStart') startGame();
    else if (el.id === 'menuContinue') continueGame();
    else if (el.id === 'menuControls') showScreen('controlsScreen');
    else if (el.id === 'menuCredits') showScreen('creditsScreen');
  }

  refreshTitleMenuState = function refreshTitleMenu() {
    const hasSave = hasSavedProgress();
    continueItem.classList.toggle('disabled', !hasSave);
    updateSelection();
  };

  refreshTitleMenuState();

  document.addEventListener('keydown', e => {
    if (!document.getElementById('titleScreen').classList.contains('active')) return;

    if (e.key === 'ArrowDown' || e.key === 's') {
      moveSelection(1);
    }
    if (e.key === 'ArrowUp' || e.key === 'w') {
      moveSelection(-1);
    }
    if (e.key === 'Enter') {
      activateSelection();
    }
  });

  document.getElementById('menuContinue').addEventListener('click', continueGame);
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
const MAX_FLOOR = 67;

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

const MEDKIT_HEAL = 22;
const COMBO_WINDOW_MS = 2200;
const BLOOD_MOON_MIN_COOLDOWN = 18000;
const BLOOD_MOON_MAX_COOLDOWN = 32000;
const BLOOD_MOON_DURATION = 12000;

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
  medkits:     0,
  levelMedkitsCollected: 0,
  levelMedkitCap: 1,
  comboCount: 0,
  comboTimer: 0,
  comboMultiplier: 1,
  relicName: 'NONE',
  relicTimer: 0,
  bloodMoonActive: false,
  bloodMoonTimer: 0,
  bloodMoonCooldown: 0,
  lastTime:    0,
  msgTimeout:  null,
  doorKeys:    0,
  retrySnapshot: null,
  animFrame:   null,
  lastSaveTime: 0,
};

function hasSavedProgress() {
  try {
    return !!localStorage.getItem(SAVE_KEY);
  } catch {
    return false;
  }
}

function encodeAmmo(ammo) {
  return ammo.map(v => (v === Infinity ? 'INF' : v));
}

function decodeAmmo(ammo) {
  const fallback = [Infinity, 20, 3];
  if (!Array.isArray(ammo) || ammo.length < 3) return fallback;
  return ammo.slice(0, 3).map((v, i) => {
    if (v === 'INF') return Infinity;
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : fallback[i];
  });
}

function saveProgress() {
  if (!state.player || !state.map.length) return;
  const payload = {
    version: 1,
    floor: state.floor,
    score: state.score,
    map: state.map,
    player: state.player,
    enemies: state.enemies,
    items: state.items,
    weapon: state.weapon,
    ammo: encodeAmmo(state.ammo),
    medkits: state.medkits,
    levelMedkitsCollected: state.levelMedkitsCollected,
    levelMedkitCap: state.levelMedkitCap,
    comboCount: state.comboCount,
    comboTimer: state.comboTimer,
    comboMultiplier: state.comboMultiplier,
    relicName: state.relicName,
    relicTimer: state.relicTimer,
    bloodMoonActive: state.bloodMoonActive,
    bloodMoonTimer: state.bloodMoonTimer,
    bloodMoonCooldown: state.bloodMoonCooldown,
    doorKeys: state.doorKeys,
    flashlight: state.flashlight,
    timestamp: Date.now(),
  };
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
    refreshTitleMenuState();
  } catch {
    // Ignore save failures (private mode, quota, etc.)
  }
}

function clearSavedProgress() {
  try {
    localStorage.removeItem(SAVE_KEY);
    refreshTitleMenuState();
  } catch {
    // Ignore clear failures.
  }
}

function loadSavedProgress() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    if (!Array.isArray(data.map) || !Array.isArray(data.enemies) || !Array.isArray(data.items)) return null;
    if (!data.player || typeof data.player !== 'object') return null;
    return data;
  } catch {
    return null;
  }
}

function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

function resetCombo() {
  state.comboCount = 0;
  state.comboTimer = 0;
  state.comboMultiplier = 1;
}

function registerKillCombo() {
  if (state.comboTimer > 0) state.comboCount++;
  else state.comboCount = 1;
  state.comboTimer = COMBO_WINDOW_MS;
  state.comboMultiplier = 1 + Math.min(1.5, (state.comboCount - 1) * 0.2);
}

function addScore(base) {
  const moonMul = state.bloodMoonActive ? 1.25 : 1;
  const relicMul = state.relicName === 'GREED' ? 1.35 : 1;
  const gained = Math.floor(base * state.comboMultiplier * moonMul * relicMul);
  state.score += gained;
  return gained;
}

function activateRelic(name, durationMs) {
  state.relicName = name;
  state.relicTimer = durationMs;
  showMessage(`${name} RELIC AWAKENS!`);
  updateHUD();
}

function updateStatusSystems(dt) {
  if (state.comboTimer > 0) {
    state.comboTimer -= dt;
    if (state.comboTimer <= 0) resetCombo();
  }

  if (state.relicTimer > 0) {
    state.relicTimer -= dt;
    if (state.relicTimer <= 0) {
      state.relicName = 'NONE';
      state.relicTimer = 0;
      showMessage('RELIC FADES...');
    }
  }

  if (state.bloodMoonActive) {
    state.bloodMoonTimer -= dt;
    if (state.bloodMoonTimer <= 0) {
      state.bloodMoonActive = false;
      state.bloodMoonTimer = 0;
      state.bloodMoonCooldown = randomRange(BLOOD_MOON_MIN_COOLDOWN, BLOOD_MOON_MAX_COOLDOWN);
      showMessage('BLOOD MOON SETS');
    }
  } else {
    state.bloodMoonCooldown -= dt;
    if (state.bloodMoonCooldown <= 0) {
      state.bloodMoonActive = true;
      state.bloodMoonTimer = BLOOD_MOON_DURATION;
      showMessage('BLOOD MOON RISES!');
    }
  }
}

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
function placeDoorsSafe(map, floor, exitPos) {
  const doorKeyPairs = [];   // [{door:{r,c}, key:{r,c}}]
  const maxDoors = Math.min(10, 3 + Math.floor(floor / 6));
  const keyTaken = new Set();

  // Collect corridor chokepoints that are not too close to start/exit.
  const candidates = [];
  for (let r = 2; r < ROWS - 2; r++) {
    for (let c = 2; c < COLS - 2; c++) {
      if (map[r][c] !== TILE_EMPTY) continue;
      if (Math.abs(r - 1) + Math.abs(c - 1) < 4) continue;
      if (Math.abs(r - exitPos.r) + Math.abs(c - exitPos.c) < 3) continue;
      if (isDoorChokepoint(map, r, c)) candidates.push({ r, c });
    }
  }

  // Place one dedicated final escape door on the start->exit route.
  const path = findPath(map, { r: 1, c: 1 }, exitPos, false);
  const pathChokes = path
    .filter(cell => map[cell.r][cell.c] === TILE_EMPTY)
    .filter(cell => isDoorChokepoint(map, cell.r, cell.c))
    .filter(cell => Math.abs(cell.r - 1) + Math.abs(cell.c - 1) > 3)
    .filter(cell => Math.abs(cell.r - exitPos.r) + Math.abs(cell.c - exitPos.c) > 1);

  if (pathChokes.length) {
    const startIdx = Math.max(0, Math.floor(pathChokes.length * 0.55));
    const finalDoor = pathChokes[startIdx + Math.floor(Math.random() * Math.max(1, pathChokes.length - startIdx))];
    map[finalDoor.r][finalDoor.c] = TILE_DOOR;

    const reachable = floodFill(map, 1, 1, TILE_DOOR);
    const keyCell = randomReachableEmpty(reachable, map, finalDoor, keyTaken);
    if (keyCell) {
      doorKeyPairs.push({ door: finalDoor, key: keyCell });
      keyTaken.add(`${keyCell.r},${keyCell.c}`);
    } else {
      // Fallback if no legal key location is found.
      map[finalDoor.r][finalDoor.c] = TILE_EMPTY;
    }
  }

  // Add extra doors and always place each key on the currently reachable side.
  for (const door of shuffle(candidates)) {
    if (doorKeyPairs.length >= maxDoors) break;
    if (map[door.r][door.c] !== TILE_EMPTY) continue;
    if (isTooCloseToPlacedDoor(door, doorKeyPairs.map(pair => pair.door))) continue;

    map[door.r][door.c] = TILE_DOOR;
    const reachable = floodFill(map, 1, 1, TILE_DOOR);
    const keyCell = randomReachableEmpty(reachable, map, door, keyTaken);
    if (!keyCell) {
      map[door.r][door.c] = TILE_EMPTY;
      continue;
    }
    doorKeyPairs.push({ door, key: keyCell });
    keyTaken.add(`${keyCell.r},${keyCell.c}`);
  }

  return doorKeyPairs;
}

function isTooCloseToPlacedDoor(door, placedDoors) {
  for (const d of placedDoors) {
    const manhattan = Math.abs(door.r - d.r) + Math.abs(door.c - d.c);
    if (manhattan <= 2) return true;
  }
  return false;
}

function isDoorChokepoint(map, r, c) {
  const n = map[r - 1][c] !== TILE_WALL;
  const s = map[r + 1][c] !== TILE_WALL;
  const w = map[r][c - 1] !== TILE_WALL;
  const e = map[r][c + 1] !== TILE_WALL;
  const passCount = [n, s, w, e].filter(Boolean).length;
  return passCount === 2 && ((n && s && !w && !e) || (w && e && !n && !s));
}

function randomReachableEmpty(reachableSet, map, door, takenKeys = new Set()) {
  const options = [];
  for (const cellKey of reachableSet) {
    const [r, c] = cellKey.split(',').map(Number);
    if (map[r][c] !== TILE_EMPTY) continue;
    if (takenKeys.has(`${r},${c}`)) continue;
    const dist = Math.abs(r - door.r) + Math.abs(c - door.c);
    if (dist >= 4) options.push({ r, c });
  }
  if (!options.length) return null;
  // Prefer farther key placements to reduce "door right next to key" feel.
  options.sort((a, b) => {
    const da = Math.abs(a.r - door.r) + Math.abs(a.c - door.c);
    const db = Math.abs(b.r - door.r) + Math.abs(b.c - door.c);
    return db - da;
  });
  const top = options.slice(0, Math.max(1, Math.floor(options.length * 0.5)));
  return top[Math.floor(Math.random() * top.length)];
}

function findPath(map, start, end, blockDoors = true) {
  const queue = [[start.r, start.c]];
  const visited = new Set([`${start.r},${start.c}`]);
  const parent = new Map();

  while (queue.length) {
    const [r, c] = queue.shift();
    if (r === end.r && c === end.c) break;
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) continue;
      const tile = map[nr][nc];
      if (tile === TILE_WALL) continue;
      if (blockDoors && tile === TILE_DOOR) continue;
      const key = `${nr},${nc}`;
      if (visited.has(key)) continue;
      visited.add(key);
      parent.set(key, `${r},${c}`);
      queue.push([nr, nc]);
    }
  }

  const endKey = `${end.r},${end.c}`;
  if (!visited.has(endKey)) return [];
  const path = [];
  let cur = endKey;
  while (cur) {
    const [r, c] = cur.split(',').map(Number);
    path.push({ r, c });
    cur = parent.get(cur);
  }
  path.reverse();
  return path;
}

function findExitCell(map) {
  // Pick a far empty cell so the escape door isn't always in the same place.
  const candidates = [];
  for (let r = 1; r < ROWS - 1; r++) {
    for (let c = 1; c < COLS - 1; c++) {
      if (map[r][c] !== TILE_EMPTY) continue;
      if (r <= 2 && c <= 2) continue;
      const dist = Math.abs(r - 1) + Math.abs(c - 1);
      candidates.push({ r, c, dist });
    }
  }
  if (!candidates.length) return { r: ROWS - 2, c: COLS - 2 };

  candidates.sort((a, b) => b.dist - a.dist);
  const top = candidates.slice(0, Math.max(1, Math.floor(candidates.length * 0.25)));
  const pick = top[Math.floor(Math.random() * top.length)];
  return { r: pick.r, c: pick.c };
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
    slashTimer: 0,
    invincibleTime: 0,
    frame: 0,
    frameTimer: 0,
  };
}

/* ──────────────────────────────────────────────
   ENEMY FACTORY
────────────────────────────────────────────── */
const ENEMY_TYPES = [
  { name: 'GHOUL',   color: '#cc2200', glow: 'rgba(200,40,0,0.6)',    hp: 30, spd: 1.3,  dmg: 12, score: 120, size: 0.62, behavior: 'aggressive', chaseBias: 0.9,  meleeRange: 0.9 },
  { name: 'SPECTER', color: '#aa44ff', glow: 'rgba(170,68,255,0.6)',  hp: 18, spd: 2.0,  dmg: 6,  score: 170, size: 0.55, behavior: 'ranged',     chaseBias: 0.5,  meleeRange: 0.65, preferredRange: TILE * 3.2, shootRange: TILE * 8.5 },
  { name: 'REAPER',  color: '#4444cc', glow: 'rgba(80,80,220,0.65)',  hp: 75, spd: 0.75, dmg: 28, score: 340, size: 0.82, behavior: 'ambush',     chaseBias: 0.45, meleeRange: 1.0 },
  { name: 'CRAWLER', color: '#55aa00', glow: 'rgba(80,160,0,0.55)',   hp: 40, spd: 0.9,  dmg: 16, score: 220, size: 0.5,  behavior: 'aggressive', chaseBias: 0.85, meleeRange: 1.1, retreatRange: TILE * 2.1 },
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
      spd: type.spd * (0.9 + Math.random() * 0.3) * (1 + Math.min(floor, MAX_FLOOR) * 0.006),
      dmg: Math.floor(type.dmg * (0.9 + Math.random() * 0.25) * (1 + Math.min(floor, MAX_FLOOR) * 0.01)),
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

  // Extra random pickups (health is intentionally scarce)
  const extras = Math.floor(4 + state.floor * 1.5);
  let healthPlaced = 0;
  const maxHealthSpawns = Math.max(0, state.levelMedkitCap - state.levelMedkitsCollected);
  for (let i = 0; i < extras; i++) {
    const pos = randomEmpty(map);
    if (!pos) continue;
    const roll = Math.random();
    let type = 'ammo';
    if (healthPlaced < maxHealthSpawns && roll < 0.14) {
      type = 'health';
      healthPlaced++;
    }
    items.push({
      x: pos.c * TILE + TILE / 2,
      y: pos.r * TILE + TILE / 2,
      type,
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
  clearSavedProgress();
  state.retrySnapshot = null;
  state.floor  = 1;
  state.score  = 0;
  state.weapon = 0;
  state.ammo   = [Infinity, 20, 3];
  state.medkits = 0;
  state.levelMedkitsCollected = 0;
  state.levelMedkitCap = 1;
  resetCombo();
  state.relicName = 'NONE';
  state.relicTimer = 0;
  state.bloodMoonActive = false;
  state.bloodMoonTimer = 0;
  state.bloodMoonCooldown = randomRange(BLOOD_MOON_MIN_COOLDOWN, BLOOD_MOON_MAX_COOLDOWN);
  state.doorKeys = 0;
  resetGame(false);
  buildLevel();
  showScreen('gameScreen');
  resizeCanvas();
  state.running = true;
  state.paused  = false;
  state.lastTime = performance.now();
  state.lastSaveTime = state.lastTime;
  state.animFrame = requestAnimationFrame(gameLoop);
  updateHUD();
}

function retryFromDeath() {
  const snap = state.retrySnapshot;
  if (!snap) {
    startGame();
    return;
  }

  if (state.animFrame) cancelAnimationFrame(state.animFrame);
  resetGame(false);

  state.floor = Math.min(Math.max(1, snap.floor), MAX_FLOOR);
  state.score = Math.max(0, snap.score);
  state.weapon = Math.min(2, Math.max(0, snap.weapon));
  state.ammo = decodeAmmo(encodeAmmo(snap.ammo));
  state.medkits = Math.max(0, snap.medkits);
  state.flashlight = snap.flashlight !== false;
  state.doorKeys = 0;

  buildLevel();
  showScreen('gameScreen');
  resizeCanvas();
  state.running = true;
  state.paused = false;
  state.lastTime = performance.now();
  state.lastSaveTime = state.lastTime;
  selectWeapon(state.weapon);
  document.getElementById('flashlightStatus').textContent = state.flashlight ? 'ON' : 'OFF';
  updateHUD();
  state.animFrame = requestAnimationFrame(gameLoop);
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
  state.levelMedkitsCollected = 0;
  state.levelMedkitCap = 1;
  resetCombo();
  state.relicName = 'NONE';
  state.relicTimer = 0;
  state.bloodMoonActive = false;
  state.bloodMoonTimer = 0;
  state.bloodMoonCooldown = randomRange(BLOOD_MOON_MIN_COOLDOWN, BLOOD_MOON_MAX_COOLDOWN);
}

function buildLevel() {
  state.floor = Math.min(state.floor, MAX_FLOOR);
  state.levelMedkitsCollected = 0;
  state.levelMedkitCap = Math.min(2, 1 + Math.floor((state.floor - 1) / 25));
  resetCombo();
  state.relicName = 'NONE';
  state.relicTimer = 0;
  state.bloodMoonActive = false;
  state.bloodMoonTimer = 0;
  state.bloodMoonCooldown = randomRange(BLOOD_MOON_MIN_COOLDOWN, BLOOD_MOON_MAX_COOLDOWN);
  state.map          = generateMap(state.floor);
  const exitPos = findExitCell(state.map);
  state.map[exitPos.r][exitPos.c] = TILE_EXIT;
  // Place doors safely and get matching key positions
  const doorKeyPairs = placeDoorsSafe(state.map, state.floor, exitPos);
  state.player       = createPlayer();
  state.enemies      = spawnEnemies(state.map, state.floor);
  state.items        = spawnItems(state.map, doorKeyPairs);
  state.bullets      = [];
  state.particles    = [];
  document.getElementById('floorLabel').textContent =
    `FLOOR ${state.floor} — ${FLOOR_NAMES[state.floor - 1] || `DEPTH ${state.floor}`}`;
  buildMinimap();
}

const FLOOR_NAMES = [
  'THE CATACOMBS',
  'BONE CORRIDOR',
  'SHADOW LAIR',
  'THE ABYSS',
  'CRYPTS BELOW',
  'WAILING HALLS',
  'THE SANCTUM',
  'FINAL DESCENT',
  'ASHEN GATE',
  'BROKEN ALTAR',
  'HOLLOW STAIRS',
  'THE BLACK CHAPEL',
  'THORNED VAULT',
  'DREAD ANTECHAMBER',
  'RUSTED OSSUARY',
  'CANDLELESS NAVE',
  'MOURNERS PASSAGE',
  'THE SUNKEN CRYPT',
  'WHISPER TUNNELS',
  'VEIL OF DUST',
  'HUNGER CELLAR',
  'THE IRON MAZE',
  'CHAINED GALLERY',
  'LANTERN GRAVE',
  'THE FALLEN CHOIR',
  'COLD EMBER HALL',
  'TOMB OF ECHOES',
  'BLEAK ROTUNDA',
  'MOONLESS COURT',
  'GRIEVING ARCH',
  'BASILISK STAIRS',
  'THE SHIVERING WARD',
  'BROOD NEST',
  'BLACKWATER KEEP',
  'THE FORGOTTEN WELL',
  'MIRRORLESS ROOM',
  'HUSK CHAMBER',
  'THE BLEEDING WALL',
  'SALTED RELIQUARY',
  'NIGHTBELL HALL',
  'THE CINDER VEIL',
  'CRUMBLING APSE',
  'LOCKED THRESHOLD',
  'RAVEN BASTION',
  'GRANITE SILENCE',
  'THE DEEPING SPIRAL',
  'SAINTLESS SHRINE',
  'GLASSBONE CORRIDOR',
  'THE GLOAM PIT',
  'EMBERLESS KILN',
  'WOLF PRAYER HALL',
  'THE RUINED CROWN',
  'SCARLET CATACOMB',
  'HARBOR OF SHADES',
  'THIRTEENTH ARCH',
  'THE GATE OF THORNS',
  'ASHCRYPT CROSSING',
  'THE LAST VESTIBULE',
  'DIRGE PROMENADE',
  'PENITENT VAULT',
  'THE GREAT OSSUARY',
  'OBSIDIAN PASS',
  'THE SILENT WELLSPRING',
  'KING WITHOUT LIGHT',
  'FINAL PROCESSION',
  'THE NIGHFALL THRONE',
  'FLOOR 67: END OF NIGHFALL',
];

function nextLevel() {
  if (state.floor >= MAX_FLOOR) {
    showScreen('titleScreen');
    return;
  }
  state.floor++;
  buildLevel();
  showScreen('gameScreen');
  state.running = true;
  state.paused  = false;
  state.lastTime = performance.now();
  state.lastSaveTime = state.lastTime;
  state.animFrame = requestAnimationFrame(gameLoop);
  updateHUD();
}

function continueGame() {
  const save = loadSavedProgress();
  if (!save) {
    refreshTitleMenuState();
    return;
  }

  if (state.animFrame) cancelAnimationFrame(state.animFrame);
  resetGame(false);

  const defaultPlayer = createPlayer();
  state.floor = Math.min(Math.max(1, Number(save.floor) || 1), MAX_FLOOR);
  state.score = Math.max(0, Math.floor(Number(save.score) || 0));
  state.map = save.map;
  state.player = {
    ...defaultPlayer,
    ...save.player,
    facing: {
      ...defaultPlayer.facing,
      ...(save.player.facing || {}),
    },
  };
  state.enemies = save.enemies;
  state.items = save.items;
  state.weapon = Math.min(2, Math.max(0, Math.floor(Number(save.weapon) || 0)));
  state.ammo = decodeAmmo(save.ammo);
  state.medkits = Math.max(0, Math.floor(Number(save.medkits) || 0));
  state.levelMedkitsCollected = Math.max(0, Math.floor(Number(save.levelMedkitsCollected) || 0));
  state.levelMedkitCap = Math.max(1, Math.floor(Number(save.levelMedkitCap) || 1));
  state.comboCount = Math.max(0, Math.floor(Number(save.comboCount) || 0));
  state.comboTimer = Math.max(0, Number(save.comboTimer) || 0);
  state.comboMultiplier = Math.max(1, Number(save.comboMultiplier) || 1);
  state.relicName = typeof save.relicName === 'string' ? save.relicName : 'NONE';
  state.relicTimer = Math.max(0, Number(save.relicTimer) || 0);
  state.bloodMoonActive = !!save.bloodMoonActive;
  state.bloodMoonTimer = Math.max(0, Number(save.bloodMoonTimer) || 0);
  state.bloodMoonCooldown = Math.max(0, Number(save.bloodMoonCooldown) || randomRange(BLOOD_MOON_MIN_COOLDOWN, BLOOD_MOON_MAX_COOLDOWN));
  state.doorKeys = Math.max(0, Math.floor(Number(save.doorKeys) || 0));
  state.flashlight = save.flashlight !== false;
  state.bullets = [];
  state.particles = [];

  buildMinimap();
  resizeCanvas();
  showScreen('gameScreen');
  state.running = true;
  state.paused = false;
  state.lastTime = performance.now();
  state.lastSaveTime = state.lastTime;
  selectWeapon(state.weapon);
  document.getElementById('flashlightStatus').textContent = state.flashlight ? 'ON' : 'OFF';
  updateHUD();
  state.animFrame = requestAnimationFrame(gameLoop);
}

function resumeGame() {
  state.paused = false;
  showScreen('gameScreen');
  state.lastTime = performance.now();
  state.lastSaveTime = state.lastTime;
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

  const rageMul = state.relicName === 'RAGE' ? 1.55 : 1;
  const cooldownMul = state.relicName === 'RAGE' ? 0.75 : 1;

  if (state.weapon === 0) {
    // BLADE — melee arc
    p.attackCooldown = Math.max(8, Math.round(25 * cooldownMul));
    p.slashTimer = 8;
    meleeHit(p, 60, Math.floor(20 * rageMul));
  } else if (state.weapon === 1) {
    // PISTOL
    if (state.ammo[1] <= 0) { showMessage('NO AMMO!'); return; }
    state.ammo[1]--;
    p.attackCooldown = Math.max(8, Math.round(18 * cooldownMul));
    fireBullet(p, p.facing.x, p.facing.y, 6, Math.floor(15 * rageMul), COLORS.bullet, 'hex');
    spawnMuzzleFlash(p);
  } else if (state.weapon === 2) {
    // BOMB
    if (state.ammo[2] <= 0) { showMessage('NO BOMBS!'); return; }
    state.ammo[2]--;
    p.attackCooldown = Math.max(20, Math.round(60 * cooldownMul));
    throwBomb(p, rageMul);
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

function fireBullet(p, dx, dy, speed, dmg, color, style = 'normal') {
  const len = Math.hypot(dx, dy) || 1;
  state.bullets.push({
    x: p.x, y: p.y,
    vx: dx/len * speed, vy: dy/len * speed,
    dmg, color,
    style,
    life: 80,
    fromPlayer: true,
  });
}

function throwBomb(p, powerMul = 1) {
  state.bullets.push({
    x: p.x, y: p.y,
    vx: p.facing.x * 3, vy: p.facing.y * 3,
    dmg: 0,
    color: COLORS.bomb,
    life: 50,
    isBomb: true,
    powerMul,
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
  const nearbyDoors = [];

  for (const [dr, dc] of neighbors) {
    const r = pr + dr, c = pc + dc;
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) continue;
    const tile = state.map[r][c];
    if (tile === TILE_DOOR) {
      nearbyDoors.push({ r, c, d: Math.abs(dr) + Math.abs(dc) });
      continue;
    }
    if (tile === TILE_CHEST) {
      state.map[r][c] = TILE_EMPTY; // mark opened
      const reward = Math.random();
      if (reward < 0.3) {
        const heal = 10 + Math.floor(Math.random()*12);
        p.hp = Math.min(p.maxHp, p.hp + heal);
        showMessage(`+${heal} HP!`);
      } else if (reward < 0.62) {
        const bullets = 8 + Math.floor(Math.random()*10);
        state.ammo[1] += bullets;
        showMessage(`+${bullets} AMMO!`);
      } else if (reward < 0.85) {
        state.ammo[2] += 1;
        showMessage('+1 BOMB!');
      } else {
        const relic = ['RAGE', 'SWIFT', 'GREED'][Math.floor(Math.random() * 3)];
        activateRelic(relic, 15000);
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

  if (nearbyDoors.length) {
    nearbyDoors.sort((a, b) => a.d - b.d);
    const door = nearbyDoors[0];
    if (state.doorKeys > 0) {
      state.doorKeys--;
      state.map[door.r][door.c] = TILE_EMPTY;
      showMessage(`DOOR UNLOCKED! (${state.doorKeys} KEYS LEFT)`);
      spawnParticles(door.c*TILE+TILE/2, door.r*TILE+TILE/2, '#f1c40f', 12);
      updateHUD();
    } else {
      showMessage('NEED A KEY!');
    }
  }
}

function tryUseItem() {
  // R key: consume one medkit
  const p = state.player;
  if (p.hp >= p.maxHp) { showMessage('HP FULL'); return; }
  if (state.medkits <= 0) { showMessage('NO MEDKITS'); return; }
  state.medkits--;
  p.hp = Math.min(p.maxHp, p.hp + MEDKIT_HEAL);
  showMessage(`USED MEDKIT +${MEDKIT_HEAL} HP (${state.medkits} LEFT)`);
  updateHUD();
}

/* ──────────────────────────────────────────────
   LEVEL COMPLETE / GAME OVER
────────────────────────────────────────────── */
function triggerLevelComplete() {
  state.running = false;
  cancelAnimationFrame(state.animFrame);
  saveProgress();
  document.getElementById('lcScore').textContent = state.score;

  const isFinalFloor = state.floor >= MAX_FLOOR;
  const lcTitle = document.getElementById('lcTitle');
  const lcSub = document.getElementById('lcSub');
  const nextBtn = document.getElementById('nextFloorBtn');
  if (lcTitle) lcTitle.textContent = isFinalFloor ? 'FINAL FLOOR CLEARED' : 'FLOOR CLEARED';
  if (lcSub) lcSub.textContent = isFinalFloor ? 'YOU CONQUERED ALL 67 FLOORS' : 'YOU DESCEND DEEPER...';
  if (nextBtn) {
    nextBtn.textContent = isFinalFloor ? '◄ MAIN MENU' : '► NEXT FLOOR';
    nextBtn.onclick = isFinalFloor
      ? () => { showScreen('titleScreen'); resetGame(); }
      : () => nextLevel();
  }

  showScreen('levelCompleteScreen');
}

function triggerGameOver() {
  state.running = false;
  cancelAnimationFrame(state.animFrame);
  state.retrySnapshot = {
    floor: state.floor,
    score: state.score,
    weapon: state.weapon,
    ammo: [...state.ammo],
    medkits: state.medkits,
    flashlight: state.flashlight,
  };
  clearSavedProgress();
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
  addScore(e.score);
  registerKillCombo();
  spawnParticles(e.x, e.y, COLORS.blood, 18);
  spawnParticles(e.x, e.y, e.color, 8);
  state.enemies = state.enemies.filter(en => en !== e);
  // Health drops are rare and capped per level.
  if (state.levelMedkitsCollected < state.levelMedkitCap && Math.random() < 0.08) {
    state.items.push({ x: e.x, y: e.y, type: 'health', collected: false });
  }
  updateHUD();
}

function updateEnemies(dt) {
  const p = state.player;
  const moonSpeedMul = state.bloodMoonActive ? 1.2 : 1;
  const moonDamageMul = state.bloodMoonActive ? 1.25 : 1;
  for (const e of state.enemies) {
    if (e.attackCooldown > 0) e.attackCooldown--;
    e.stateTimer++;

    const dx = p.x - e.x, dy = p.y - e.y;
    const dist = Math.hypot(dx, dy);
    const safeDist = Math.max(dist, 0.0001);
    const dirX = dx / safeDist;
    const dirY = dy / safeDist;
    const meleeThreshold = TILE * (e.meleeRange || 0.8);

    // State machine: behavior-specific detection and pursuit
    let shouldChase = false;
    if (dist < e.alertRange) {
      if (e.behavior === 'aggressive') {
        shouldChase = dist < TILE * 2.4 || Math.random() < e.chaseBias;
      } else if (e.behavior === 'ambush') {
        shouldChase = dist < e.alertRange * 0.65 || (e.stateTimer % 220 < 60);
      } else if (e.behavior === 'ranged') {
        shouldChase = dist > (e.preferredRange || TILE * 3) && Math.random() < e.chaseBias;
      } else if (e.behavior === 'skittish') {
        // Skittish units normally keep distance, but still engage when very close.
        shouldChase = dist < meleeThreshold * 1.6 || (dist > (e.retreatRange || TILE * 2) && Math.random() < e.chaseBias);
      } else {
        shouldChase = true;
      }
    }
    e.state = shouldChase ? 'chase' : 'idle';

    if (e.state === 'chase') {
      // Move with behavior-aware direction.
      let moveX = dirX;
      let moveY = dirY;
      if (e.behavior === 'ranged' && dist < (e.preferredRange || TILE * 3)) {
        moveX = -dirX;
        moveY = -dirY;
      }
      if (e.behavior === 'skittish' && dist < (e.retreatRange || TILE * 2)) {
        moveX = -dirX;
        moveY = -dirY;
      }

      const behaviorSpeed =
        e.behavior === 'aggressive' ? 1.15 :
        e.behavior === 'ranged' ? 0.95 :
        e.behavior === 'ambush' ? 1.05 : 1;
      const spd = e.spd * behaviorSpeed * moonSpeedMul * (dt / 16);
      let nx = e.x + moveX * spd;
      let ny = e.y + moveY * spd;

      // wall slide
      if (collidesWithWall(nx, e.y, e.size * TILE)) nx = e.x;
      if (collidesWithWall(e.x, ny, e.size * TILE)) ny = e.y;
      if (collidesWithWall(nx, e.y, e.size * TILE) && collidesWithWall(e.x, ny, e.size * TILE)) {
        // try random step
        nx = e.x + (Math.random()-0.5)*2;
        ny = e.y + (Math.random()-0.5)*2;
      }
      e.x = nx; e.y = ny;

    } else {
      // Idle wander
      if (e.stateTimer % 120 === 0) {
        e.vx = (Math.random()-0.5) * 1.2;
        e.vy = (Math.random()-0.5) * 1.2;
      }
      const nx = e.x + e.vx;
      const ny = e.y + e.vy;
      if (!collidesWithWall(nx, e.y, e.size * TILE)) e.x = nx; else e.vx *= -1;
      if (!collidesWithWall(e.x, ny, e.size * TILE)) e.y = ny; else e.vy *= -1;
    }

    // Melee attack check for all non-ranged enemies, regardless of current movement state.
    const postDx = p.x - e.x;
    const postDy = p.y - e.y;
    const postDist = Math.hypot(postDx, postDy);
    if (e.name === 'SPECTER' && e.attackCooldown <= 0) {
      if (postDist < TILE * 0.9) {
        e.attackCooldown = 45;
        hurtPlayer(Math.max(3, Math.floor(e.dmg * 0.8 * moonDamageMul)), e);
      } else {
        const postSafeDist = Math.max(postDist, 0.0001);
        const shotX = postDx / postSafeDist;
        const shotY = postDy / postSafeDist;
        e.attackCooldown = 80;
        fireBullet({ x: e.x, y: e.y, facing: { x: shotX, y: shotY } },
          shotX, shotY, 3.5, Math.floor(8 * moonDamageMul), e.color, 'specter');
        state.bullets[state.bullets.length-1].fromPlayer = false;
      }
    }
    if (e.name !== 'SPECTER' && postDist < meleeThreshold && e.attackCooldown <= 0) {
      e.attackCooldown = e.behavior === 'skittish' ? 45 : 65;
      hurtPlayer(Math.floor(e.dmg * moonDamageMul), e);
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
  const speedMul = state.relicName === 'SWIFT' ? 1.35 : 1;
  const spd = p.speed * speedMul * (dt / 16);

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
  if (p.slashTimer > 0) p.slashTimer--;
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

  // Taking a hit breaks combo streak.
  resetCombo();

  updateHUD();
  if (p.hp <= 0) triggerGameOver();
}

function collectItem(item) {
  item.collected = true;
  spawnParticles(item.x, item.y, item.type === 'health' ? COLORS.health : COLORS.ammo, 8);
  if (item.type === 'health') {
    if (state.levelMedkitsCollected >= state.levelMedkitCap) {
      const bonusBullets = 4 + Math.floor(Math.random() * 5);
      state.ammo[1] += bonusBullets;
      showMessage(`MEDKIT CAP REACHED (+${bonusBullets} AMMO)`);
      state.score += 10;
      updateHUD();
      return;
    }
    state.levelMedkitsCollected++;
    state.medkits++;
    showMessage(`+1 MEDKIT (${state.medkits} TOTAL, ${state.levelMedkitsCollected}/${state.levelMedkitCap} THIS FLOOR)`);
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

    // Bombs leave a fiery trail while in flight.
    if (b.isBomb && b.life % 3 === 0) {
      spawnParticles(b.x, b.y, '#ff9a2f', 1);
      spawnParticles(b.x, b.y, '#ffe6a3', 1);
    }

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
    if (d < TILE * 3) {
      hurtEnemy(e, Math.floor(45 * (b.powerMul || 1) * (1 - d / (TILE*3))));
    }
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
      color: i % 2 === 0 ? '#9fd8ff' : '#fff',
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

  const comboEl = document.getElementById('comboText');
  if (comboEl) {
    comboEl.textContent = `x${state.comboMultiplier.toFixed(1)}`;
    comboEl.style.color = state.comboMultiplier > 1 ? '#ffcc00' : '#00ff41';
  }

  const moonEl = document.getElementById('moonText');
  if (moonEl) {
    moonEl.textContent = state.bloodMoonActive ? 'BLOOD' : 'CALM';
    moonEl.style.color = state.bloodMoonActive ? '#ff4444' : '#00ff41';
  }

  const effectEl = document.getElementById('effectLabel');
  if (effectEl) {
    if (state.relicName === 'NONE') {
      effectEl.textContent = 'RELIC: NONE';
      effectEl.style.color = '#555';
    } else {
      const sec = Math.max(0, Math.ceil(state.relicTimer / 1000));
      effectEl.textContent = `RELIC: ${state.relicName} (${sec}s)`;
      effectEl.style.color = '#ffb300';
    }
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
      // VOID BOMB projectile look: core + ring + spark.
      ctx.fillStyle = '#ff7f32';
      ctx.beginPath();
      ctx.arc(b.x, b.y, 5, 0, Math.PI*2);
      ctx.fill();
      ctx.strokeStyle = '#ffd27a';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(b.x, b.y, 7.5, 0, Math.PI*2);
      ctx.stroke();
      // fuse spark
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(b.x + b.vx*2, b.y + b.vy*2, 2, 0, Math.PI*2);
      ctx.fill();
    } else if (b.style === 'hex') {
      // HEX PISTOL projectile: glowing rune diamond.
      ctx.translate(b.x, b.y);
      ctx.rotate(Math.atan2(b.vy, b.vx));
      ctx.shadowColor = '#8fd9ff';
      ctx.shadowBlur = 10;
      ctx.fillStyle = '#9fd8ff';
      ctx.beginPath();
      ctx.moveTo(6, 0);
      ctx.lineTo(0, 3.2);
      ctx.lineTo(-4.5, 0);
      ctx.lineTo(0, -3.2);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#e9f9ff';
      ctx.lineWidth = 1;
      ctx.stroke();
    } else if (b.style === 'specter') {
      // SPECTER projectile: ghostly orb with halo.
      ctx.fillStyle = '#b97dff';
      ctx.shadowColor = '#b97dff';
      ctx.shadowBlur = 9;
      ctx.beginPath();
      ctx.arc(b.x, b.y, 4.2, 0, Math.PI*2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(220,180,255,0.85)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(b.x, b.y, 6.5, 0, Math.PI*2);
      ctx.stroke();
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

  if (state.bloodMoonActive) {
    ctx.fillStyle = 'rgba(180,20,20,0.1)';
    ctx.fillRect(camX, camY, W, H);
  }

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
  const fovAngle = Math.PI / 5;     // 60° cone total (front only)

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

  // Weapon indicator with distinct silhouettes per weapon.
  ctx.strokeStyle = state.weapon === 0 ? '#dfe6ef' : state.weapon === 1 ? '#9bb0c7' : '#ff8800';
  ctx.lineWidth = 2.5;
  if (state.weapon === 0) {
    // RUNE BLADE
    const bx = x + p.facing.x * s*0.9;
    const by = y + p.facing.y * s*0.9 - s*0.2;
    const tx = x + p.facing.x * s*2.2;
    const ty = y + p.facing.y * s*2.2 - s*0.2;

    ctx.strokeStyle = '#e4ecff';
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(tx, ty);
    ctx.stroke();

    // Crossguard
    const px = -p.facing.y;
    const py = p.facing.x;
    ctx.strokeStyle = '#92a6c2';
    ctx.beginPath();
    ctx.moveTo(bx + px * s*0.28, by + py * s*0.28);
    ctx.lineTo(bx - px * s*0.28, by - py * s*0.28);
    ctx.stroke();

    // Rune gleam near the tip
    ctx.fillStyle = '#9fd3ff';
    ctx.fillRect(tx - 1.5, ty - 1.5, 3, 3);

    // Slash effect while attacking with blade.
    if (p.slashTimer > 0) {
      const slashAlpha = Math.max(0.15, p.slashTimer / 8);
      const slashCenterX = x + p.facing.x * s*1.4;
      const slashCenterY = y + p.facing.y * s*1.2 - s*0.12;
      const facingAngle = Math.atan2(p.facing.y, p.facing.x);
      ctx.strokeStyle = `rgba(198,235,255,${slashAlpha})`;
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.arc(slashCenterX, slashCenterY, s*1.45, facingAngle - 0.78, facingAngle + 0.78);
      ctx.stroke();

      ctx.strokeStyle = `rgba(255,255,255,${slashAlpha * 0.75})`;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(slashCenterX, slashCenterY, s*1.18, facingAngle - 0.66, facingAngle + 0.66);
      ctx.stroke();
    }
  } else if (state.weapon === 1) {
    // HEX PISTOL
    const gx = x + p.facing.x * s*0.8;
    const gy = y + p.facing.y * s*0.8 - s*0.12;
    const perpX = -p.facing.y;
    const perpY = p.facing.x;

    // Barrel
    ctx.strokeStyle = '#9db0ca';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(gx, gy);
    ctx.lineTo(gx + p.facing.x * s*1.1, gy + p.facing.y * s*1.1);
    ctx.stroke();

    // Grip block
    ctx.fillStyle = '#7f92aa';
    ctx.fillRect(
      gx - perpX * s*0.16 - p.facing.x * s*0.14,
      gy - perpY * s*0.16 - p.facing.y * s*0.14,
      s*0.34,
      s*0.34
    );

    // Muzzle glyph
    ctx.fillStyle = '#72d0ff';
    ctx.beginPath();
    ctx.arc(gx + p.facing.x * s*1.15, gy + p.facing.y * s*1.15, s*0.1, 0, Math.PI*2);
    ctx.fill();
  } else {
    // VOID BOMB
    const ox = x + p.facing.x * s*1.15;
    const oy = y + p.facing.y * s*1.15;

    // Core orb
    ctx.fillStyle = '#ff6b22';
    ctx.beginPath();
    ctx.arc(ox, oy, s*0.26, 0, Math.PI*2);
    ctx.fill();

    // Ring and spark rune
    ctx.strokeStyle = '#ffc14a';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(ox, oy, s*0.36, 0, Math.PI*2);
    ctx.stroke();
    ctx.fillStyle = '#fff2a8';
    ctx.fillRect(ox - 1, oy - s*0.52, 2, 3);
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

  updateStatusSystems(dt);

  if (timestamp - state.lastSaveTime > 5000) {
    saveProgress();
    state.lastSaveTime = timestamp;
  }

  updatePlayer(dt);
  updateEnemies(dt);
  updateBullets(dt);
  updateParticles();
  render();
  updateHUD();

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
  window.addEventListener('beforeunload', () => {
    if (state.running && !state.paused) saveProgress();
  });
  refreshTitleMenuState();
  showScreen('titleScreen');
})();