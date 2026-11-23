import "./style.css";
import { createAudio } from "./audio";
import { CARDS, cardLabel, type CardId, type DayRole, type HallState, type RoomProp } from "./types";
import { createWorld } from "./world";

const view = document.querySelector<HTMLElement>("#view");
if (!view) throw new Error("missing view");

const audio = createAudio();
const world = createWorld(view, {
  onMove(x, z, roomId, pose) {
    send(roomId ? { type: "move", x, z, roomId, pose: pose ?? "stand" } : { type: "move", x, z });
  },
  onExit() {
    insideId = null;
    render();
  },
  onCake() {
    audio.start();
    if (!audio.song()) toast("소리를 켜면 케이크에서 노래가 나와요.");
  },
  onMirror() {
    toast("거울에 모습이 비쳤어요.");
  },
  onNote(message) {
    toast(message);
  },
});

const roleEl = document.querySelector<HTMLElement>("#role");
const dateEl = document.querySelector<HTMLElement>("#date");
const countEl = document.querySelector<HTMLElement>("#count");
const yesterdayEl = document.querySelector<HTMLElement>("#yesterday");
const gateDate = document.querySelector<HTMLElement>("#gate-date");
const kicker = document.querySelector<HTMLElement>("#dock-kicker");
const title = document.querySelector<HTMLElement>("#dock-title");
const sub = document.querySelector<HTMLElement>("#dock-sub");
const wishes = document.querySelector<HTMLElement>("#dock-wishes");
const guideActions = document.querySelector<HTMLElement>("#dock-guide");
const wishActions = document.querySelector<HTMLElement>("#dock-wish");
const roomActions = document.querySelector<HTMLElement>("#dock-rooms");
const soundBtn = document.querySelector<HTMLButtonElement>("#sound");
const toasts = document.querySelector<HTMLElement>("#toasts");
const gateName = document.querySelector<HTMLInputElement>("#gate-name");
const noteEl = document.querySelector<HTMLElement>("#dock-note");

let state: HallState | null = null;
let selectedId: string | null = null;
let soundOn = true;
let bowLock = 0;
let bowTimer = 0;
let socket: WebSocket | null = null;
let retry = 0;
let entered = false;
const LOOKS = [
  { id: "soft", label: "포근", color: "#e4d2b8", skin: "#f0d0b4", hair: "#4a3b34" },
  { id: "night", label: "밤", color: "#31445f", skin: "#e2b48f", hair: "#1c1614" },
  { id: "flower", label: "꽃", color: "#c45d6e", skin: "#f3d0c4", hair: "#6a2e38" },
  { id: "moss", label: "이끼", color: "#3e6b4c", skin: "#d7a07a", hair: "#2c261e" },
  { id: "lantern", label: "등불", color: "#d0893a", skin: "#e8c09a", hair: "#3a2a1c" },
  { id: "moon", label: "달", color: "#6a86a8", skin: "#f3d7c4", hair: "#1e2836" },
] as const;

let chosen: DayRole | null = null;
let pendingEntry: { role: DayRole; name: string } | null = null;
let selectedLook: (typeof LOOKS)[number]["id"] = "soft";
let lookTouched = false;
let insideId: string | null = null;
let listFilter: "all" | "birthday" | "empty" = "all";
type SheetTab = "guide" | "wish" | "rooms";
let sheet: SheetTab = "guide";
let sheetOpen = false;

function paintSheet() {
  document.body.dataset.sheet = sheet;
  document.body.classList.toggle("sheet-open", sheetOpen);
  document.querySelectorAll<HTMLButtonElement>("#tabbar [data-tab]").forEach((btn) => {
    const on = sheetOpen && btn.dataset.tab === sheet;
    btn.classList.toggle("on", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });
}

function openSheet(next: SheetTab) {
  if (sheet === next && sheetOpen) sheetOpen = false;
  else {
    sheet = next;
    sheetOpen = true;
  }
  if (dockFolded) setDockFolded(false);
  paintSheet();
}

document.querySelector("#tabbar")?.addEventListener("click", (event) => {
  const btn = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-tab]");
  const next = btn?.dataset.tab;
  if (next !== "guide" && next !== "wish" && next !== "rooms") return;
  openSheet(next);
});
const foldBtn = document.querySelector<HTMLButtonElement>("#dock-fold");
let dockFolded = false;

