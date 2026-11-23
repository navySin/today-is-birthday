import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const VERSION = 3;
const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 8787);
const SERVE_STATIC = process.env.SERVE_STATIC === "1";
const CARD_TEXT = {
  birthday: "생일 축하해",
  enough: "올해도 수고했어",
  eat: "맛있는 거 먹어",
  health: "건강해",
  soft: "오늘 하루가 포근하길",
  day: "좋은 하루 보내",
  rest: "오늘은 쉬어도 돼",
  glad: "네가 있어서 다행이야",
  side: "올해도 네 편이야",
  warmth: "따뜻하게 지내",
  joy: "작은 기쁨이 많기를",
  slow: "오늘만큼은 느긋하게",
  thanks: "잘 살아줘서 고마워",
  smile: "웃음이 많은 하루이길",
  breath: "편히 숨 쉬어",
  seat: "네 자리가 여기 있어",
};
const CARD_IDS = new Set(Object.keys(CARD_TEXT));
const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "room.json");
const WALK_X = 40;
const WALK_Z_MIN = -40;
const WALK_Z_MAX = 42;

const NAMES = [
  "따뜻한 오후",
  "맑은 초",
  "부드러운 밤",
  "기다린 하루",
  "살며시 온",
  "긴 숨결",
  "따뜻한 손",
  "조용한 문",
  "늦은 차",
  "반짝인 잔",
  "나란한 자리",
  "낮은 목소리",
  "오늘이 온",
  "고운 김",
  "느긋한 등",
  "작은 소원",
  "맑은 숨",
  "포근한 끝",
  "가만히 앉은",
  "불빛 아래",
  "짧은 인사",
  "오래 기다린",
  "부드러운 끝",
  "조용히 온",
  "따뜻한 자리",
];

const COLORS = ["#d8c3a5", "#8d6b4f", "#9aa58a", "#c4786a", "#8aa0b4"];
const SKINS = ["#f0d0b4", "#e2b48f", "#d7a07a", "#c98462"];
const LOOKS = {
  soft: { color: "#e4d2b8", skin: "#f0d0b4", hair: "#4a3b34" },
  night: { color: "#31445f", skin: "#e2b48f", hair: "#1c1614" },
  flower: { color: "#c45d6e", skin: "#f3d0c4", hair: "#6a2e38" },
  moss: { color: "#3e6b4c", skin: "#d7a07a", hair: "#2c261e" },
  lantern: { color: "#d0893a", skin: "#e8c09a", hair: "#3a2a1c" },
  moon: { color: "#6a86a8", skin: "#f3d7c4", hair: "#1e2836" },
};
const DEFAULT_HAIR = "#4a3b34";
const NPCS = [
  { id: "npc:lantern", name: "노란 불빛", color: "#c6a15a", skin: "#f0d0b4", x: -18, z: 6, delay: 7000 },
  { id: "npc:quiet", name: "고요한 창", color: "#7e93a8", skin: "#e2b48f", x: 14, z: 18, delay: 16000 },
  { id: "npc:moon", name: "느린 숨", color: "#6f8f86", skin: "#d7a07a", x: 8, z: -12, delay: 26000 },
];
const GREET_CARDS = ["birthday", "health", "soft", "day", "smile", "joy", "warmth", "glad"];
const npcMind = new Map();

const ROOM_DEFS = [
  { id: "window", title: "창가의 방", trait: "한쪽 창으로 먼 불이 보여요", mood: "cool", x: -16, z: 22, angle: Math.PI / 2 },
  { id: "lantern", title: "등불의 방", trait: "등이 낮게 여러 개 걸려 있어요", mood: "lantern", x: -22, z: -8, angle: Math.PI / 2 },
  { id: "flower", title: "꽃 놓은 방", trait: "작은 꽃이 상 위에 있어요", mood: "flower", x: 20, z: 6, angle: -Math.PI / 2 },
  { id: "quiet", title: "고요한 방", trait: "불빛이 가장 낮아요", mood: "dim", x: 18, z: -20, angle: -Math.PI / 2 },
  { id: "hearth", title: "따뜻한 방", trait: "바닥 가까이 불이 있어요", mood: "warm", x: -16, z: -34, angle: 0 },
  { id: "moon", title: "달빛 방", trait: "조명이 차갑고 조용해요", mood: "moon", x: 22, z: -36, angle: -Math.PI / 2 },
];
const NPC_FROM = new Set(["lantern", "quiet", "moon"]);

