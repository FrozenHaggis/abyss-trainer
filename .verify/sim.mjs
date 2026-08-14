// src/engine/sim.ts
var TICK_MS = 1e3 / 60;
var PLAYER_SPEED = 14;
var MELEE_RANGE = 5;
var BURST_WINDOW_MS = 1e4;
var SHOT_SPEED = 62;
var SHOTS_PER_SEC = 5;
var FIRE_INTERVAL_MS = 1e3 / SHOTS_PER_SEC;
var BOSS_HIT_RADIUS = 4.5;
var ADD_HIT_RADIUS = 2.8;
var ABILITIES_BY_ROLE = {
  tank: ["taunt", "defensive", "interrupt", "burst"],
  healer: ["dispel", "raidcd", "defensive", "interrupt"],
  dps: ["interrupt", "defensive", "burst", "dispel"]
};
var COOLDOWN_MS = {
  interrupt: 12e3,
  dispel: 8e3,
  defensive: 9e4,
  taunt: 1e4,
  burst: 12e4,
  raidcd: 1e5
};
function abilitiesFor(role) {
  return ABILITIES_BY_ROLE[role];
}
function makeAllies(playerRole) {
  const out = [];
  const comp = [
    "tank",
    ...Array(4).fill("healer"),
    ...Array(14).fill("dps")
  ];
  if (playerRole !== "tank") comp.push("tank");
  comp.forEach((r, i) => {
    out.push({
      id: i + 1,
      role: r,
      pos: { x: 0, y: 0 },
      want: { x: 0, y: 0 },
      health: 1,
      alive: true,
      stacks: 0,
      debuff: null,
      debuffMs: 0,
      // Tanks are on the boss from the pull; everyone else walks on when needed.
      presence: r === "tank" ? 1 : 0
    });
  });
  return out;
}
function makeBosses(boss, allies) {
  const defs = boss.entities?.length ? boss.entities : [{ id: boss.key, name: boss.name, npcId: 0, start: { x: 0, y: 0 } }];
  const tanks = allies.filter((a) => a.role === "tank").map((a) => a.id);
  let nextTank = 0;
  return defs.map((d, i) => {
    const wants = i === 0 || d.tankedApart;
    return {
      def: d,
      pos: { ...d.start },
      angle: -Math.PI / 2,
      targetId: wants && nextTank < tanks.length ? tanks[nextTank++] : -1,
      hp: 1,
      alive: true
    };
  });
}
function primaryBoss(w) {
  return w.bosses[0];
}
function bossUnitFor(w, from) {
  if (!from) return w.bosses[0];
  return w.bosses.find((b) => b.def.id === from) ?? w.bosses[0];
}
function nearestBoss(w, p) {
  let best = w.bosses[0];
  let bd = Infinity;
  for (const b of w.bosses) {
    if (b.def.untargetable || !b.alive) continue;
    const d = dist(b.pos, p);
    if (d < bd) {
      bd = d;
      best = b;
    }
  }
  return best;
}
function raidAnchor(w) {
  let x = 0, y = 0, n = 0;
  for (const a of w.allies) {
    if (!a.alive) continue;
    x += a.pos.x;
    y += a.pos.y;
    n++;
  }
  return n ? { x: x / n, y: y / n } : { x: 0, y: 0 };
}
function createDrill(boss, role, mechanicId) {
  const w = createWorld(boss, role);
  w.drillId = mechanicId;
  w.boss = {
    ...boss,
    loop: [mechanicId],
    introEverySec: 1,
    loopIntervalSec: Math.max(3.5, boss.loopIntervalSec * 0.7),
    atFullEnergy: void 0,
    // Ambient attrition and adds are the fight, not the mechanic — they would
    // just kill you slowly while you practise something else.
    ambient: [],
    adds: [],
    // No enrage. You leave a drill when you are done with it, not when a timer
    // decides you are.
    pullLengthSec: 3600
  };
  return w;
}
function createWorld(boss, role) {
  const allies = makeAllies(role);
  return {
    boss,
    allies,
    bosses: makeBosses(boss, allies),
    overStackMs: 0,
    alliesLost: 0,
    player: {
      pos: { x: 0, y: 12 },
      role,
      health: 1,
      alive: true,
      carrying: {},
      cooldowns: {},
      aloft: 0
    },
    instances: [],
    adds: [],
    addTimerMs: 0,
    addWave: 0,
    addsKilled: 0,
    addsLeaked: 0,
    shots: [],
    fireCooldown: 0,
    shotsFired: 0,
    shotsHit: 0,
    bossEnergy: 0,
    bossHp: 1,
    killed: false,
    elapsedMs: 0,
    raidHealth: 1,
    raidHealthLow: 1,
    failures: /* @__PURE__ */ new Map(),
    resolvedCount: 0,
    seen: /* @__PURE__ */ new Set(),
    announce: null,
    deathCause: null,
    nextUid: 1,
    loopIndex: 0,
    loopTimerMs: 0,
    ambientTimerMs: 0,
    shake: 0,
    playerStacks: 0,
    prompt: null,
    lastFailure: null,
    soloMs: 0,
    burnMs: 0,
    burnMult: 1,
    burnId: null,
    burnUsed: false,
    bossesLinked: false,
    linkedMs: 0,
    drillId: null,
    drillReps: 0,
    drillClean: 0
  };
}
function currentTank(w, unit = w.bosses[0]) {
  if (unit.targetId === 0) return { pos: w.player.pos, stacks: w.playerStacks, isPlayer: true };
  const a = w.allies.find((x) => x.id === unit.targetId);
  return a ? { pos: a.pos, stacks: a.stacks, isPlayer: false } : { pos: unit.pos, stacks: 0, isPlayer: false };
}
var dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
var lenOf = (v) => Math.hypot(v.x, v.y);
function angleDelta(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
function isInside(inst, p) {
  const s = inst.def.shape;
  if (!s) return false;
  const dx = p.x - inst.pos.x;
  const dy = p.y - inst.pos.y;
  const d = Math.hypot(dx, dy);
  switch (s.kind) {
    case "circle":
      return d <= s.radius;
    case "annulus":
      return d >= s.inner && d <= s.outer;
    case "cone": {
      if (d > s.radius) return false;
      const to = Math.atan2(dy, dx);
      return Math.abs(angleDelta(inst.angle, to)) <= s.arcDeg * Math.PI / 360;
    }
    case "line": {
      const ca = Math.cos(inst.angle);
      const sa = Math.sin(inst.angle);
      const along = dx * ca + dy * sa;
      const across = -dx * sa + dy * ca;
      return along >= 0 && along <= s.length && Math.abs(across) <= s.width / 2;
    }
  }
}
function def_scored(w, def) {
  return def.roles.includes(w.player.role);
}
function recordFailure(w, def) {
  if (def.failText) {
    w.lastFailure = { name: def.name, failText: def.failText, atMs: w.elapsedMs };
  }
  const row = w.failures.get(def.id);
  if (row) row.count++;
  else w.failures.set(def.id, { mechanicId: def.id, name: def.name, failText: def.failText, count: 1 });
}
var MAX_SINGLE_HIT = 0.55;
function killPlayer(w, cause) {
  if (!w.player.alive) return;
  w.player.alive = false;
  w.player.health = 0;
  w.deathCause = cause;
  w.shake = 1;
}
function hurt(w, amount, cause) {
  const capped = Math.min(amount, MAX_SINGLE_HIT);
  const mitigated = w.player.cooldowns.defensive && w.player.cooldowns.defensive > COOLDOWN_MS.defensive - 8e3 ? capped * 0.4 : capped;
  w.player.health -= mitigated;
  w.shake = Math.min(1, w.shake + mitigated * 2);
  if (w.player.health <= 0 && w.player.alive) {
    w.player.alive = false;
    w.player.health = 0;
    w.deathCause = cause;
  }
}
function spawn(w, def, at, angle) {
  const src = bossUnitFor(w, def.from);
  let pos;
  switch (def.origin) {
    case "boss":
      pos = { ...src.pos };
      break;
    case "player":
      pos = { ...w.player.pos };
      break;
    case "targeted": {
      const onPlayer = Math.random() < 0.72;
      if (onPlayer) pos = { ...w.player.pos };
      else {
        const live = w.allies.filter((a2) => a2.alive);
        const a = live[Math.floor(Math.random() * Math.max(1, live.length))];
        pos = a ? { ...a.pos } : { ...w.player.pos };
      }
      break;
    }
    case "edge": {
      const a = Math.random() * Math.PI * 2;
      const r = w.boss.arenaRadius;
      pos = { x: Math.cos(a) * r, y: Math.sin(a) * r };
      break;
    }
    default: {
      const live = w.allies.filter((a2) => a2.alive);
      const anchor = Math.random() < 0.4 || !live.length ? w.player.pos : live[Math.floor(Math.random() * live.length)].pos;
      const jitter = w.boss.arenaRadius * 0.16 + 6;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * jitter;
      pos = { x: anchor.x + Math.cos(a) * r, y: anchor.y + Math.sin(a) * r };
      const len = lenOf(pos);
      const rim = w.boss.arenaRadius * 0.92;
      if (len > rim) {
        pos.x = pos.x / len * rim;
        pos.y = pos.y / len * rim;
      }
    }
  }
  if (at) pos = { ...at };
  let ang = angle ?? 0;
  if (angle === void 0 && def.origin === "boss") {
    ang = Math.atan2(w.player.pos.y - pos.y, w.player.pos.x - pos.x);
  } else if (angle === void 0) {
    ang = Math.random() * Math.PI * 2;
  }
  const inst = {
    uid: w.nextUid++,
    def,
    pos,
    angle: ang,
    fromId: src.def.id,
    timer: def.telegraphMs,
    resolved: false,
    answered: false,
    // Did this land on the player? Drives both the "it follows you" behaviour
    // and where its pool drops.
    carriedByPlayer: def.origin === "player" || def.origin === "targeted" && Math.hypot(pos.x - w.player.pos.x, pos.y - w.player.pos.y) < 0.01
  };
  if (def.driftSpeed) {
    const a = Math.random() * Math.PI * 2;
    inst.drift = { x: Math.cos(a) * def.driftSpeed, y: Math.sin(a) * def.driftSpeed };
  }
  w.instances.push(inst);
  if (!w.seen.has(def.id)) {
    w.seen.add(def.id);
    w.announce = def;
  }
}
function fire(w, id, at, angle) {
  const def = w.boss.mechanics.find((m) => m.id === id);
  if (!def) return;
  if (def.rule.type === "collect") {
    const n = def.rule.count;
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2 + w.elapsedMs / 3e3;
      const r = w.boss.arenaRadius * (0.28 + 0.42 * (i % 3 / 2));
      spawn(w, def, { x: Math.cos(a) * r, y: Math.sin(a) * r });
    }
    return;
  }
  spawn(w, def, at, angle);
}
function resolveInstance(w, inst) {
  const { def } = inst;
  inst.resolved = true;
  w.resolvedCount++;
  const scored = def.roles.includes(w.player.role) && !def.collective;
  const inside = isInside(inst, w.player.pos);
  switch (def.rule.type) {
    case "avoid":
      if (inside && !def.popsOnContact) {
        if (scored) recordFailure(w, def);
        if (def.lethal) killPlayer(w, def.name);
        else hurt(w, def.damage ?? 0.3, def.name);
      }
      break;
    case "collect":
      if (!inst.answered) {
        if (scored) recordFailure(w, def);
        w.raidHealth -= def.lethal ? 0.16 : 0.09;
      }
      break;
    case "beInside":
      if (!inside) {
        if (scored) recordFailure(w, def);
        w.raidHealth -= def.lethal ? 0.3 : 0.12;
      }
      break;
    case "faceAway": {
      const raid = raidAnchor(w);
      const toRaid = Math.atan2(raid.y - inst.pos.y, raid.x - inst.pos.x);
      const arc = def.shape?.kind === "cone" ? def.shape.arcDeg * Math.PI / 360 : 0.5;
      if (Math.abs(angleDelta(inst.angle, toRaid)) <= arc) {
        if (scored) recordFailure(w, def);
        w.raidHealth -= 0.1;
      }
      if (inside) hurt(w, def.damage ?? 0.25, def.name);
      break;
    }
    case "press":
      if (!inst.answered) {
        if (scored) recordFailure(w, def);
        if (def.damage) hurt(w, def.damage, def.name);
        else w.raidHealth -= 0.08;
      }
      break;
    case "carryOut": {
      const d = lenOf(w.player.pos);
      if (w.player.carrying[def.id] !== void 0 && d < def.rule.minDistance) {
        if (scored) recordFailure(w, def);
        if (def.lethal) {
          w.raidHealth -= 0.25;
          killPlayer(w, def.name);
        } else {
          w.raidHealth -= 0.1;
        }
      }
      delete w.player.carrying[def.id];
      break;
    }
    case "survive":
      if (inside && def.knockbackYards) {
        const away = Math.atan2(w.player.pos.y - inst.pos.y, w.player.pos.x - inst.pos.x);
        let nx = w.player.pos.x + Math.cos(away) * def.knockbackYards;
        let ny = w.player.pos.y + Math.sin(away) * def.knockbackYards;
        const r = Math.hypot(nx, ny);
        const rim = w.boss.arenaRadius - 1.5;
        if (r > rim) {
          nx = nx / r * rim;
          ny = ny / r * rim;
          if (scored) recordFailure(w, def);
          hurt(w, def.damage ?? 0.25, def.name);
        }
        w.player.pos.x = nx;
        w.player.pos.y = ny;
        w.player.aloft = 1200;
        w.shake = 1;
      }
      break;
    case "tankSwap": {
      const unit = bossUnitFor(w, def.from);
      if (unit.targetId === 0) w.playerStacks += 1;
      else {
        const t = w.allies.find((a) => a.id === unit.targetId);
        if (t) t.stacks += 1;
      }
      break;
    }
    case "burnWindow":
      w.burnMs = def.rule.durationMs;
      w.burnMult = def.rule.multiplier;
      w.burnId = def.id;
      w.burnUsed = false;
      break;
    case "raidDamage":
    case "keepApart":
      break;
  }
  if (def.shape) {
    for (const add of w.adds) {
      if (!add.alive || add.def.job !== "leave") continue;
      if (!isInside(inst, add.pos)) continue;
      add.alive = false;
      recordAddFailure(w, add.def);
      w.raidHealth -= 0.09;
      w.shake = Math.min(1, w.shake + 0.5);
    }
  }
  if (def.spawns) {
    const child = w.boss.mechanics.find((m) => m.id === def.spawns.defId);
    if (child) {
      const carried = def.rule.type === "carryOut" && inst.carriedByPlayer;
      const at = carried ? { ...w.player.pos } : inst.pos;
      spawn(w, child, at, inst.angle);
      if (carried) {
        const dropped = w.instances[w.instances.length - 1];
        if (dropped && dropped.timer < 1200) dropped.timer = 1200;
      }
    }
  }
}
var ALLY_SPEED = 12;
var SWAP_GRACE_MS = 2500;
var BOSS_FOLLOW_SPEED = 7;
var LINK_GRACE_MS = 2500;
var IMPACT_FLASH_MS = 260;
var CO_TANK_REACTION_MS = 1400;
function soakPoint(inst, slot, of) {
  const sh = inst.def.shape;
  if (!sh) return { ...inst.pos };
  const t = of <= 1 ? 0.5 : slot / (of - 1);
  switch (sh.kind) {
    case "cone": {
      const half = sh.arcDeg * Math.PI / 360;
      const ang = inst.angle + (t - 0.5) * half * 1.3;
      const r = sh.radius * (0.5 + 0.22 * (slot % 2 ? 1 : -1));
      return { x: inst.pos.x + Math.cos(ang) * r, y: inst.pos.y + Math.sin(ang) * r };
    }
    case "circle": {
      const ang = t * Math.PI * 2;
      const r = sh.radius * 0.55;
      return { x: inst.pos.x + Math.cos(ang) * r, y: inst.pos.y + Math.sin(ang) * r };
    }
    case "line": {
      const along = sh.length * (0.3 + 0.4 * t);
      return { x: inst.pos.x + Math.cos(inst.angle) * along, y: inst.pos.y + Math.sin(inst.angle) * along };
    }
    case "annulus": {
      const ang = t * Math.PI * 2;
      const r = (sh.inner + sh.outer) / 2;
      return { x: inst.pos.x + Math.cos(ang) * r, y: inst.pos.y + Math.sin(ang) * r };
    }
  }
}
function threatAt(inst, x, y) {
  const sh = inst.def.shape;
  if (!sh) return 0;
  const dx = x - inst.pos.x;
  const dy = y - inst.pos.y;
  const d = Math.hypot(dx, dy) || 1e-3;
  switch (sh.kind) {
    case "circle":
      return d < sh.radius + 5 ? sh.radius + 5 - d : 0;
    case "annulus":
      return d > sh.inner - 2 ? d - (sh.inner - 2) : 0;
    case "cone": {
      if (d > sh.radius + 4) return 0;
      const to = Math.atan2(dy, dx);
      let a = to - inst.angle;
      while (a > Math.PI) a -= Math.PI * 2;
      while (a < -Math.PI) a += Math.PI * 2;
      return Math.abs(a) <= sh.arcDeg * Math.PI / 360 + 0.15 ? sh.radius + 4 - d : 0;
    }
    case "line": {
      const ca = Math.cos(inst.angle), sa = Math.sin(inst.angle);
      const along = dx * ca + dy * sa;
      const across = -dx * sa + dy * ca;
      return along > -3 && along < sh.length + 3 && Math.abs(across) < sh.width / 2 + 4 ? sh.width / 2 + 4 - Math.abs(across) : 0;
    }
  }
}
function allyThink(w) {
  const arena = w.boss.arenaRadius;
  const tanked = w.bosses.filter((b) => b.targetId >= 0);
  const anchor = tanked.length ? {
    x: tanked.reduce((s, b) => s + b.pos.x, 0) / tanked.length,
    y: tanked.reduce((s, b) => s + b.pos.y, 0) / tanked.length
  } : { ...w.bosses[0].pos };
  const soaks = [];
  for (const inst of w.instances) {
    if (inst.resolved || inst.def.rule.type !== "beInside") continue;
    soaks.push({ inst, slots: Math.max(1, (inst.def.soakers ?? 4) - 1), taken: 0 });
  }
  const pickups = w.instances.filter((i) => !i.resolved && !i.answered && i.def.rule.type === "collect");
  const claimable = pickups.slice(0, Math.max(0, pickups.length - 1));
  let claimed = 0;
  for (const a of w.allies) {
    if (!a.alive) continue;
    const isMelee = a.role === "tank" || a.id % 3 === 0;
    const ringR = isMelee ? 9 : 21 + a.id % 4 * 2.5;
    const spread = a.id / Math.max(1, w.allies.length) * Math.PI * 2;
    a.want.x = anchor.x + Math.cos(spread) * ringR;
    a.want.y = anchor.y + Math.sin(spread) * ringR;
    const held = w.bosses.find((b) => b.targetId === a.id);
    if (held?.def.tankedApart) {
      a.want.x = held.def.start.x;
      a.want.y = held.def.start.y;
    } else if (held) {
      a.want.x = held.pos.x + Math.cos(held.angle) * 5;
      a.want.y = held.pos.y + Math.sin(held.angle) * 5;
    } else if (a.role === "tank") {
      const p = w.bosses[0];
      a.want.x = p.pos.x - Math.cos(p.angle) * 7;
      a.want.y = p.pos.y - Math.sin(p.angle) * 7;
    }
    if (a.role !== "tank" && claimed < claimable.length) {
      const p = claimable[claimed++];
      a.want.x = p.pos.x;
      a.want.y = p.pos.y;
    }
    if (a.role !== "tank") {
      for (const sk of soaks) {
        if (sk.taken >= sk.slots) continue;
        const pt = soakPoint(sk.inst, sk.taken, sk.slots);
        a.want.x = pt.x;
        a.want.y = pt.y;
        sk.taken++;
        break;
      }
    }
    for (const inst of w.instances) {
      if (inst.resolved) continue;
      const rt = inst.def.rule.type;
      if (rt === "carryOut") {
        if (a.id % 3 === 0 && a.role !== "tank") {
          const r2 = Math.hypot(a.pos.x, a.pos.y) || 1;
          const out = Math.min(arena * 0.82, inst.def.rule.minDistance + 6);
          a.want.x = a.pos.x / r2 * out;
          a.want.y = a.pos.y / r2 * out;
        }
      } else if (rt === "survive") {
        const r2 = Math.hypot(a.pos.x, a.pos.y) || 1;
        const safe = arena * 0.42;
        a.want.x = a.pos.x / r2 * safe + Math.cos(a.id) * 5;
        a.want.y = a.pos.y / r2 * safe + Math.sin(a.id) * 5;
      } else if (rt === "press" && inst.def.rule.ability === "dispel") {
        if (inst.def.shape?.kind === "circle") {
          const dx = a.pos.x - inst.pos.x;
          const dy = a.pos.y - inst.pos.y;
          const d = Math.hypot(dx, dy) || 1;
          if (d < inst.def.shape.radius + 8) {
            a.want.x = inst.pos.x + dx / d * (inst.def.shape.radius + 11);
            a.want.y = inst.pos.y + dy / d * (inst.def.shape.radius + 11);
          }
        }
      }
    }
    for (const inst of w.instances) {
      if (!inst.def.shape || inst.def.rule.type !== "avoid") continue;
      const sh = inst.def.shape;
      const threatWant = threatAt(inst, a.want.x, a.want.y);
      const threatNow = threatAt(inst, a.pos.x, a.pos.y);
      if (threatWant <= 0 && threatNow <= 0) continue;
      if (sh.kind === "annulus") {
        const dx2 = a.pos.x - inst.pos.x;
        const dy2 = a.pos.y - inst.pos.y;
        const d2 = Math.hypot(dx2, dy2) || 1;
        const safe = Math.max(2, sh.inner - 6);
        a.want.x = inst.pos.x + dx2 / d2 * safe;
        a.want.y = inst.pos.y + dy2 / d2 * safe;
        continue;
      }
      let dx = a.pos.x - inst.pos.x;
      let dy = a.pos.y - inst.pos.y;
      let d = Math.hypot(dx, dy);
      if (d < 0.5) {
        const r2 = Math.hypot(a.pos.x, a.pos.y) || 1;
        dx = a.pos.x / r2;
        dy = a.pos.y / r2;
        d = 1;
      }
      const clear = (sh.kind === "circle" ? sh.radius : sh.kind === "cone" ? sh.radius * 0.75 : 12) + 7;
      a.want.x = inst.pos.x + dx / d * clear;
      a.want.y = inst.pos.y + dy / d * clear;
    }
    let fouled = 0;
    for (const inst of w.instances) {
      if (!inst.resolved || !inst.def.lingerMs || !inst.def.shape) continue;
      fouled += threatAt(inst, a.want.x, a.want.y) > 0 ? 1 : 0;
    }
    if (fouled > 0) {
      let bestX = a.want.x, bestY = a.want.y, bestScore = Infinity;
      for (let i = 0; i < 12; i++) {
        const ang = i / 12 * Math.PI * 2 + a.id;
        for (const dist2 of [10, 18, 26]) {
          const cx = a.want.x + Math.cos(ang) * dist2;
          const cy = a.want.y + Math.sin(ang) * dist2;
          if (Math.hypot(cx, cy) > arena * 0.86) continue;
          let bad = 0;
          for (const inst of w.instances) {
            if (!inst.def.shape) continue;
            if (!inst.resolved && inst.def.rule.type !== "avoid") continue;
            if (threatAt(inst, cx, cy) > 0) bad += inst.resolved ? 1 : 2;
          }
          const score = bad * 100 + dist2;
          if (score < bestScore) {
            bestScore = score;
            bestX = cx;
            bestY = cy;
          }
        }
      }
      a.want.x = bestX;
      a.want.y = bestY;
    }
    a.want.x += Math.sin(w.elapsedMs / 2600 + a.id * 1.7) * 1.6;
    a.want.y += Math.cos(w.elapsedMs / 3100 + a.id * 2.3) * 1.6;
    const station = w.bosses.find((b) => b.targetId === a.id && b.def.tankedApart)?.def.start;
    if (station) {
      const sdx = a.want.x - station.x;
      const sdy = a.want.y - station.y;
      const sd = Math.hypot(sdx, sdy);
      const leash = 6;
      if (sd > leash) {
        a.want.x = station.x + sdx / sd * leash;
        a.want.y = station.y + sdy / sd * leash;
      }
    }
    const r = Math.hypot(a.want.x, a.want.y);
    if (r > arena * 0.9) {
      a.want.x *= arena * 0.9 / r;
      a.want.y *= arena * 0.9 / r;
    }
  }
}
function allyMove(w, dt) {
  const groupWork = w.instances.some((i) => !i.resolved && (i.def.rule.type === "beInside" || i.def.rule.type === "carryOut" || i.def.rule.type === "press" && i.def.rule.ability === "dispel"));
  for (const a of w.allies) {
    if (!a.alive) {
      a.presence = Math.max(0, a.presence - dt * 3);
      continue;
    }
    const wanted = a.role === "tank" || groupWork || a.debuff ? 1 : 0;
    a.presence += Math.max(-dt * 1.1, Math.min(dt * 3.4, wanted - a.presence));
    a.presence = Math.max(0, Math.min(1, a.presence));
    const lag = 0.06 + a.id % 5 * 0.035;
    const ease = Math.min(1, dt / Math.max(0.016, lag));
    const dx = (a.want.x - a.pos.x) * ease;
    const dy = (a.want.y - a.pos.y) * ease;
    const d = Math.hypot(dx, dy);
    if (d > 0.6) {
      const stepLen = Math.min(d, ALLY_SPEED * dt);
      a.pos.x += dx / d * stepLen;
      a.pos.y += dy / d * stepLen;
    }
    if (a.debuffMs > 0) {
      a.debuffMs -= dt * 1e3;
      if (a.debuffMs <= 0) {
        a.debuff = null;
        a.debuffMs = 0;
      }
    }
    if (a.health < 1 && a.health > 0) a.health = Math.min(1, a.health + 0.06 * dt);
  }
}
function computePrompt(w) {
  let best = null;
  let bestRank = Infinity;
  const consider = (p, rank) => {
    if (rank >= bestRank) return;
    bestRank = rank;
    best = { ...p, urgency: Math.max(0, Math.min(1, p.urgency)) };
  };
  const swapDef = w.boss.mechanics.find((m) => m.rule.type === "tankSwap");
  if (swapDef && swapDef.rule.type === "tankSwap" && w.player.role === "tank") {
    const tank = currentTank(w, bossUnitFor(w, swapDef.from));
    if (!tank.isPlayer && tank.stacks >= swapDef.rule.maxStacks - 1) {
      consider({ verb: "TAUNT", mechanic: swapDef.name, urgency: 1 }, 0);
    }
  }
  if (w.burnMs > 0 && !w.burnUsed && abilitiesFor(w.player.role).includes("burst") && !w.player.cooldowns.burst) {
    const d = w.boss.mechanics.find((m) => m.id === w.burnId);
    if (d) consider({ verb: "BURN IT", mechanic: d.name, urgency: 1 - w.burnMs / 2e4 }, 0);
  }
  if (w.bossesLinked) {
    const d = w.boss.mechanics.find((m) => m.rule.type === "keepApart");
    if (d) consider({ verb: "PULL THEM APART", mechanic: d.name, urgency: 1 }, 0);
  }
  for (const add of w.adds) {
    if (!add.alive) continue;
    const d = add.def;
    if (d.job === "kick" && add.castMs >= 0 && !add.kicked) {
      const t = 1 - add.castMs / ((d.castEverySec ?? 8) * 1e3);
      if (abilitiesFor(w.player.role).includes("interrupt")) {
        consider({ verb: "KICK IT", mechanic: d.name, urgency: t }, 0);
      }
    } else if (d.job === "intercept") {
      const t = 1 - lenOf(add.pos) / Math.max(1, w.boss.arenaRadius);
      consider({ verb: "BLOCK IT", mechanic: d.name, urgency: t }, 1);
    } else if (d.job === "kill") {
      const t = 1 - add.fuse / Math.max(1, d.fuseSec * 1e3);
      if (t > 0.4) consider({ verb: add.shield > 0 ? "BREAK THE SHIELD" : "KILL IT", mechanic: d.name, urgency: t }, 2);
    } else if (d.job === "leave") {
      if (dist(add.pos, w.player.pos) < 9) {
        consider({ verb: "DO NOT TOUCH", mechanic: d.name, urgency: 0.5 }, 2);
      }
    }
  }
  for (const inst of w.instances) {
    if (inst.resolved) continue;
    const { def } = inst;
    const t = def.telegraphMs > 0 ? 1 - inst.timer / def.telegraphMs : 1;
    const inside = isInside(inst, w.player.pos);
    const mine = def.roles.includes(w.player.role);
    switch (def.rule.type) {
      case "press":
        if (!inst.answered && mine) {
          const verb = def.rule.ability === "interrupt" ? "KICK IT" : "DISPEL";
          consider({ verb, mechanic: def.name, urgency: t }, 1);
        }
        break;
      case "beInside":
        if (!inside) consider({ verb: "GET IN", mechanic: def.name, urgency: t }, 2);
        break;
      case "collect":
        if (!inst.answered && dist(inst.pos, w.player.pos) < 22) {
          consider({ verb: "RUN OVER IT", mechanic: def.name, urgency: t }, 2);
        }
        break;
      case "carryOut":
        if (inst.carriedByPlayer) {
          const d = Math.hypot(w.player.pos.x, w.player.pos.y);
          if (d < def.rule.minDistance) {
            consider({ verb: "RUN IT OUT", mechanic: def.name, urgency: t }, 2);
          }
        }
        break;
      case "avoid":
        if (inside) consider({ verb: "MOVE OUT", mechanic: def.name, urgency: t }, 3);
        break;
      case "survive":
        if (inside) consider({ verb: "BRACE \u2014 KNOCKBACK", mechanic: def.name, urgency: t }, 4);
        break;
      case "faceAway":
        if (w.player.role === "tank" && bossUnitFor(w, def.from).targetId === 0) {
          consider({ verb: "POINT IT AWAY", mechanic: def.name, urgency: t }, 2);
        }
        break;
      default:
        break;
    }
  }
  return best;
}
function unlockedCount(w) {
  const every = w.boss.introEverySec ?? 5;
  const n = 2 + Math.floor(w.elapsedMs / 1e3 / every);
  return Math.max(1, Math.min(w.boss.loop.length, n));
}
function spawnAdds(w, def) {
  const r = def.spawnRadius ?? w.boss.arenaRadius * 0.72;
  for (let i = 0; i < def.count; i++) {
    const a = w.addWave * 1.7 + i / def.count * Math.PI * 2;
    w.adds.push({
      uid: w.nextUid++,
      def,
      pos: { x: Math.cos(a) * r, y: Math.sin(a) * r },
      hp: def.hp,
      shield: def.shieldHp ?? 0,
      fuse: def.fuseSec * 1e3,
      castMs: -1,
      kicked: false,
      alive: true
    });
  }
  if (!w.seen.has(def.id)) {
    w.seen.add(def.id);
    w.announce = {
      id: def.id,
      name: def.name,
      spellId: def.spellId,
      roles: ["tank", "healer", "dps"],
      telegraphMs: 0,
      origin: "random",
      rule: { type: "avoid" },
      good: def.good,
      failText: def.failText
    };
  }
}
var ADD_SHOT_DAMAGE = 1;
var MAX_CONCURRENT_ADDS = 5;
var ADD_LEAK_COST = 0.11;
var ADD_KICK_COST = 0.09;
function stepAdds(w, dtMs, dt) {
  for (const add of w.adds) {
    if (!add.alive) continue;
    const d = add.def;
    if (d.auraDps) w.raidHealth -= d.auraDps / 100 * dt * (1 + 0.2 * (w.adds.length - 1));
    if (d.job === "intercept" && d.marchSpeed) {
      const len = lenOf(add.pos) || 1;
      add.pos.x -= add.pos.x / len * d.marchSpeed * dt;
      add.pos.y -= add.pos.y / len * d.marchSpeed * dt;
      if (dist(add.pos, w.player.pos) < 3.5) {
        add.alive = false;
        w.addsKilled++;
        continue;
      }
      if (lenOf(add.pos) < 4) {
        add.alive = false;
        w.addsLeaked++;
        recordAddFailure(w, d);
        w.raidHealth -= ADD_LEAK_COST;
        continue;
      }
    }
    if (d.job === "kick") {
      if (add.castMs < 0) {
        add.castMs = (d.castEverySec ?? 8) * 1e3;
        add.kicked = false;
      }
      add.castMs -= dtMs;
      if (add.castMs <= 0) {
        if (!add.kicked) {
          recordAddFailure(w, d);
          if (d.lethal) killPlayer(w, d.name);
          else w.raidHealth -= ADD_KICK_COST;
        }
        add.castMs = -1;
      }
    }
    add.fuse -= dtMs;
    if (add.fuse <= 0) {
      add.alive = false;
      if (d.job === "kill") {
        w.addsLeaked++;
        recordAddFailure(w, d);
        if (d.lethal) killPlayer(w, d.name);
        else w.raidHealth -= ADD_LEAK_COST;
        if (d.onLeak) {
          const conseq = w.boss.mechanics.find((m) => m.id === d.onLeak);
          if (conseq) {
            w.raidHealth -= 0.14;
            w.shake = 1;
            w.lastFailure = { name: conseq.name, failText: d.failText, atMs: w.elapsedMs };
            if (!w.seen.has(conseq.id)) {
              w.seen.add(conseq.id);
              w.announce = conseq;
            }
          }
        }
      }
    }
  }
  w.adds = w.adds.filter((a) => a.alive);
  if (w.boss.adds?.length) {
    w.addTimerMs += dtMs;
    const every = (w.boss.addEverySec ?? 22) * 1e3;
    if (w.addTimerMs >= every && w.adds.length < (w.boss.maxAdds ?? MAX_CONCURRENT_ADDS)) {
      w.addTimerMs = 0;
      const list = w.boss.adds;
      spawnAdds(w, list[w.addWave % list.length]);
      w.addWave++;
    }
  }
}
function recordAddFailure(w, d) {
  if (!d.failText) return;
  w.lastFailure = { name: d.name, failText: d.failText, atMs: w.elapsedMs };
  const row = w.failures.get(d.id);
  if (row) row.count++;
  else w.failures.set(d.id, { mechanicId: d.id, name: d.name, failText: d.failText, count: 1 });
}
function upcoming(w, count = 3) {
  const out = [];
  const period = w.boss.loopIntervalSec * 1e3;
  const untilNext = period - w.loopTimerMs;
  const live = unlockedCount(w);
  for (let i = 0; i < count; i++) {
    const id = w.boss.loop[(w.loopIndex + i) % live];
    const def = w.boss.mechanics.find((m) => m.id === id);
    if (def) out.push({ name: def.name, inSec: (untilNext + i * period) / 1e3 });
  }
  return out;
}
function step(w, input, dtMs) {
  if (w.drillId && !w.player.alive) {
    w.player.alive = true;
    w.player.health = 1;
    w.player.pos = { x: 0, y: 12 };
    w.deathCause = null;
    w.raidHealth = Math.max(w.raidHealth, 0.7);
  }
  if (!w.player.alive) return;
  w.announce = null;
  w.elapsedMs += dtMs;
  const dt = dtMs / 1e3;
  let mx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  let my = (input.down ? 1 : 0) - (input.up ? 1 : 0);
  if (mx || my) {
    const m = Math.hypot(mx, my);
    mx /= m;
    my /= m;
    const speed = w.player.aloft > 0 ? PLAYER_SPEED * 0.25 : PLAYER_SPEED;
    w.player.pos.x += mx * speed * dt;
    w.player.pos.y += my * speed * dt;
  }
  if (w.player.aloft > 0) w.player.aloft -= dtMs;
  if (lenOf(w.player.pos) > w.boss.arenaRadius) {
    w.player.alive = false;
    w.player.health = 0;
    w.deathCause = "Fell off the platform";
    recordFailure(w, {
      id: "falling",
      name: "Falling",
      spellId: 3,
      roles: [w.player.role],
      telegraphMs: 0,
      origin: "random",
      rule: { type: "avoid" },
      good: "Move with the wind and never let it carry you past the edge.",
      failText: "Blown off the platform"
    });
    return;
  }
  for (const k of Object.keys(w.player.cooldowns)) {
    const v = w.player.cooldowns[k];
    w.player.cooldowns[k] = v - dtMs <= 0 ? void 0 : v - dtMs;
  }
  for (const id of Object.keys(w.player.carrying)) {
    w.player.carrying[id] -= dtMs;
    if (w.player.carrying[id] <= 0) delete w.player.carrying[id];
  }
  for (const ab of input.pressed) {
    if (!abilitiesFor(w.player.role).includes(ab)) continue;
    if (w.player.cooldowns[ab]) continue;
    w.player.cooldowns[ab] = COOLDOWN_MS[ab];
    if (ab === "raidcd") {
      w.raidHealth = Math.min(1, w.raidHealth + 0.35);
      for (const a of w.allies) if (a.alive) a.health = Math.min(1, a.health + 0.4);
    }
    if (ab === "taunt") {
      const u = nearestBoss(w, w.player.pos);
      for (const b of w.bosses) {
        if (b === u || b.targetId !== 0) continue;
        const free = w.allies.find((x) => x.role === "tank" && x.alive && !w.bosses.some((o) => o.targetId === x.id));
        b.targetId = free ? free.id : -1;
      }
      u.targetId = 0;
      w.overStackMs = 0;
    }
    if (ab === "dispel") {
      let bestAlly = null;
      let bd = 40;
      for (const a of w.allies) {
        if (!a.alive || !a.debuff) continue;
        const d = dist(a.pos, w.player.pos);
        if (d < bd) {
          bd = d;
          bestAlly = a;
        }
      }
      if (bestAlly) {
        bestAlly.debuff = null;
        bestAlly.debuffMs = 0;
      }
    }
    if (ab === "interrupt") {
      let target = null;
      let bd = 40;
      for (const add of w.adds) {
        if (!add.alive || add.def.job !== "kick" || add.castMs < 0 || add.kicked) continue;
        const d = dist(add.pos, w.player.pos);
        if (d < bd) {
          bd = d;
          target = add;
        }
      }
      if (target) target.kicked = true;
    }
    let best = null;
    for (const inst of w.instances) {
      if (inst.resolved || inst.answered) continue;
      if (inst.def.rule.type !== "press" || inst.def.rule.ability !== ab) continue;
      if (!best || inst.timer < best.timer) best = inst;
    }
    if (best) best.answered = true;
  }
  allyThink(w);
  allyMove(w, dt);
  stepAdds(w, dtMs, dt);
  const swapDef = w.boss.mechanics.find((m) => m.rule.type === "tankSwap");
  if (swapDef && swapDef.rule.type === "tankSwap") {
    const unit = bossUnitFor(w, swapDef.from);
    const tank = currentTank(w, unit);
    const playerIsTank = w.player.role === "tank";
    const handOff = () => {
      const other = w.allies.find((a) => a.role === "tank" && a.alive && a.id !== unit.targetId);
      if (!other) return void 0;
      const theirs = w.bosses.find((b) => b !== unit && b.targetId === other.id);
      if (theirs) theirs.targetId = unit.targetId;
      return other;
    };
    const freeTank = handOff;
    if (tank.stacks >= swapDef.rule.maxStacks) {
      w.overStackMs += dtMs;
      if (tank.isPlayer) {
        if (w.overStackMs > CO_TANK_REACTION_MS) {
          const other = freeTank();
          if (other) {
            unit.targetId = other.id;
            w.overStackMs = 0;
          }
        }
      } else if (!playerIsTank) {
        if (w.overStackMs > 800) {
          const other = freeTank();
          if (other) {
            unit.targetId = other.id;
            w.overStackMs = 0;
          }
        }
      } else if (w.overStackMs > SWAP_GRACE_MS) {
        recordFailure(w, swapDef);
        w.overStackMs = 0;
        unit.targetId = 0;
      }
    } else {
      w.overStackMs = 0;
    }
    for (const a of w.allies) {
      if (a.stacks > 0 && !w.bosses.some((b) => b.targetId === a.id)) {
        a.stacks = Math.max(0, a.stacks - 0.35 * dt);
      }
    }
    if (!w.bosses.some((b) => b.targetId === 0) && w.playerStacks > 0) {
      w.playerStacks = Math.max(0, w.playerStacks - 0.35 * dt);
    }
  }
  for (const inst of w.instances) {
    if (inst.resolved || inst.answered) continue;
    if (inst.def.rule.type !== "press") continue;
    if (abilitiesFor(w.player.role).includes(inst.def.rule.ability)) continue;
    const need = inst.def.rule.ability === "dispel" ? "healer" : "dps";
    if (inst.timer < inst.def.telegraphMs * 0.45 && w.allies.some((a) => a.alive && a.role === need)) {
      inst.answered = true;
    }
  }
  for (const b of w.bosses) {
    if (!b.alive) continue;
    const face = b.targetId >= 0 ? currentTank(w, b).pos : raidAnchor(w);
    const turn = angleDelta(b.angle, Math.atan2(face.y - b.pos.y, face.x - b.pos.x));
    b.angle += Math.max(-1.4 * dt, Math.min(1.4 * dt, turn));
    if (b.targetId >= 0) {
      const to = currentTank(w, b).pos;
      const d = dist(b.pos, to);
      if (d > MELEE_RANGE) {
        const step2 = Math.min(d - MELEE_RANGE, BOSS_FOLLOW_SPEED * dt);
        b.pos.x += (to.x - b.pos.x) / d * step2;
        b.pos.y += (to.y - b.pos.y) / d * step2;
      }
      const r = lenOf(b.pos);
      const rim = w.boss.arenaRadius * 0.88;
      if (r > rim) {
        b.pos.x = b.pos.x / r * rim;
        b.pos.y = b.pos.y / r * rim;
      }
    }
  }
  const apartDef = w.boss.mechanics.find((m) => m.rule.type === "keepApart");
  w.bossesLinked = false;
  if (apartDef && apartDef.rule.type === "keepApart" && w.bosses.length > 1) {
    const held = w.bosses.filter((b) => !b.def.untargetable && b.alive);
    let closest = Infinity;
    for (let i = 0; i < held.length; i++) {
      for (let j = i + 1; j < held.length; j++) {
        closest = Math.min(closest, dist(held[i].pos, held[j].pos));
      }
    }
    if (held.length > 1 && closest < apartDef.rule.minYards) {
      w.bossesLinked = true;
      w.linkedMs += dtMs;
      if (w.linkedMs > LINK_GRACE_MS) {
        w.linkedMs = 0;
        if (apartDef.roles.includes(w.player.role)) recordFailure(w, apartDef);
      }
      if (!w.seen.has(apartDef.id)) {
        w.seen.add(apartDef.id);
        w.announce = apartDef;
      }
    } else {
      w.linkedMs = 0;
    }
  }
  w.bossEnergy = Math.min(100, w.bossEnergy + w.boss.energyPerSec * dt);
  if (w.burnMs > 0) {
    w.burnMs -= dtMs;
    if ((w.player.cooldowns.burst ?? 0) > COOLDOWN_MS.burst - BURST_WINDOW_MS) w.burnUsed = true;
    if (w.burnMs <= 0) {
      const def = w.boss.mechanics.find((m) => m.id === w.burnId);
      if (def && !w.burnUsed && abilitiesFor(w.player.role).includes("burst") && def.roles.includes(w.player.role)) {
        recordFailure(w, def);
      }
      w.burnMs = 0;
      w.burnMult = 1;
      w.burnId = null;
    }
  }
  w.loopTimerMs += dtMs;
  if (w.loopTimerMs >= w.boss.loopIntervalSec * 1e3) {
    w.loopTimerMs = 0;
    const id = w.boss.loop[w.loopIndex % unlockedCount(w)];
    w.loopIndex++;
    fire(w, id);
  }
  if (w.bossEnergy >= 100 && w.boss.atFullEnergy) {
    w.bossEnergy = 0;
    fire(w, w.boss.atFullEnergy);
  }
  for (const id of w.boss.ambient ?? []) {
    const def = w.boss.mechanics.find((m) => m.id === id);
    if (def?.rule.type === "raidDamage") {
      w.raidHealth -= def.rule.dps / 100 * dt;
      if (!w.seen.has(def.id)) {
        w.seen.add(def.id);
        w.announce = def;
      }
    }
  }
  const regen = w.player.role === "healer" ? 0.052 : 0.046;
  w.raidHealth = Math.max(0, Math.min(1, w.raidHealth + regen * dt));
  for (const a of w.allies) {
    if (!a.alive) continue;
    if (w.raidHealth < 0.75) a.health -= (0.75 - w.raidHealth) * 0.09 * dt;
    if (a.health <= 0) {
      a.alive = false;
      a.health = 0;
      w.alliesLost++;
    }
  }
  w.raidHealthLow = Math.min(w.raidHealthLow, w.raidHealth);
  if (w.player.health < 1) {
    const throughput = 0.062 * (0.35 + 0.65 * w.raidHealth);
    w.player.health = Math.min(1, w.player.health + throughput * dt);
  }
  let pooledThisTick = false;
  for (const inst of w.instances) {
    if (inst.drift && !inst.resolved) {
      inst.pos.x += inst.drift.x * dt;
      inst.pos.y += inst.drift.y * dt;
      if (lenOf(inst.pos) > w.boss.arenaRadius) {
        inst.drift.x *= -1;
        inst.drift.y *= -1;
      }
    }
    if (!inst.resolved && inst.def.origin === "boss" && inst.def.shape?.kind !== "circle") {
      const src = bossUnitFor(w, inst.fromId);
      inst.pos = { ...src.pos };
      if (inst.def.rule.type === "faceAway") inst.angle = src.angle;
    }
    if (!inst.resolved && inst.def.rule.type === "carryOut" && inst.carriedByPlayer) {
      inst.pos = { ...w.player.pos };
      w.player.carrying[inst.def.id] = inst.timer;
    }
    if (!inst.resolved && !inst.answered && inst.def.rule.type === "collect") {
      const r = inst.def.shape?.kind === "circle" ? inst.def.shape.radius : 2.5;
      if (dist(inst.pos, w.player.pos) <= r) {
        inst.answered = true;
        inst.timer = 0;
      } else if (w.allies.some((a) => a.alive && dist(inst.pos, a.pos) <= r)) {
        inst.answered = true;
        inst.timer = 0;
      }
    }
    inst.timer -= dtMs;
    if (!inst.resolved && inst.timer <= 0) {
      const before = w.failures.get(inst.def.id)?.count ?? 0;
      resolveInstance(w, inst);
      if (w.drillId === inst.def.id) {
        w.drillReps++;
        if ((w.failures.get(inst.def.id)?.count ?? 0) === before) w.drillClean++;
      }
    }
    if (inst.resolved && inst.def.lingerMs && isInside(inst, w.player.pos)) {
      if (inst.def.popsOnContact) {
        if (!inst.answered) {
          inst.answered = true;
          inst.timer = -1e9;
          if (def_scored(w, inst.def)) recordFailure(w, inst.def);
          hurt(w, inst.def.damage ?? 0.15, inst.def.name);
        }
      } else if (!pooledThisTick) {
        pooledThisTick = true;
        hurt(w, (inst.def.damage ?? 0.15) * 0.5 * dt, inst.def.name);
      }
    }
  }
  w.instances = w.instances.filter((i) => !i.resolved || -i.timer < IMPACT_FLASH_MS || i.def.lingerMs !== void 0 && -i.timer < i.def.lingerMs);
  w.fireCooldown -= dtMs;
  if (input.firing && w.fireCooldown <= 0 && w.player.alive) {
    const target = input.aim ?? nearestBoss(w, w.player.pos).pos;
    const a = Math.atan2(target.y - w.player.pos.y, target.x - w.player.pos.x);
    w.shots.push({
      pos: { ...w.player.pos },
      vel: { x: Math.cos(a) * SHOT_SPEED, y: Math.sin(a) * SHOT_SPEED },
      // Long enough to cross the arena. Tying this to ATTACK_RANGE meant shots
      // expired at 32 yards on a 44-yard floor, so a ranged player physically
      // could not hit the boss — accuracy fell to 2% on the wider fights.
      life: w.boss.arenaRadius * 2.1 / SHOT_SPEED * 1e3
    });
    w.shotsFired++;
    w.fireCooldown = FIRE_INTERVAL_MS;
  }
  const base = w.player.role === "dps" ? 1 : w.player.role === "tank" ? 0.82 : 0.75;
  const bursting = (w.player.cooldowns.burst ?? 0) > COOLDOWN_MS.burst - BURST_WINDOW_MS;
  const perShot = base * (bursting ? 3 : 1) / (w.boss.pullLengthSec * SHOTS_PER_SEC * 0.46);
  for (const s of w.shots) {
    if (s.life <= 0) continue;
    s.pos.x += s.vel.x * dt;
    s.pos.y += s.vel.y * dt;
    s.life -= dtMs;
    let consumed = false;
    for (const add of w.adds) {
      if (!add.alive || dist(s.pos, add.pos) > ADD_HIT_RADIUS) continue;
      s.life = 0;
      consumed = true;
      w.shotsHit++;
      if (add.def.job === "leave") {
        add.alive = false;
        recordAddFailure(w, add.def);
        w.raidHealth -= 0.16;
        if (add.def.lethal) hurt(w, 0.4, add.def.name);
        break;
      }
      if (add.shield > 0) add.shield -= ADD_SHOT_DAMAGE;
      else add.hp -= ADD_SHOT_DAMAGE;
      if (add.hp <= 0) {
        add.alive = false;
        w.addsKilled++;
      }
      break;
    }
    if (consumed) continue;
    for (const b of w.bosses) {
      if (b.def.untargetable || !b.alive) continue;
      if (dist(s.pos, b.pos) > BOSS_HIT_RADIUS) continue;
      s.life = 0;
      w.shotsHit++;
      const live = w.bosses.filter((x) => !x.def.untargetable).length || 1;
      b.hp -= (w.bossesLinked ? perShot * 0.01 : perShot) * (w.burnMs > 0 ? w.burnMult : 1) * live;
      if (b.hp <= 0) {
        b.hp = 0;
        b.alive = false;
      }
      break;
    }
  }
  w.shots = w.shots.filter((s) => s.life > 0);
  const targetable = w.bosses.filter((b) => !b.def.untargetable);
  w.bossHp = targetable.reduce((n, b) => n + Math.max(0, b.hp), 0) / Math.max(1, targetable.length);
  if (targetable.every((b) => !b.alive) && !w.killed) {
    w.bossHp = 0;
    w.killed = true;
  }
  const syncDef = w.boss.mechanics.find((m) => m.rule.type === "syncKill");
  if (syncDef && syncDef.rule.type === "syncKill" && targetable.length > 1) {
    const anyDead = targetable.some((b) => !b.alive);
    if (anyDead && !w.killed) {
      w.soloMs += dtMs;
      if (!w.seen.has(syncDef.id)) {
        w.seen.add(syncDef.id);
        w.announce = syncDef;
      }
      if (w.soloMs > syncDef.rule.withinSec * 1e3) {
        w.soloMs = 0;
        if (syncDef.roles.includes(w.player.role)) recordFailure(w, syncDef);
        w.raidHealth -= 0.2;
      }
    } else {
      w.soloMs = 0;
    }
  }
  if (w.raidHealth <= 0 && w.player.alive) {
    w.player.alive = false;
    w.deathCause = "Raid wiped \u2014 healing could not keep up";
  }
  w.shake = Math.max(0, w.shake - dt * 3);
  w.prompt = computePrompt(w);
}
function isInMelee(w) {
  return dist(w.player.pos, nearestBoss(w, w.player.pos).pos) <= MELEE_RANGE;
}
function buildResult(w) {
  const survived = w.elapsedMs / 1e3;
  return {
    bossKey: w.boss.key,
    role: w.player.role,
    survivedSec: Math.round(survived),
    pullLengthSec: w.boss.pullLengthSec,
    cleared: w.killed,
    bossHpLeft: w.bossHp,
    deathCause: w.deathCause,
    failures: [...w.failures.values()].sort((a, b) => b.count - a.count),
    mechanicsResolved: w.resolvedCount,
    raidHealthLow: w.raidHealthLow,
    alliesLost: w.alliesLost,
    shotsFired: w.shotsFired,
    shotsHit: w.shotsHit,
    addsKilled: w.addsKilled,
    addsLeaked: w.addsLeaked
  };
}
export {
  COOLDOWN_MS,
  IMPACT_FLASH_MS,
  TICK_MS,
  abilitiesFor,
  bossUnitFor,
  buildResult,
  createDrill,
  createWorld,
  currentTank,
  fire,
  isInMelee,
  isInside,
  nearestBoss,
  primaryBoss,
  step,
  unlockedCount,
  upcoming
};