function setDockFolded(folded: boolean) {
  dockFolded = folded;
  document.body.classList.toggle("dock-collapsed", dockFolded);
  if (foldBtn) foldBtn.textContent = dockFolded ? "안내" : "접기";
}

function openDock() {
  if (dockFolded) setDockFolded(false);
  sheet = "guide";
  sheetOpen = true;
  paintSheet();
}

foldBtn?.addEventListener("click", () => setDockFolded(!dockFolded));

const hot = (import.meta as { hot?: { dispose: (cb: () => void) => void } }).hot;
hot?.dispose(() => {
  socket?.close();
  world.destroy();
});

function clientId() {
  const key = "today-birthday-id";
  const saved = localStorage.getItem(key);
  if (saved && /^[a-zA-Z0-9_-]{8,80}$/.test(saved)) return saved;
  const next = crypto.randomUUID().replace(/-/g, "");
  localStorage.setItem(key, next);
  return next;
}

const me = clientId();

function seoulDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function formatDate(iso: string) {
  const zoned = new Date(`${iso}T12:00:00+09:00`);
  const weekday = new Intl.DateTimeFormat("ko-KR", {
    weekday: "long",
    timeZone: "Asia/Seoul",
  }).format(zoned);
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  return `${month}월 ${day}일 ${weekday}`;
}

if (gateDate) gateDate.textContent = formatDate(seoulDate());

function toast(message: string) {
  if (!toasts) return;
  const item = document.createElement("div");
  item.className = "toast";
  item.textContent = message;
  toasts.append(item);
  setTimeout(() => item.remove(), 3200);
}

gateName?.addEventListener("input", () => {
  gateName.dataset.touched = "1";
});

function showNote(occupant: { name: string; note?: string } | null | undefined) {
  if (!noteEl) return;
  const text = occupant?.note?.trim() ?? "";
  if (!text) {
    noteEl.hidden = true;
    noteEl.replaceChildren();
    return;
  }
  const who = document.createElement("b");
  who.textContent = occupant?.name ?? "";
  noteEl.hidden = false;
  noteEl.replaceChildren(who, document.createTextNode(text));
}

function claimForm(roomId: string) {
  const form = document.createElement("form");
  form.className = "claim-form";
  const label = document.createElement("label");
  label.className = "claim-label";
  label.textContent = "들어온 사람에게 먼저 보일 말";
  const input = document.createElement("input");
  input.type = "text";
  input.maxLength = 40;
  input.placeholder = "오늘은 제 생일이에요";
  input.autocomplete = "off";
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "primary";
  submit.textContent = "이 방을 오늘의 공간으로 고르기";
  form.append(label, input, submit);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    send({ type: "claim", roomId, note: input.value.trim() });
  });
  return form;
}

function releaseButton() {
  return button("이 방을 비우기", "texty", () => send({ type: "release" }));
}

function goToRoom(id: string) {
  if (insideId === id) {
    selectedId = id;
    openDock();
    world.setSelected(id);
    render();
    return;
  }
  if (insideId) {
    insideId = null;
    world.leaveRoom();
  }
  selectedId = id;
  openDock();
  world.walkToRoom(id);
  world.setSelected(id);
  render();
}