const clients = new Map();

function seoulDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function cleanName(raw) {
  const text = String(raw ?? "").replace(/[\u0000-\u001F]+/g, " ").replace(/\s+/g, " ").trim();
  return Array.from(text).slice(0, 12).join("");
}

function cleanWish(raw) {
  const text = String(raw ?? "").replace(/[\u0000-\u001F]+/g, " ").replace(/\s+/g, " ").trim();
  return Array.from(text).slice(0, 40).join("");
}

function makeCandle(fromId, fromName, card, ageMs = 0, text = "") {
  return {
    id: uid(),
    card,
    text: text || CARD_TEXT[card] || "",
    fromId,
    fromName,
    at: Date.now() - ageMs,
  };
}

function placedDefs() {
  return ROOM_DEFS.map((def) => ({ ...def }));
}

function seedRooms() {
  return placedDefs().map((def) => ({
    id: def.id,
    title: def.title,
    trait: def.trait,
    mood: def.mood,
    x: def.x,
    z: def.z,
    angle: def.angle,
    occupant: null,
    candles: [],
    bowReadyAt: 0,
    welcomed: false,
  }));
}

function refreshLayout(rooms) {
  const defs = placedDefs();
  let removedCandles = 0;
  const next = defs.map((def) => {
    const prev = rooms?.find((room) => room.id === def.id);
    const occupant = prev?.occupant?.kind === "hall" ? null : (prev?.occupant ?? null);
    const prevCandles = prev?.candles ?? [];
    const candles = occupant ? prevCandles.filter((candle) => !NPC_FROM.has(candle.fromId)) : [];
    removedCandles += prevCandles.length - candles.length;
    return {
      id: def.id,
      title: def.title,
      trait: def.trait,
      mood: def.mood,
      x: def.x,
      z: def.z,
      angle: def.angle,
      occupant,
      candles,
      bowReadyAt: prev?.bowReadyAt ?? 0,
      welcomed: prev?.welcomed ?? false,
    };
  });
  return { rooms: next, removedCandles };
}

function blank(date, yesterday = 0) {
  const rooms = seedRooms();
  return {
    version: VERSION,
    date,
    yesterday,
    candlesToday: rooms.reduce((sum, place) => sum + place.candles.length, 0),
    rooms,
    lit: {},
    seats: {},
    names: {},
    roles: {},
    looks: {},
    walkers: {},
  };
}

function load() {
  try {
    const data = JSON.parse(fs.readFileSync(FILE, "utf8"));
    const today = seoulDate();
    if (data.version !== VERSION) return blank(today, 0);
    if (data.date !== today) return blank(today, Number(data.candlesToday) || 0);
    const laid = refreshLayout(data.rooms);
    data.rooms = laid.rooms;
    data.candlesToday = Math.max(0, (Number(data.candlesToday) || 0) - laid.removedCandles);
    if (data.lit) {
      for (const id of Object.keys(data.lit)) {
        data.lit[id] = (data.lit[id] ?? []).filter((roomId) => data.rooms.some((room) => room.id === roomId && room.occupant));
      }
    }
    data.walkers = {};
    if (!data.roles) data.roles = {};
    if (!data.looks) data.looks = {};
    return data;
  } catch {
    return blank(seoulDate(), 0);
  }
}

let hall = load();
let saveTimer = null;

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      const { walkers, ...rest } = hall;
      fs.writeFileSync(FILE, JSON.stringify(rest));
    } catch (error) {
      console.error(error);
    }
  }, 150);
}

function ensureDate() {
  const today = seoulDate();
  if (hall.date === today) return;
  hall = blank(today, hall.candlesToday);
  npcMind.clear();
  save();
}

function takenNames() {
  return new Set([
    ...hall.rooms.map((place) => place.occupant?.name).filter(Boolean),
    ...Object.values(hall.names),
    ...NPCS.map((npc) => npc.name),
  ]);
}

function takeName() {
  const used = takenNames();
  return NAMES.find((name) => !used.has(name)) ?? "조용한 손님";
}

function lookOf(id) {
  const chosen = LOOKS[hall.looks?.[id]];
  if (chosen) return { color: chosen.color, skin: chosen.skin, hair: chosen.hair };
  const seatId = hall.seats[id];
  const place = hall.rooms.find((item) => item.id === seatId && item.occupant?.ownerId === id);
  if (place?.occupant) {
    return { color: place.occupant.color, skin: place.occupant.skin, hair: place.occupant.hair || DEFAULT_HAIR };
  }
  let hash = 0;
  for (const char of id) hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
  return { color: COLORS[hash % COLORS.length], skin: SKINS[hash % SKINS.length], hair: DEFAULT_HAIR };
}

function walkerList() {
  return Object.entries(hall.walkers).map(([id, pos]) => {
    const look = lookOf(id);
    return {
      id,
      name: pos.name || hall.names[id] || "손님",
      x: pos.x,
      z: pos.z,
      roomId: hall.seats[id] ?? null,
      visitRoomId: pos.visitRoomId ?? null,
      visitX: pos.visitX ?? 0,
      visitZ: pos.visitZ ?? 0,
      pose: pos.visitPose === "sit" ? "sit" : pos.visitPose === "mirror" ? "mirror" : "stand",
      color: LOOKS[hall.looks?.[id]] ? look.color : pos.color || look.color,
      skin: LOOKS[hall.looks?.[id]] ? look.skin : pos.skin || look.skin,
      hair: LOOKS[hall.looks?.[id]] ? look.hair : pos.hair || look.hair,
    };
  });
}

const thankReady = new Map();

function candleView(candle) {
  const person = Boolean(hall.names[candle.fromId]);
  return { ...candle, online: person ? clients.has(candle.fromId) : null };
}

function snapshot(clientId, extra = {}) {
  return {
    type: "state",
    date: hall.date,
    yesterday: hall.yesterday,
    youId: clientId,
    yourName: hall.names[clientId] ?? "",
    yourLook: LOOKS[hall.looks?.[clientId]]
      ? { id: hall.looks[clientId], ...LOOKS[hall.looks[clientId]] }
      : null,
    yourRole: hall.roles?.[clientId] ?? null,
    yourRoomId: hall.seats[clientId] ?? null,
    litRoomIds: hall.lit[clientId] ?? [],
    rooms: hall.rooms.map((place) => ({
      ...place,
      candleCount: place.candles.length,
      candles: place.occupant?.ownerId === clientId ? place.candles.map(candleView) : [],
    })),
    walkers: walkerList(),
    ...extra,
  };
}

function send(ws, extra) {
  if (!ws.clientId || ws.readyState !== 1) return;
  ws.send(JSON.stringify(snapshot(ws.clientId, extra)));
}

const broadcastQueue = [];
let broadcastTimer = null;

function broadcast(extraFor) {
  if (extraFor) broadcastQueue.push(extraFor);
  if (broadcastTimer) return;
  broadcastTimer = setTimeout(flushBroadcast, 80);
}

function flushBroadcast() {
  broadcastTimer = null;
  const extras = broadcastQueue.splice(0);
  for (const [id, sockets] of clients) {
    const extra = {};
    for (const item of extras) {
      if (item?.ack && item.ack.id === id) extra.ack = item.ack.kind;
      if (item?.event && item.event.ownerId === id) extra.event = item.event;
      if (item?.thanks && item.thanks.to.has(id)) {
        extra.thanks = {
          fromName: item.thanks.fromName,
          ...(item.thanks.text ? { text: item.thanks.text } : {}),
        };
      }
    }
    const raw = JSON.stringify(snapshot(id, extra));
    for (const ws of sockets) {
      if (ws.readyState === 1) ws.send(raw);
    }
  }
}

function fail(ws, message) {
  if (ws.readyState === 1) ws.send(JSON.stringify({ type: "error", message }));
}

function addCandle(place, fromId, fromName, card, text = "") {
  place.candles.push(makeCandle(fromId, fromName, card, 0, text));
  if (place.candles.length > 80) place.candles.shift();
  hall.candlesToday += 1;
}