function appendRoomList() {
  if (!roomActions || !state) return;
  const rooms = state.rooms.filter((room) => {
    if (listFilter === "birthday") return !!room.occupant;
    if (listFilter === "empty") return !room.occupant;
    return true;
  });
  const wrap = document.createElement("div");
  wrap.className = "room-list";
  const filters = document.createElement("div");
  filters.className = "room-filters";
  for (const [id, label] of [
    ["all", "전체"],
    ["birthday", "생일 방"],
    ["empty", "빈 방"],
  ] as const) {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.textContent = label;
    tab.className = listFilter === id ? "on" : "";
    tab.addEventListener("click", () => {
      listFilter = id;
      render();
    });
    filters.append(tab);
  }
  wrap.append(filters);
  if (!rooms.length) {
    const empty = document.createElement("p");
    empty.className = "room-empty";
    empty.textContent = listFilter === "empty" ? "빈 방이 없어요." : "생일인 방이 없어요.";
    wrap.append(empty);
  } else {
    const list = document.createElement("ul");
    for (const room of rooms) {
      const li = document.createElement("li");
      const name = document.createElement("b");
      name.textContent = room.title;
      const meta = document.createElement("span");
      meta.textContent = room.occupant
        ? `${room.occupant.name} · 촛불 ${room.candleCount ?? room.candles.length}`
        : "비어 있음";
      if (room.id === insideId) li.classList.add("here");
      const go = document.createElement("button");
      go.type = "button";
      go.textContent = room.id === insideId ? "여기" : room.id === state.yourRoomId ? "내 방" : "가기";
      if (room.id === insideId) go.disabled = true;
      go.addEventListener("click", () => goToRoom(room.id));
      li.append(name, meta, go);
      list.append(li);
    }
    wrap.append(list);
  }
  roomActions.append(wrap);
}

function wishNote(text: string) {
  if (!wishActions) return;
  const note = document.createElement("p");
  note.className = "wish-empty";
  note.textContent = text;
  wishActions.append(note);
}

function appendOwnWishes() {
  const room = mineRoom(state);
  if (!room || !wishActions) return;
  const lines = room.candles.slice(-12).reverse();
  if (lines.length) wishNodes(lines);
  else wishNote("아직 도착한 축하가 없어요.");
  const cooling = Date.now() < bowLock;
  const bow = button(cooling ? "고마움을 전했어요" : "고개 숙여 고마워하기", "primary", () => {
    if (Date.now() < bowLock) return;
    bowLock = Date.now() + 8000;
    send({ type: "bow" });
    render();
  });
  bow.disabled = cooling;
  wishActions.append(bow);
  armBowRefresh();
}

function finishDock() {
  if (wishes && wishActions && !wishes.childElementCount && !wishActions.childElementCount) {
    if (state?.yourRole === "birthday" && mineRoom(state)) appendOwnWishes();
    else if (state?.yourRole === "birthday") wishNote("빈 방을 고르면 받은 축하가 여기 모여요.");
    else wishNote("생일인 방에 들어가면 축하를 남길 수 있어요.");
  }
  paintSheet();
}

function button(label: string, className: string, onClick: () => void) {
  const el = document.createElement("button");
  el.type = "button";
  el.className = className;
  el.textContent = label;
  el.addEventListener("click", onClick);
  return el;
}

function send(message: object) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function wishLine(candle: { card: string; text?: string }) {
  return candle.text?.trim() || cardLabel(candle.card);
}

function setLines(el: HTMLElement, lines: string[]) {
  el.replaceChildren();
  lines.filter(Boolean).forEach((line, index) => {
    if (index) el.append(document.createElement("br"));
    el.append(document.createTextNode(line));
  });
}