function ensureNpcs() {
  for (const npc of NPCS) {
    const prev = hall.walkers[npc.id];
    hall.walkers[npc.id] = {
      x: prev?.x ?? npc.x,
      z: prev?.z ?? npc.z,
      name: npc.name,
      color: npc.color,
      skin: npc.skin,
      visitRoomId: prev?.visitRoomId ?? null,
      visitX: prev?.visitX ?? 0,
      visitZ: prev?.visitZ ?? 0,
      visitPose: prev?.visitPose ?? "stand",
    };
    if (!npcMind.has(npc.id)) {
      npcMind.set(npc.id, {
        phase: "wander",
        destX: npc.x,
        destZ: npc.z,
        until: 0,
        roomId: null,
        greeted: false,
        nextVisit: Date.now() + npc.delay,
      });
    }
  }
}

function doorOf(place) {
  return {
    x: place.x + Math.sin(place.angle) * 4.4,
    z: place.z + Math.cos(place.angle) * 4.4,
  };
}

function clampWalkPos(x, z) {
  return {
    x: Math.max(-WALK_X, Math.min(WALK_X, x)),
    z: Math.max(WALK_Z_MIN, Math.min(WALK_Z_MAX, z)),
  };
}

function arrive(px, pz, x, z, step) {
  const dx = x - px;
  const dz = z - pz;
  const dist = Math.hypot(dx, dz);
  if (dist <= step) return { x, z, done: true };
  return { x: px + (dx / dist) * step, z: pz + (dz / dist) * step, done: false };
}

function npcBusy(roomId, exceptId) {
  for (const other of NPCS) {
    if (other.id === exceptId) continue;
    const mind = npcMind.get(other.id);
    if (!mind || mind.roomId !== roomId) continue;
    if (mind.phase === "toDoor" || mind.phase === "inside" || mind.phase === "linger") return true;
  }
  return false;
}

function chooseVisit(npc) {
  const open = hall.rooms.filter((room) => room.occupant?.ownerId && !npcBusy(room.id, npc.id));
  if (!open.length) return null;
  const fresh = open.filter((room) => !room.candles.some((candle) => candle.fromId === npc.id));
  const pool = fresh.length ? fresh : open;
  return pool[Math.floor(Math.random() * pool.length)];
}

function moveOutdoor(pos, x, z) {
  const step = arrive(pos.x, pos.z, x, z, 1.7 * 0.4);
  const next = clampWalkPos(step.x, step.z);
  pos.x = next.x;
  pos.z = next.z;
  pos.visitRoomId = null;
  pos.visitPose = "stand";
  return step.done;
}

function moveIndoor(pos, x, z) {
  const step = arrive(pos.visitX || 0, pos.visitZ || 0, x, z, 0.95 * 0.4);
  pos.visitX = Math.max(-1.7, Math.min(1.7, step.x));
  pos.visitZ = Math.max(-0.7, Math.min(2.5, step.z));
  return step.done;
}

function leaveVisit(pos, mind) {
  const place = hall.rooms.find((room) => room.id === mind.roomId);
  const door = place ? doorOf(place) : { x: pos.x, z: pos.z };
  const spot = clampWalkPos(door.x, door.z);
  pos.x = spot.x;
  pos.z = spot.z;
  pos.visitRoomId = null;
  pos.visitX = 0;
  pos.visitZ = 0;
  pos.visitPose = "stand";
  mind.phase = "pause";
  mind.until = Date.now() + 1200;
  mind.roomId = null;
  mind.greeted = false;
  mind.nextVisit = Date.now() + 28000 + Math.random() * 22000;
}

function npcGreet(npc, place, pending) {
  if (!place?.occupant?.ownerId) return;
  if (place.candles.some((candle) => candle.fromId === npc.id)) return;
  const card = GREET_CARDS[Math.floor(Math.random() * GREET_CARDS.length)];
  addCandle(place, npc.id, npc.name, card);
  save();
  pending.event = { kind: "candle", roomId: place.id, ownerId: place.occupant.ownerId };
}

function tickNpc(npc, pending) {
  const pos = hall.walkers[npc.id];
  const mind = npcMind.get(npc.id);
  const now = Date.now();
  if (!pos || !mind) return;
  if (mind.phase === "pause") {
    if (now < mind.until) return;
    mind.destX = (Math.random() * 2 - 1) * 24;
    mind.destZ = -22 + Math.random() * 48;
    mind.phase = "wander";
  }
  if (mind.phase === "wander") {
    if (now >= mind.nextVisit) {
      const room = chooseVisit(npc);
      if (room) {
        const door = doorOf(room);
        mind.phase = "toDoor";
        mind.roomId = room.id;
        mind.destX = door.x;
        mind.destZ = door.z;
        mind.greeted = false;
      } else mind.nextVisit = now + 8000;
    }
    if (mind.phase === "wander" && moveOutdoor(pos, mind.destX, mind.destZ)) {
      mind.phase = "pause";
      mind.until = now + 1400 + Math.random() * 2200;
    }
    return;
  }
  if (mind.phase === "toDoor") {
    const place = hall.rooms.find((room) => room.id === mind.roomId && room.occupant?.ownerId);
    if (!place) {
      mind.phase = "wander";
      mind.roomId = null;
      mind.nextVisit = now + 10000;
      return;
    }
    if (moveOutdoor(pos, mind.destX, mind.destZ)) {
      mind.phase = "inside";
      mind.destX = 0.3;
      mind.destZ = 0.2;
      pos.visitRoomId = place.id;
      pos.visitX = 0;
      pos.visitZ = 2.3;
      pos.visitPose = "stand";
    }
    return;
  }
  if (mind.phase === "inside") {
    const place = hall.rooms.find((room) => room.id === mind.roomId && room.occupant?.ownerId);
    if (!place) {
      leaveVisit(pos, mind);
      return;
    }
    pos.visitRoomId = place.id;
    if (moveIndoor(pos, mind.destX, mind.destZ)) {
      if (!mind.greeted) {
        npcGreet(npc, place, pending);
        mind.greeted = true;
      }
      mind.phase = "linger";
      mind.until = now + 4500;
    }
    return;
  }
  if (mind.phase === "linger") {
    const place = hall.rooms.find((room) => room.id === mind.roomId && room.occupant?.ownerId);
    if (!place || now >= mind.until) leaveVisit(pos, mind);
  }
}

function tickNpcs() {
  ensureDate();
  ensureNpcs();
  const pending = {};
  for (const npc of NPCS) tickNpc(npc, pending);
  if (clients.size) broadcast(pending.event ? { event: pending.event } : undefined);
}

function onJoin(ws, clientId) {
  ensureDate();
  if (!hall.names[clientId]) {
    hall.names[clientId] = takeName();
    save();
  }
  if (!hall.walkers[clientId]) hall.walkers[clientId] = { x: 0, z: 34 };
  let sockets = clients.get(clientId);
  if (!sockets) {
    sockets = new Set();
    clients.set(clientId, sockets);
  }
  sockets.add(ws);
  ws.clientId = clientId;
  send(ws);
}

function onMove(ws, x, z, roomId, pose) {
  if (typeof x !== "number" || typeof z !== "number" || !Number.isFinite(x) || !Number.isFinite(z)) return;
  const prev = hall.walkers[ws.clientId] ?? { x: 0, z: 34 };
  if (typeof roomId === "string" && roomId) {
    if (!hall.rooms.some((item) => item.id === roomId)) return;
    prev.visitRoomId = roomId;
    prev.visitX = Math.max(-2.75, Math.min(2.75, x));
    prev.visitZ = Math.max(-0.85, Math.min(2.85, z));
    prev.visitPose = pose === "sit" ? "sit" : pose === "mirror" ? "mirror" : "stand";
  } else {
    prev.x = Math.max(-WALK_X, Math.min(WALK_X, x));
    prev.z = Math.max(WALK_Z_MIN, Math.min(WALK_Z_MAX, z));
    prev.visitRoomId = null;
    prev.visitX = 0;
    prev.visitZ = 0;
    prev.visitPose = "stand";
  }
  hall.walkers[ws.clientId] = prev;
  broadcast();
}