function wishNodes(
  lines: { fromId: string; fromName: string; card: string; text?: string; online?: boolean | null }[],
) {
  if (!wishes) return;
  wishes.replaceChildren();
  const thanked = new Set<string>();
  for (const line of lines) {
    const li = document.createElement("li");
    const who = document.createElement("p");
    who.className = "who-line";
    if (line.online === true || line.online === false) {
      const dot = document.createElement("i");
      dot.className = line.online ? "presence here" : "presence away";
      dot.title = line.online ? "온라인" : "오프라인";
      who.append(dot);
    }
    const name = document.createElement("b");
    name.textContent = line.fromName;
    who.append(name);
    const wish = document.createElement("p");
    wish.className = "wish-line";
    wish.textContent = wishLine(line);
    li.append(who, wish);
    if (line.online != null && line.fromId !== me && !thanked.has(line.fromId)) {
      thanked.add(line.fromId);
      const form = document.createElement("form");
      form.className = "thank-row";
      const input = document.createElement("input");
      input.type = "text";
      input.maxLength = 40;
      input.placeholder = "전할 말";
      input.autocomplete = "off";
      input.disabled = !line.online;
      const thank = document.createElement("button");
      thank.type = "submit";
      thank.textContent = "고마워";
      thank.disabled = !line.online;
      form.append(input, thank);
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        if (!line.online) return;
        send({ type: "bow", toId: line.fromId, text: input.value.trim() });
        input.value = "";
      });
      li.append(form);
    }
    wishes.append(li);
  }
}

function armBowRefresh() {
  if (bowTimer || bowLock <= Date.now()) return;
  bowTimer = window.setTimeout(() => {
    bowTimer = 0;
    render();
  }, bowLock - Date.now() + 40);
}

function mineRoom(current: HallState | null) {
  if (!current?.yourRoomId) return null;
  return current.rooms.find((room) => room.id === current.yourRoomId) ?? null;
}