function onLight(ws, roomId, card, rawText) {
  ensureDate();
  const clientId = ws.clientId;
  const place = hall.rooms.find((item) => item.id === roomId);
  let text = "";
  if (card === "custom") {
    text = cleanWish(rawText);
    if (!text) {
      fail(ws, "한 줄로 짧게 적어 주세요.");
      return;
    }
  } else if (CARD_TEXT[card]) {
    text = CARD_TEXT[card];
  } else return;
  if (!place) return;
  if (!place.occupant) {
    fail(ws, hall.roles?.[clientId] === "birthday"
      ? "비어 있는 방이에요. 오늘의 공간으로 고를 수 있어요."
      : "비어 있는 방이에요.");
    return;
  }
  if (place.occupant.ownerId === clientId) {
    fail(ws, "내 방에는 촛불을 켤 수 없어요.");
    return;
  }
  if (!hall.lit[clientId]) hall.lit[clientId] = [];
  if (hall.lit[clientId].includes(roomId)) {
    fail(ws, "이 방에는 이미 촛불을 켰어요.");
    return;
  }
  hall.lit[clientId].push(roomId);
  addCandle(place, clientId, hall.names[clientId] ?? "누군가", card === "custom" ? "custom" : card, text);
  save();
  broadcast({
    event: { kind: "candle", roomId: place.id, ownerId: place.occupant.ownerId },
  });

  if (place.occupant.kind === "hall") {
    const today = hall.date;
    setTimeout(() => {
      if (hall.date !== today) return;
      const still = hall.rooms.find((item) => item.id === place.id && item.occupant);
      if (!still) return;
      still.occupant.bowingUntil = Date.now() + 1500;
      save();
      broadcast({
        thanks: { to: new Set([clientId]), fromName: still.occupant.name },
      });
    }, 1100);
  }
}

function onName(ws, raw) {
  const clientId = ws.clientId;
  const next = cleanName(raw);
  if (!next) {
    fail(ws, "이름을 적어 주세요.");
    return false;
  }
  const current = hall.names[clientId] ?? "";
  if (next === current) return true;
  const used = takenNames();
  if (current) used.delete(current);
  if (used.has(next)) {
    fail(ws, "오늘 그 이름은 이미 쓰이고 있어요.");
    return false;
  }
  hall.names[clientId] = next;
  for (const place of hall.rooms) {
    if (place.occupant?.ownerId === clientId) place.occupant.name = next;
  }
  return true;
}

function applyLook(clientId, lookId) {
  const look = LOOKS[lookId];
  if (!look) return;
  if (!hall.looks) hall.looks = {};
  hall.looks[clientId] = lookId;
  const walker = hall.walkers[clientId];
  if (walker) {
    walker.color = look.color;
    walker.skin = look.skin;
    walker.hair = look.hair;
  }
  for (const place of hall.rooms) {
    if (place.occupant?.ownerId !== clientId) continue;
    place.occupant.color = look.color;
    place.occupant.skin = look.skin;
    place.occupant.hair = look.hair;
  }
}

function onRole(ws, role, rawName, lookId) {
  if (role !== "birthday" && role !== "guest") return;
  if (!hall.roles) hall.roles = {};
  if (rawName !== undefined && !onName(ws, rawName)) return;
  if (!hall.roles[ws.clientId]) hall.roles[ws.clientId] = role;
  if (typeof lookId === "string") applyLook(ws.clientId, lookId);
  save();
  broadcast();
}

function onClaim(ws, roomId, rawNote) {
  ensureDate();
  const clientId = ws.clientId;
  if (hall.roles?.[clientId] !== "birthday") {
    fail(ws, "축하하러 온 오늘은 방을 고를 수 없어요.");
    return;
  }
  if (hall.seats[clientId]) {
    fail(ws, "오늘은 이미 방을 골랐어요.");
    return;
  }
  const place = hall.rooms.find((item) => item.id === roomId);
  if (!place) return;
  if (place.occupant) {
    fail(ws, "이 방은 이미 누군가의 생일 공간이에요.");
    return;
  }
  const look = lookOf(clientId);
  place.occupant = {
    name: hall.names[clientId],
    kind: "guest",
    ownerId: clientId,
    color: look.color,
    skin: look.skin,
    hair: look.hair,
    bowingUntil: 0,
    note: cleanWish(rawNote),
  };
  place.welcomed = false;
  place.bowReadyAt = 0;
  addCandle(place, "hall", "이 홀", "soft");
  hall.seats[clientId] = place.id;
  save();
  broadcast({ ack: { id: clientId, kind: "claim" } });
}

function onRelease(ws) {
  ensureDate();
  const clientId = ws.clientId;
  const roomId = hall.seats[clientId];
  const place = hall.rooms.find((item) => item.id === roomId);
  if (!place?.occupant || place.occupant.ownerId !== clientId) {
    fail(ws, "비울 수 있는 방이 없어요.");
    return;
  }
  place.occupant = null;
  place.candles = [];
  place.welcomed = false;
  place.bowReadyAt = 0;
  delete hall.seats[clientId];
  for (const ids of Object.values(hall.lit)) {
    const index = ids.indexOf(place.id);
    if (index >= 0) ids.splice(index, 1);
  }
  save();
  broadcast({ ack: { id: clientId, kind: "release" } });
}

function onBow(ws, toId, rawText) {
  ensureDate();
  const clientId = ws.clientId;
  const place = hall.rooms.find((item) => item.id === hall.seats[clientId]);
  if (!place?.occupant) {
    fail(ws, "방을 고른 뒤에 전할 수 있어요.");
    return;
  }
  const now = Date.now();
  const people = place.candles
    .map((candle) => candle.fromId)
    .filter((id) => hall.names[id] && id !== clientId);
  let targets;
  if (typeof toId === "string" && toId) {
    if (!people.includes(toId)) {
      fail(ws, "이 방에 인사를 남긴 사람이 아니에요.");
      return;
    }
    if (!clients.has(toId)) {
      fail(ws, "지금은 마당에 없어요.");
      return;
    }
    const key = `${place.id}:${toId}`;
    if (now < (thankReady.get(key) || 0)) {
      fail(ws, "방금 그 사람에게 고마워했어요.");
      return;
    }
    thankReady.set(key, now + 8000);
    targets = new Set([toId]);
  } else {
    if (now < place.bowReadyAt) {
      fail(ws, "조금만 있다가 다시 전해 주세요.");
      return;
    }
    place.bowReadyAt = now + 8000;
    targets = new Set(people.filter((id) => clients.has(id)));
  }
  place.occupant.bowingUntil = now + 1500;
  const text = typeof toId === "string" && toId ? cleanWish(rawText) : "";
  save();
  broadcast({
    ack: { id: clientId, kind: "bow" },
    thanks: { to: targets, fromName: place.occupant.name, text },
  });
}

const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
const FILE_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function serveStatic(req, res) {
  const url = new URL(req.url || "/", "http://localhost");
  const pathname = decodeURIComponent(url.pathname);
  const root = path.resolve(DIST);
  let file = path.resolve(root, `.${pathname}`);
  if (pathname.includes("\0") || (file !== root && !file.startsWith(`${root}${path.sep}`))) {
    res.writeHead(400);
    res.end();
    return;
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, "index.html");
  if (!fs.existsSync(file)) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, { "content-type": FILE_TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}

const wss = SERVE_STATIC
  ? new WebSocketServer({ noServer: true })
  : new WebSocketServer({ port: PORT, host: HOST });

if (SERVE_STATIC) {
  const server = http.createServer(serveStatic);
  server.on("upgrade", (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });
  server.listen(PORT, HOST, () => {
    console.log(`yard  http://${HOST}:${PORT}`);
  });
}

wss.on("connection", (ws) => {
  ws.on("message", (buf) => {
    let message;
    try {
      message = JSON.parse(buf.toString());
    } catch {
      return;
    }
    if (message.type === "join") {
      if (typeof message.clientId !== "string" || !/^[a-zA-Z0-9_-]{8,80}$/.test(message.clientId)) {
        fail(ws, "마당에 들어가지 못했어요.");
        return;
      }
      onJoin(ws, message.clientId);
      return;
    }
    if (!ws.clientId) return;
    if (message.type === "role") onRole(ws, message.role, message.name, message.look);
    if (message.type === "move") onMove(ws, message.x, message.z, message.roomId, message.pose);
    if (message.type === "light") onLight(ws, message.roomId, message.card, message.text);
    if (message.type === "claim") onClaim(ws, message.roomId, message.note);
    if (message.type === "release") onRelease(ws);
    if (message.type === "bow") onBow(ws, message.toId, message.text);
  });

  ws.on("close", () => {
    const sockets = clients.get(ws.clientId);
    if (!sockets) return;
    sockets.delete(ws);
    if (sockets.size === 0) {
      clients.delete(ws.clientId);
      const walker = hall.walkers[ws.clientId];
      if (walker?.visitRoomId) walker.visitRoomId = null;
      broadcast();
    }
  });
});

setInterval(ensureDate, 20000);
setInterval(tickNpcs, 400);

if (!SERVE_STATIC) {
  wss.on("listening", () => {
    console.log(`hall  ws://${HOST}:${PORT}`);
  });
}