function render() {
  const candles = state?.rooms.reduce((sum, room) => sum + (room.candleCount ?? room.candles.length), 0) ?? 0;
  const birthdayCount = state?.rooms.filter((room) => room.occupant).length ?? 0;
  const emptyCount = state ? state.rooms.length - birthdayCount : 0;
  const mine = mineRoom(state);
  const role = state?.yourRole ?? chosen;
  if (dateEl) dateEl.textContent = state ? formatDate(state.date) : "";
  if (roleEl) {
    roleEl.textContent = !role
      ? ""
      : role === "guest"
        ? `축하하러 왔어요 · ${state?.yourName ?? ""} · 오늘은 내 생일이 아니에요`
        : mine
          ? `오늘은 내 생일 · ${state?.yourName ?? ""} · ${mine.title}`
          : `오늘은 내 생일 · ${state?.yourName ?? ""} · 빈 방을 찾아가세요`;
  }
  if (countEl) {
    countEl.textContent = state
      ? `오늘 생일 ${birthdayCount}명 · 빈 방 ${emptyCount}곳 · 촛불 ${candles.toLocaleString("ko-KR")}`
      : "";
  }
  if (yesterdayEl) {
    yesterdayEl.textContent = state && state.yesterday > 0
      ? `어제 촛불 ${state.yesterday.toLocaleString("ko-KR")}개`
      : "";
  }
  paintGate();
  if (state?.yourName) world.setIdentity(state.yourName);
  wearLook();
  document.querySelector("#dock")?.classList.toggle("room", !!insideId && insideId === selectedId);
  if (!kicker || !title || !sub || !guideActions || !wishActions || !roomActions) return;

  const selected = state?.rooms.find((room) => room.id === selectedId) ?? null;
  showNote(selected ? selected.occupant : mine?.occupant);

  wishes?.replaceChildren();
  guideActions.replaceChildren();
  wishActions.replaceChildren();
  roomActions.replaceChildren();
  kicker.textContent = "";
  sub.textContent = "";

  if (!state) {
    title.textContent = retry > 0 ? "마당에 다시 연결하고 있어요" : "마당의 불을 켜는 중";
    finishDock();
    return;
  }

  if (!selected) {
    if (!role) {
      title.textContent = "들어가기 전에 오늘을 정해요";
      finishDock();
      return;
    }
    if (role === "guest") {
      kicker.textContent = "축하하러 왔어요";
      title.textContent = "길을 따라 방을 찾아가세요";
      setLines(sub, ["환한 방이 생일인 사람의 방이에요.", "문을 열고 들어가 축하해 주세요."]);
      appendRoomList();
      finishDock();
      return;
    }
    if (!mine) {
      kicker.textContent = "오늘은 내 생일";
      title.textContent = "길을 따라 빈 방을 찾아가세요";
      setLines(sub, ["빈 방 하나를 오늘의 공간으로 고르세요.", "생일은 들어오기 전에 정해져 있어요."]);
      appendRoomList();
      finishDock();
      return;
    }
    kicker.textContent = "오늘은 내 생일";
    title.textContent = mine.title;
    sub.textContent = `${mine.occupant?.name ?? state.yourName} · 촛불 ${mine.candleCount ?? mine.candles.length}`;
    guideActions.append(
      button("내 방으로 가기", "primary", () => goToRoom(mine.id)),
      releaseButton(),
    );
    appendRoomList();
    finishDock();
    return;
  }

  const owned = selected.id === state.yourRoomId;
  const indoors = insideId === selected.id;
  title.textContent = selected.title;
  if (!indoors) {
    kicker.textContent = selected.occupant ? (owned ? "오늘은 내 생일" : "오늘 생일인 사람") : "비어 있는 방";
    setLines(
      sub,
      selected.occupant
        ? [`${selected.occupant.name}의 방이에요.`, "문을 열면 안으로 들어갈 수 있어요."]
        : [selected.trait, "문을 열면 이 방을 볼 수 있어요."],
    );
    guideActions.append(
      button("문을 열고 들어가기", "primary", () => {
        insideId = selected.id;
        openDock();
        world.enterRoom(selected.id);
        world.setSelected(selected.id);
        render();
      }),
    );
    if (owned) guideActions.append(releaseButton());
  } else if (!selected.occupant) {
    kicker.textContent = "비어 있는 방";
    if (role !== "birthday") {
      setLines(sub, [selected.trait, "오늘은 축하하러 온 날이에요."]);
    } else if (mine) {
      setLines(sub, [selected.trait, `오늘은 이미 ${mine.title}에 있어요.`]);
    } else {
      setLines(sub, [selected.trait, "고르면 이 말이 먼저 보여요."]);
      guideActions.append(claimForm(selected.id));
    }
  } else {
    kicker.textContent = owned ? "오늘은 내 생일" : "오늘 생일인 사람";
    setLines(
      sub,
      owned
        ? [selected.trait, "케이크를 누르면 노래가 나와요.", "소파와 거울도 쓸 수 있어요."]
        : [`${selected.occupant.name}의 방이에요.`, "케이크와 소파, 거울을 눌러 보세요."],
    );
    if (owned) guideActions.append(releaseButton());
    else if (role === "guest" && state.litRoomIds.includes(selected.id)) {
      wishNote("이 방에는 이미 축하를 남겼어요.");
    } else if (role === "guest") {
      const grid = document.createElement("div");
      grid.className = "cards";
      for (const card of CARDS) {
        grid.append(
          button(card.text, "", () => {
            audio.match();
            send({ type: "light", roomId: selected.id, card: card.id satisfies CardId });
          }),
        );
      }
      wishActions.append(grid);
      const form = document.createElement("form");
      form.className = "wish-form";
      const input = document.createElement("input");
      input.type = "text";
      input.maxLength = 40;
      input.placeholder = "직접 한 줄 적기";
      input.autocomplete = "off";
      const submit = document.createElement("button");
      submit.type = "submit";
      submit.textContent = "전하기";
      form.append(input, submit);
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        audio.match();
        send({ type: "light", roomId: selected.id, card: "custom", text });
      });
      wishActions.append(form);
    }
  }

  appendRoomList();
  guideActions.append(
    button(indoors ? "마당으로 나가기" : "닫기", "texty", () => {
      if (indoors) {
        insideId = null;
        world.leaveRoom();
      } else {
        selectedId = null;
        world.setSelected(null);
      }
      render();
    }),
  );
  finishDock();
}

function dockSignature(hall: HallState) {
  return JSON.stringify({
    date: hall.date,
    yesterday: hall.yesterday,
    youId: hall.youId,
    yourName: hall.yourName,
    yourRole: hall.yourRole,
    yourRoomId: hall.yourRoomId,
    litRoomIds: hall.litRoomIds,
    rooms: hall.rooms.map((room) => ({
      id: room.id,
      occupant: room.occupant,
      candleCount: room.candleCount ?? room.candles.length,
      candles: room.candles,
    })),
  });
}

function apply(next: HallState) {
  const prev = state;
  const prevRoom = prev?.yourRoomId ?? null;
  state = next;
  wearLook();
  world.sync(
    next.rooms,
    next.yourRoomId,
    next.walkers.filter((walker) => walker.id !== me),
  );
  if (entered && !prevRoom && next.yourRoomId) {
    selectedId = next.yourRoomId;
    world.walkToRoom(next.yourRoomId);
  }
  if (selectedId && !next.rooms.some((room) => room.id === selectedId)) {
    selectedId = null;
    insideId = null;
    world.leaveRoom();
  }
  world.setSelected(selectedId);
  if (next.event?.kind === "candle" && next.event.ownerId === me) audio.celebrate();
  if (next.thanks) {
    toast(next.thanks.text
      ? `${next.thanks.fromName} · ${next.thanks.text}`
      : `${next.thanks.fromName}님이 고개 숙여 고마워했어요.`);
  }
  if (next.ack === "bow") toast("고마움을 전했어요.");
  if (next.ack === "claim") toast("이 방을 오늘의 공간으로 골랐어요.");
  if (next.ack === "release") toast("방을 비웠어요. 오늘은 다른 빈 방을 고를 수 있어요.");
  if (!entered && pendingEntry && next.yourRole && next.yourName === pendingEntry.name) {
    pendingEntry = null;
    entered = true;
    document.body.classList.add("in");
    audio.start();
    if (!soundOn) audio.setMuted(true);
  }
  if (!prev || dockSignature(prev) !== dockSignature(next) || next.ack) render();
}

function connect() {
  const configured = import.meta.env.VITE_HALL_URL?.trim();
  const hallUrl = configured
    || (location.protocol === "https:" ? `wss://${location.host}` : `ws://${location.hostname}:8787`);
  const ws = new WebSocket(hallUrl);
  socket = ws;
  ws.addEventListener("open", () => {
    retry = 0;
    ws.send(JSON.stringify({ type: "join", clientId: me }));
  });
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as HallState | { type: "error"; message: string };
    if (message.type === "error") {
      pendingEntry = null;
      toast(message.message);
      return;
    }
    if (message.type === "state") apply(message);
  });
  ws.addEventListener("close", () => {
    if (socket !== ws) return;
    retry += 1;
    render();
    window.setTimeout(connect, Math.min(800 * retry, 4000));
  });
}

function savedLook() {
  const look = state?.yourLook;
  if (lookTouched || !look || !LOOKS.some((item) => item.id === look.id)) return null;
  return look;
}

function currentLook() {
  return savedLook() ?? LOOKS.find((look) => look.id === selectedLook) ?? LOOKS[0];
}

function wearLook() {
  const worn = currentLook();
  const saved = savedLook();
  if (saved) selectedLook = saved.id as (typeof LOOKS)[number]["id"];
  world.setLook(worn.color, worn.skin, worn.hair);
  document.querySelectorAll<HTMLButtonElement>("#gate-looks [data-look]").forEach((btn) => {
    const on = btn.dataset.look === selectedLook;
    btn.classList.toggle("on", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });
}

function paintGate() {
  const copy = document.querySelector<HTMLElement>("#gate-copy");
  const birthday = document.querySelector<HTMLButtonElement>("#enter-birthday");
  const guest = document.querySelector<HTMLButtonElement>("#enter-guest");
  if (!copy || !birthday || !guest) return;
  if (gateName && document.activeElement !== gateName && !gateName.dataset.touched) {
    gateName.value = state?.yourName ?? "";
  }
  const role = state?.yourRole ?? null;
  birthday.hidden = role === "guest";
  guest.hidden = role === "birthday";
  guest.classList.toggle("solid", role === "guest");
  if (role === "birthday") {
    copy.innerHTML = "오늘은 이미 생일로 정해져 있어요.<br />빈 방을 찾아 오늘의 공간을 고르세요.";
    birthday.textContent = "생일로 들어가기";
  } else if (role === "guest") {
    copy.innerHTML = "오늘은 축하하러 오기로 정해져 있어요.<br />길을 따라 생일인 사람의 방을 찾아가세요.";
    guest.textContent = "축하하러 들어가기";
  } else {
    copy.innerHTML = "들어가기 전에 오늘을 정해요.<br />한 번 정하면 오늘은 바뀌지 않아요.";
    birthday.textContent = "오늘은 내 생일이에요";
    guest.textContent = "축하하러 왔어요";
  }
}

function cleanName(raw: string) {
  return Array.from(raw.replace(/\s+/g, " ").trim()).slice(0, 12).join("");
}

function enterAs(role: DayRole) {
  if (entered || pendingEntry) return;
  const name = cleanName(gateName?.value ?? "");
  if (!name) {
    toast("이름을 적어 주세요.");
    gateName?.focus();
    return;
  }
  if (socket?.readyState !== WebSocket.OPEN) {
    toast("마당에 연결하고 있어요.");
    return;
  }
  chosen = role;
  pendingEntry = { role, name };
  wearLook();
  send({ type: "role", role, name, look: selectedLook });
}

document.querySelector("#enter-birthday")?.addEventListener("click", () => enterAs("birthday"));
document.querySelector("#enter-guest")?.addEventListener("click", () => enterAs("guest"));

const lookHost = document.querySelector<HTMLElement>("#gate-looks");
for (const look of LOOKS) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.dataset.look = look.id;
  btn.innerHTML = `<i><b class="hair"></b><b class="face"></b><b class="body"></b></i><span>${look.label}</span>`;
  const hair = btn.querySelector<HTMLElement>(".hair");
  const face = btn.querySelector<HTMLElement>(".face");
  const body = btn.querySelector<HTMLElement>(".body");
  if (hair) hair.style.background = look.hair;
  if (face) face.style.background = look.skin;
  if (body) body.style.background = look.color;
  btn.addEventListener("click", () => {
    lookTouched = true;
    selectedLook = look.id;
    wearLook();
  });
  lookHost?.append(btn);
}
wearLook();

soundBtn?.addEventListener("click", () => {
  soundOn = !soundOn;
  audio.setMuted(!soundOn);
  soundBtn.textContent = soundOn ? "소리 켜짐" : "소리 꺼짐";
  if (soundOn) audio.start();
});

let downX = 0;
let downY = 0;
view.addEventListener("pointerdown", (event) => {
  downX = event.clientX;
  downY = event.clientY;
  world.setAutoRotate(false);
});
view.addEventListener("pointerup", (event) => {
  if (!entered) return;
  const dx = event.clientX - downX;
  const dy = event.clientY - downY;
  if (dx * dx + dy * dy > 16) return;
  const hit = world.pick(event);
  if (!hit) return;
  if (insideId) {
    if (hit.kind === "prop") world.useProp(hit.prop satisfies RoomProp);
    else if (hit.kind === "ground") world.walkTo(hit.x, hit.z);
    return;
  }
  if (hit.kind === "room") {
    selectedId = hit.id;
    openDock();
    world.setSelected(hit.id);
    world.walkToRoom(hit.id);
  } else if (hit.kind === "ground") {
    selectedId = null;
    world.setSelected(null);
    world.walkTo(hit.x, hit.z);
  }
  render();
});

window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (insideId) {
    insideId = null;
    world.leaveRoom();
    render();
    return;
  }
  selectedId = null;
  world.setSelected(null);
  render();
});

connect();
render();
