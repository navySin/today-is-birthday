import "./style.css";
import { accountFace, accountReady, adoptAccountSession, currentAccount, holdAccountRefresh, loadHallSetup, loadHallSpaces, onAccount, parseHallSetup, resetAccountPassword, saveHallSetup, signInAccount, signInWithGoogle, signOutAccount, signUpAccount, type HallMusic, type HallMusicTrack, type HallSetup, type HallSpace } from "./account";
import { createAudio } from "./audio";
import { characterFile, characterFileReady, clearHallCharacterList, loadHallCharacters, peekHallCharacters, type HallCharacter } from "./characters";
import { loadFigure, type FigureAvatar } from "./figure";
import { peekHallTracks, type HallTrack } from "./tracks";
import { CARDS, cardLabel, type CardId, type DayRole, type HallState, type RoomFill, type RoomMusic, type RoomMusicTrack, type RoomProp } from "./types";
import { createWorld, packFaceUrl } from "./world";

const view = document.querySelector<HTMLElement>("#view");
if (!view) throw new Error("missing view");

const audio = createAudio();
const world = createWorld(view, {
  onMove(x, z, roomId, pose) {
    send(roomId ? { type: "move", x, z, roomId, pose: pose ?? "stand" } : { type: "move", x, z });
  },
  onExit() {
    insideId = null;
    closePicklike();
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

const gateDate = document.querySelector<HTMLElement>("#gate-date");
const kicker = document.querySelector<HTMLElement>("#dock-kicker");
const title = document.querySelector<HTMLElement>("#dock-title");
const sub = document.querySelector<HTMLElement>("#dock-sub");
const wishes = document.querySelector<HTMLElement>("#dock-wishes");
const guideActions = document.querySelector<HTMLElement>("#dock-guide");
const wishActions = document.querySelector<HTMLElement>("#dock-wish");
const roomActions = document.querySelector<HTMLElement>("#dock-rooms");
const soundBtn = document.querySelector<HTMLButtonElement>("#sound");
const yardBtn = document.querySelector<HTMLButtonElement>("#yard");
const yardsEl = document.querySelector<HTMLElement>("#yards");
const yardList = document.querySelector<HTMLElement>("#yard-list");
const yardNote = document.querySelector<HTMLElement>("#yard-note");
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
let selectedLook: (typeof LOOKS)[number]["id"] = rememberLook();
let lookTouched = true;
let figure: FigureAvatar | null = null;
let heldFigure: FigureAvatar | null = null;
let heldId = "";
let characterLabel = "";
let characterThumb = "";
let savedCharacter: HallCharacter | null = null;
let sharedFace: string | null = null;
let libraryCharacters: HallCharacter[] = [];
let savedMusic: HallMusic | null = null;
let forgetMusic = false;
let roomAudio: HTMLAudioElement | null = null;
let roomAudioUrl = "";
let musicTimer = 0;
let musicShareGeneration = 0;
let clockOffset = 0;
let accountUserId = "";
let restoredUser = "";
let applyingSetup = false;
let setupEdited = false;
let setupReady = false;
let setupTimer = 0;
let setupPushing = false;
let setupPushAgain = false;
let wearGeneration = 0;
let insideId: string | null = null;
let listFilter: "all" | "birthday" | "empty" = "all";
type SheetTab = "guide" | "wish" | "rooms";
let sheet: SheetTab = "guide";
let sheetOpen = false;
let wishDraft = "";
let wishLock = 0;
let wishNotice = 0;
let pendingWish = "";
let sentWish = "";
let sentWishRoom = "";

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

function closeSheet() {
  if (!sheetOpen) return;
  sheetOpen = false;
  paintSheet();
}

foldBtn?.addEventListener("click", () => setDockFolded(!dockFolded));

const hot = (import.meta as { hot?: { dispose: (cb: () => void) => void } }).hot;
hot?.dispose(() => {
  socket?.close();
  world.destroy();
});

function freshId() {
  try {
    if (typeof crypto.randomUUID === "function") return crypto.randomUUID().replace(/-/g, "");
  } catch {
    /* 휴대폰의 http 주소에서는 randomUUID를 쓸 수 없어요. */
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function clientId() {
  const key = "today-birthday-id";
  try {
    const saved = localStorage.getItem(key);
    if (saved && /^[a-zA-Z0-9_-]{8,80}$/.test(saved)) return saved;
    const next = freshId();
    localStorage.setItem(key, next);
    return next;
  } catch {
    return freshId();
  }
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
  rememberSetup();
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
    closeSheet();
  });
  return form;
}

function releaseButton() {
  return button("이 방을 비우기", "texty", () => {
    send({ type: "release" });
    closeSheet();
  });
}

function goToRoom(id: string) {
  if (insideId && insideId !== id) {
    insideId = null;
    world.leaveRoom();
  }
  selectedId = id;
  world.walkToRoom(id);
  world.setSelected(id);
  closeSheet();
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
    world.playBow();
    send({ type: "bow" });
    closeSheet();
    render();
  });
  bow.disabled = cooling;
  wishActions.append(bow);
  armBowRefresh();
}

function otherBirthdayRoom() {
  if (!state || !insideId || insideId === state.yourRoomId) return null;
  return state.rooms.find((room) => room.id === insideId && room.occupant) ?? null;
}

function appendVisitWishes(roomId: string) {
  if (!wishActions) return;
  const grid = document.createElement("div");
  grid.className = "cards";
  for (const card of CARDS) {
    grid.append(
      button(card.text, "", () => {
        audio.match();
        send({ type: "light", roomId, card: card.id satisfies CardId });
        closeSheet();
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
  input.enterKeyHint = "send";
  input.value = wishDraft;
  input.addEventListener("input", () => {
    wishDraft = input.value;
  });
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.textContent = "전하기";
  form.append(input, submit);
  const deliver = () => {
    const now = Date.now();
    if (now < wishLock) return;
    const text = input.value.trim();
    if (!text) {
      if (now > wishNotice) {
        wishNotice = now + 800;
        toast("한 줄을 적어 주세요.");
      }
      return;
    }
    if (socket?.readyState !== WebSocket.OPEN) {
      toast("마당에 다시 연결하고 있어요.");
      return;
    }
    wishLock = now + 500;
    pendingWish = text;
    wishDraft = "";
    input.value = "";
    audio.match();
    send({ type: "light", roomId, card: "custom", text });
    closeSheet();
  };
  submit.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    input.blur();
    window.setTimeout(deliver, 0);
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    deliver();
  });
  wishActions.append(form);
  if (sentWish && sentWishRoom === roomId) {
    const done = document.createElement("p");
    done.className = "wish-sent";
    done.textContent = `전했어요 · ${sentWish}`;
    wishActions.append(done);
  }
}

function finishDock() {
  const visiting = otherBirthdayRoom();
  if (wishActions && !wishActions.childElementCount && visiting) {
    appendVisitWishes(visiting.id);
  } else if (wishes && wishActions && !wishes.childElementCount && !wishActions.childElementCount) {
    if (state?.yourRole === "birthday" && mineRoom(state)) appendOwnWishes();
    else if (state?.yourRole === "birthday") wishNote("빈 방을 고르면 받은 축하가 여기 모여요.");
    else wishNote("생일인 방에 들어가면 축하를 남길 수 있어요.");
  }
  paintSheet();
  syncRoomMusic();
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
        world.playBow();
        send({ type: "bow", toId: line.fromId, text: input.value.trim() });
        input.value = "";
        closeSheet();
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

function closeYards() {
  if (!yardsEl) return;
  yardsEl.hidden = true;
  yardBtn?.setAttribute("aria-expanded", "false");
}

function paintYards() {
  const yards = state?.yards ?? [];
  const current = yards.find((yard) => yard.id === state?.yardId) ?? yards[0];
  if (yardBtn) yardBtn.textContent = current?.name ?? "마당 1";
  if (!yardList) return;
  yardList.replaceChildren();
  for (const yard of yards) {
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    if (yard.id === state?.yardId) button.className = "here";
    const name = document.createElement("b");
    name.textContent = yard.name;
    const detail = document.createElement("span");
    detail.textContent = `생일 ${yard.birthday} · 빈 방 ${yard.empty}`;
    const count = document.createElement("em");
    count.textContent = `${yard.users} / ${yard.max}`;
    button.append(name, detail, count);
    button.addEventListener("click", () => closeYards());
    li.append(button);
    yardList.append(li);
  }
  if (yardNote) {
    yardNote.textContent = state && state.yesterday > 0
      ? `어제 촛불 ${state.yesterday.toLocaleString("ko-KR")}`
      : "";
  }
}

function render() {
  const mine = mineRoom(state);
  const role = state?.yourRole ?? chosen;
  paintYards();
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
        world.enterRoom(selected.id);
        insideId = selected.id;
        world.setSelected(selected.id);
        closeSheet();
        render();
      }),
    );
    if (owned) guideActions.append(releaseButton());
  } else if (!selected.occupant) {
    kicker.textContent = selected.custom ? "내가 만든 공간" : "비어 있는 방";
    if (selected.custom) {
      const lines = [
        selected.trait,
        "뮤직박스를 누르면 곡을 고를 수 있어요.",
        "소파와 거울, 뮤직박스를 쓸 수 있어요.",
      ];
      const ownSpace = selected.id === `space:${me}`;
      if (role === "birthday" && ownSpace && !mine) {
        lines.push("고르면 이 방이 오늘의 생일 공간이 되고, 적은 말이 먼저 보여요.");
        setLines(sub, lines);
        guideActions.append(claimForm(selected.id));
      } else if (role === "birthday" && ownSpace && mine) {
        lines.push(`오늘은 이미 ${mine.title}에 있어요.`);
        setLines(sub, lines);
      } else {
        setLines(sub, lines);
      }
    } else if (role !== "birthday") {
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
        ? [
          selected.trait,
          musicLine(selected.occupant.music ?? selected.music, "케이크를 누르면 노래가 나와요."),
          "소파와 거울도 쓸 수 있어요.",
        ]
        : [
          `${selected.occupant.name}의 방이에요.`,
          musicLine(selected.occupant.music ?? selected.music, "축하 탭에서 마음을 전할 수 있어요."),
        ],
    );
    if (owned) guideActions.append(releaseButton());
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
      closeSheet();
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
      custom: room.custom,
      music: room.music?.tracks.map((track) => track.url),
      layout: room.layout,
      candleCount: room.candleCount ?? room.candles.length,
      candles: room.candles,
    })),
  });
}

const remoteFaces = new Map<string, string>();

function apply(next: HallState) {
  const prev = state;
  const prevRoom = prev?.yourRoomId ?? null;
  if (typeof next.now === "number") clockOffset = next.now - Date.now();
  if (next.facePack) {
    for (const [id, url] of Object.entries(next.facePack)) {
      if (typeof url === "string" && url) remoteFaces.set(id, url);
      else remoteFaces.delete(id);
    }
  }
  state = next;
  paintYards();
  wearLook();
  world.sync(
    next.rooms,
    next.yourRoomId,
    next.walkers
      .filter((walker) => walker.id !== me)
      .map((walker) => ({ ...walker, face: remoteFaces.get(walker.id) ?? null })),
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
  if (next.ack === "light") {
    pendingWish = "";
    if (next.ackText) {
      sentWish = next.ackText;
      sentWishRoom = insideId ?? "";
    }
    toast("마음을 전했어요.");
  }
  if (next.ack === "claim") {
    toast("이 방을 오늘의 공간으로 골랐어요.");
    void publishRoomMusic(true);
  }
  if (next.ack === "release") toast("방을 비웠어요. 오늘은 다른 빈 방을 고를 수 있어요.");
  if (!entered && pendingEntry && next.yourRole && next.yourName === pendingEntry.name) {
    pendingEntry = null;
    entered = true;
    insideId = null;
    selectedId = null;
    world.setSelected(null);
    world.beginAgain();
    resolveArrival?.();
  }
  if (!prev || dockSignature(prev) !== dockSignature(next) || next.ack) render();
}

function connect() {
  const configured = import.meta.env.VITE_HALL_URL?.trim();
  const hallUrl = configured
    || (location.protocol === "https:" ? `wss://${location.host}` : `ws://${location.host}/hall`);
  const ws = new WebSocket(hallUrl);
  socket = ws;
  ws.addEventListener("open", () => {
    retry = 0;
    ws.send(JSON.stringify({ type: "join", clientId: me }));
    shareFigure();
    shareFace();
    void announceSpace();
    void publishRoomMusic(true);
  });
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as HallState | { type: "error"; message: string };
    if (message.type === "error") {
      pendingEntry = null;
      failArrival();
      if (pendingWish) {
        wishDraft = pendingWish;
        pendingWish = "";
        wishLock = 0;
        const field = document.querySelector<HTMLInputElement>(".wish-form input");
        if (field) field.value = wishDraft;
      }
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
  world.setSheet(null);
  world.setFigure(figure);
  document.querySelectorAll<HTMLButtonElement>("#gate-looks [data-look]").forEach((btn) => {
    const on = !figure && !characterThumb && btn.dataset.look === selectedLook;
    btn.classList.toggle("on", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });
  document.querySelectorAll<HTMLButtonElement>("#gate-looks [data-character]").forEach((btn) => {
    const on = Boolean(figure || characterThumb) && btn.dataset.character === savedCharacter?.id;
    btn.classList.toggle("on", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });
  const shown = document.querySelector<HTMLButtonElement>("#gate-shown");
  if (shown) {
    const copy = `<span class="look-copy"><b></b></span>`;
    if (figure || characterThumb) {
      shown.innerHTML = `<img class="look-photo" alt="">${copy}`;
      const photo = shown.querySelector<HTMLImageElement>(".look-photo");
      if (photo && characterThumb) photo.src = characterThumb;
      else photo?.remove();
      const name = shown.querySelector("b");
      if (name) name.textContent = characterLabel || "캐릭터";
      return;
    }
    const look = LOOKS.find((item) => item.id === selectedLook) ?? LOOKS[0];
    shown.innerHTML = `<i><b class="hair"></b><b class="face"></b><b class="body"></b></i>${copy}`;
    const name = shown.querySelector(".look-copy b");
    if (name) name.textContent = look.label;
    const hair = shown.querySelector<HTMLElement>(".hair");
    const face = shown.querySelector<HTMLElement>(".face");
    const body = shown.querySelector<HTMLElement>(".body");
    if (hair) hair.style.background = look.hair;
    if (face) face.style.background = look.skin;
    if (body) body.style.background = look.color;
  }
}

const DATE_KEY = "today-birthday-date";
const birthMonth = document.querySelector<HTMLButtonElement>("#birth-month");
const birthDay = document.querySelector<HTMLButtonElement>("#birth-day");
const monthList = document.querySelector<HTMLElement>("#birth-month-list");
const dayList = document.querySelector<HTMLElement>("#birth-day-list");
const birthNote = document.querySelector<HTMLElement>("#birth-note");

function rememberLook(): (typeof LOOKS)[number]["id"] {
  const stored = localStorage.getItem("today-birthday-look");
  const found = LOOKS.find((item) => item.id === stored);
  if (found) return found.id;
  const pick = LOOKS[Math.floor(Math.random() * LOOKS.length)].id;
  localStorage.setItem("today-birthday-look", pick);
  return pick;
}

function daysInMonth(month: number) {
  return [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 31;
}

function savedDate(): { month: number; day: number } | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(DATE_KEY) || "") as { month?: unknown; day?: unknown };
    const month = Number(parsed.month);
    const day = Number(parsed.day);
    if (month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(month)) return { month, day };
  } catch {
    /* no saved birthday yet */
  }
  return null;
}

function dateValue(button: HTMLButtonElement | null) {
  return Number(button?.dataset.value || 0);
}

function closeDateMenus() {
  if (monthList) monthList.hidden = true;
  if (dayList) dayList.hidden = true;
  birthMonth?.setAttribute("aria-expanded", "false");
  birthDay?.setAttribute("aria-expanded", "false");
  const spaceList = document.querySelector<HTMLElement>("#gate-space-list");
  const spaceBtn = document.querySelector<HTMLButtonElement>("#gate-space");
  if (spaceList) spaceList.hidden = true;
  spaceBtn?.setAttribute("aria-expanded", "false");
}

function paintDateMenu(
  list: HTMLElement,
  items: { value: number; label: string }[],
  current: number,
  onPick: (value: number) => void,
) {
  list.replaceChildren();
  for (const item of items) {
    const row = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = item.label;
    button.classList.toggle("on", item.value === current);
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      onPick(item.value);
      closeDateMenus();
    });
    row.append(button);
    list.append(row);
  }
}

function fillDates() {
  if (!birthMonth || !birthDay || !monthList || !dayList) return;
  const saved = savedDate();
  birthMonth.dataset.value = saved ? String(saved.month) : "";
  birthMonth.textContent = saved ? `${saved.month}월` : "월";
  paintDateMenu(
    monthList,
    Array.from({ length: 12 }, (_, index) => ({ value: index + 1, label: `${index + 1}월` })),
    saved?.month ?? 0,
    (month) => {
      if (!birthMonth) return;
      birthMonth.dataset.value = String(month);
      birthMonth.textContent = `${month}월`;
      fillDays(dateValue(birthDay));
      paintBirth();
      rememberSetup();
      monthList?.querySelectorAll("button").forEach((button) => {
        button.classList.toggle("on", button.textContent === `${month}월`);
      });
    },
  );
  fillDays(saved?.day ?? 0);
}

function fillDays(day: number) {
  if (!birthDay || !dayList) return;
  const month = dateValue(birthMonth);
  const max = month ? daysInMonth(month) : 31;
  const nextDay = day >= 1 && day <= max ? day : 0;
  birthDay.dataset.value = nextDay ? String(nextDay) : "";
  birthDay.textContent = nextDay ? `${nextDay}일` : "일";
  paintDateMenu(
    dayList,
    Array.from({ length: max }, (_, index) => ({ value: index + 1, label: `${index + 1}일` })),
    nextDay,
    (picked) => {
      if (!birthDay) return;
      birthDay.dataset.value = String(picked);
      birthDay.textContent = `${picked}일`;
      fillDays(picked);
      paintBirth();
      rememberSetup();
    },
  );
}

function chosenDate(): { month: number; day: number } | null {
  const month = dateValue(birthMonth);
  const day = dateValue(birthDay);
  if (month < 1 || day < 1 || day > daysInMonth(month)) return null;
  return { month, day };
}

function paintBirth() {
  const date = chosenDate();
  if (!date) {
    if (birthNote) birthNote.textContent = "";
    return;
  }
  localStorage.setItem(DATE_KEY, JSON.stringify(date));
  const now = new Date();
  const today = now.getMonth() + 1 === date.month && now.getDate() === date.day;
  if (birthNote) birthNote.textContent = today ? "오늘은 생일로 들어가요." : "오늘은 축하하러 들어가요.";
}

function setupKey(userId: string) {
  return `today-birthday-setup:${userId}`;
}

function readLocalSetup(userId: string): HallSetup | null {
  try {
    const raw = localStorage.getItem(setupKey(userId));
    if (!raw) return null;
    return parseHallSetup(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writeLocalSetup(setup: HallSetup) {
  if (!accountUserId) return;
  try {
    localStorage.setItem(setupKey(accountUserId), JSON.stringify(setup));
  } catch {
    /* 이 브라우저가 저장을 막으면 계정에만 남겨요. */
  }
}

function currentSetup(): HallSetup {
  const date = chosenDate();
  return {
    name: gateName?.value ?? "",
    look: selectedLook,
    month: date?.month ?? 0,
    day: date?.day ?? 0,
    character: savedCharacter,
    music: savedMusic,
    at: Date.now(),
  };
}

function rememberSetup(clearCharacter = false) {
  if (!accountUserId || applyingSetup) return;
  setupEdited = true;
  const next = currentSetup();
  if (!next.character && !clearCharacter) {
    const kept = readLocalSetup(accountUserId)?.character;
    if (kept) next.character = kept;
  }
  if (!next.music && !forgetMusic) {
    const kept = readLocalSetup(accountUserId)?.music;
    if (kept) next.music = kept;
  }
  forgetMusic = false;
  writeLocalSetup(next);
  if (!setupReady) return;
  window.clearTimeout(setupTimer);
  setupTimer = window.setTimeout(() => void pushSetup(), 500);
}

async function pushSetup() {
  if (!accountUserId || !setupReady) return;
  if (setupPushing) {
    setupPushAgain = true;
    return;
  }
  const setup = readLocalSetup(accountUserId);
  if (!setup) return;
  setupPushing = true;
  try {
    await saveHallSetup(setup);
  } finally {
    setupPushing = false;
    if (setupPushAgain) {
      setupPushAgain = false;
      void pushSetup();
    }
  }
}

function applySetup(setup: HallSetup) {
  applyingSetup = true;
  try {
    if (gateName && setup.name) {
      gateName.value = setup.name;
      gateName.dataset.touched = "1";
    }
    if (setup.month >= 1 && setup.day >= 1 && setup.day <= daysInMonth(setup.month)) {
      localStorage.setItem(DATE_KEY, JSON.stringify({ month: setup.month, day: setup.day }));
      fillDates();
      paintBirth();
    }
    if (LOOKS.some((item) => item.id === setup.look)) {
      selectedLook = setup.look as (typeof LOOKS)[number]["id"];
      localStorage.setItem("today-birthday-look", selectedLook);
    }
    savedMusic = setup.music;
    if (!facePreview) {
      savedCharacter = setup.character;
      characterLabel = setup.character?.title || "";
      characterThumb = setup.character?.thumbUrl || "";
    }
    paintLookChoices();
    if (!setup.character) {
      if (figure && figure !== heldFigure) figure.dispose();
      figure = null;
    }
    wearLook();
    writeLocalSetup(setup);
  } finally {
    applyingSetup = false;
  }
}

async function restoreSetup(userId: string) {
  setupEdited = false;
  const remote = await loadHallSetup();
  if (accountUserId !== userId) return;
  const local = readLocalSetup(userId);
  if (setupEdited) {
    if (local && !local.character && remote?.character) {
      local.character = remote.character;
      writeLocalSetup(local);
      savedCharacter = remote.character;
      characterLabel = remote.character.title || "캐릭터";
      characterThumb = remote.character.thumbUrl;
      wearLook();
      void wearCharacter(remote.character, true);
    }
    setupReady = true;
    void pushSetup();
    shareFigure();
    void publishRoomMusic(true);
    return;
  }
  const newer = !remote ? local : !local ? remote : local.at > remote.at ? local : remote;
  if (!newer) {
    setupReady = true;
    shareFigure();
    void publishRoomMusic(true);
    return;
  }
  const older = newer === local ? remote : local;
  let chosen = !newer.character && older?.character
    ? { ...newer, character: older.character, at: Date.now() }
    : newer;
  if (!chosen.music && older?.music) chosen = { ...chosen, music: older.music, at: Date.now() };
  applySetup(chosen);
  if (chosen.character) await wearCharacter(chosen.character, true);
  setupReady = true;
  if (chosen !== remote) void pushSetup();
  shareFigure();
  void publishRoomMusic(true);
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    window.clearTimeout(setupTimer);
    void pushSetup();
    return;
  }
  void publishRoomMusic(false);
});

window.setInterval(() => {
  if (document.visibilityState === "hidden") return;
  void publishRoomMusic(false);
}, 8000);

function paintGate() {
  if (gateName && document.activeElement !== gateName && !gateName.dataset.touched) {
    gateName.value = state?.yourName ?? "";
  }
  paintBirth();
}

function cleanName(raw: string) {
  return Array.from(raw.replace(/\s+/g, " ").trim()).slice(0, 12).join("");
}

const passage = document.querySelector<HTMLElement>("#passage");
const passageKicker = document.querySelector<HTMLElement>("#passage-kicker");
const passageTitle = document.querySelector<HTMLElement>("#passage-title");
const passageCopy = document.querySelector<HTMLElement>("#passage-copy");
const passageNote = document.querySelector<HTMLElement>("#passage-note");
const passageBar = document.querySelector<HTMLElement>("#passage-bar");
let passageBusy = false;
let resolveArrival: (() => void) | null = null;
let arrivalFailed = false;

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function paintPassage(mode: "leave" | "arrive") {
  if (!passage) return;
  passage.className = mode;
  if (passageKicker) passageKicker.textContent = mode === "leave" ? "오늘은 생일" : "";
  if (passageTitle) passageTitle.textContent = mode === "leave" ? "자리를 내려놓았어요" : "오늘은 생일";
  if (passageCopy) {
    passageCopy.innerHTML = mode === "leave"
      ? "소리도 함께 내려놓았어요.<br />다음에 오면 길 앞에서 다시 시작해요."
      : "길 앞을 준비하고 있어요.";
  }
  if (passageNote) {
    passageNote.textContent = mode === "arrive" ? "잠시 후 문을 지나 마당으로 들어가요." : "";
  }
  if (passageBar) passageBar.hidden = mode !== "arrive";
}

async function openPassage(mode: "leave" | "arrive") {
  paintPassage(mode);
  if (!passage) return;
  passage.hidden = false;
  await wait(30);
  passage.classList.add("show");
  await wait(520);
}

async function closePassage() {
  passage?.classList.remove("show");
  await wait(580);
  if (passage) passage.hidden = true;
}

function failArrival() {
  if (!resolveArrival) return;
  arrivalFailed = true;
  resolveArrival();
  resolveArrival = null;
}

function beginArrival() {
  passageBusy = true;
  arrivalFailed = false;
  const ready = new Promise<void>((resolve) => {
    resolveArrival = resolve;
  });
  void finishArrival(ready);
}

async function finishArrival(ready: Promise<void>) {
  await openPassage("arrive");
  const started = performance.now();
  const timedOut = wait(8000).then(() => "timeout" as const);
  const arrived = ready.then(() => "ready" as const);
  const outcome = await Promise.race([arrived, timedOut]);
  if (outcome === "timeout" && !entered) {
    pendingEntry = null;
    arrivalFailed = true;
    toast("마당에 들어가지 못했어요.");
  }
  const remain = 1500 - (performance.now() - started);
  if (remain > 0) await wait(remain);
  if (!arrivalFailed && entered) {
    passage?.classList.add("ready");
    await wait(280);
    document.body.classList.add("in");
    world.setLive(true);
    audio.start();
    if (soundOn) audio.setMuted(false);
    else audio.setMuted(true);
  }
  await closePassage();
  passage?.classList.remove("ready");
  resolveArrival = null;
  passageBusy = false;
}

async function leaveToGate() {
  if (passageBusy || !document.body.classList.contains("in")) return;
  passageBusy = true;
  closeYards();
  sheetOpen = false;
  paintSheet();
  audio.setMuted(true);
  await openPassage("leave");
  await wait(1100);
  insideId = null;
  selectedId = null;
  world.setSelected(null);
  closePicklike();
  world.beginAgain();
  entered = false;
  pendingEntry = null;
  document.body.classList.remove("in");
  world.setLive(false);
  await closePassage();
  passageBusy = false;
}

function enterAs(role: DayRole) {
  if (entered || pendingEntry || passageBusy) return;
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
  beginArrival();
  send({ type: "role", role, name, look: selectedLook, figure: figureShare(), face: sharedFace });
}

function figureShare() {
  const card = savedCharacter;
  if (!card?.bodyUrl.startsWith("https://")) return null;
  const figure: { body: string; walk?: string; sit?: string; bow?: string } = { body: card.bodyUrl };
  if (card.motions.walk?.startsWith("https://")) figure.walk = card.motions.walk;
  if (card.motions.sit?.startsWith("https://")) figure.sit = card.motions.sit;
  if (card.motions.bow?.startsWith("https://")) figure.bow = card.motions.bow;
  return figure;
}

function shareFigure() {
  if (accountUserId && !setupReady) return;
  if (socket?.readyState !== WebSocket.OPEN) return;
  send({ type: "figure", figure: figureShare() });
}

function shareFace(face?: string | null) {
  if (face !== undefined) sharedFace = face;
  if (accountUserId && !setupReady) return;
  if (socket?.readyState !== WebSocket.OPEN) return;
  send({ type: "face", face: sharedFace });
}

function musicLine(music: RoomMusic | null | undefined, fallback: string) {
  if (!music?.tracks.length || music.stopped) return fallback;
  const spot = musicSpot(music, music.pausedAt ? music.pausedAt : serverNow());
  const title = spot ? music.tracks[spot.index]?.title : "";
  if (!title) return fallback;
  return music.pausedAt ? `일시정지 · ${title}` : `재생 중 · ${title}`;
}

function serverNow() {
  return Date.now() + clockOffset;
}

function musicSpot(music: { tracks: HallMusicTrack[]; startedAt: number }, at: number) {
  const total = music.tracks.reduce((sum, track) => sum + track.duration, 0);
  if (!(total > 0) || !Number.isFinite(music.startedAt)) return null;
  let cursor = ((at - music.startedAt) / 1000) % total;
  if (cursor < 0) cursor += total;
  for (let index = 0; index < music.tracks.length; index += 1) {
    const track = music.tracks[index];
    if (cursor < track.duration) {
      return { index, url: track.url, offset: cursor, remain: track.duration - cursor };
    }
    cursor -= track.duration;
  }
  return null;
}

let spaceMusicGeneration = 0;
let spaceAnnounceGeneration = 0;
let spaceMusicKey = "";
let spaceMusicFull = "";
let hallSpaces: HallSpace[] = [];
let hallSpaceId = "";

function selectedSpace() {
  return hallSpaces.find((space) => space.id === hallSpaceId) ?? hallSpaces[0] ?? null;
}

function paintSpaces() {
  const field = document.querySelector<HTMLElement>("#gate-space-field");
  const button = document.querySelector<HTMLButtonElement>("#gate-space");
  const list = document.querySelector<HTMLElement>("#gate-space-list");
  if (!field || !button || !list) return;
  const chosen = selectedSpace();
  field.hidden = hallSpaces.length === 0;
  button.textContent = chosen?.title || "내 공간";
  list.replaceChildren();
  for (const space of hallSpaces) {
    const row = document.createElement("li");
    const item = document.createElement("button");
    item.type = "button";
    item.textContent = space.title;
    item.classList.toggle("on", space.id === chosen?.id);
    item.addEventListener("click", (event) => {
      event.stopPropagation();
      hallSpaceId = space.id;
      closeDateMenus();
      paintSpaces();
      void announceSpace();
      void publishRoomMusic(true);
    });
    row.append(item);
    list.append(row);
  }
}

async function refreshSpaces() {
  hallSpaces = await loadHallSpaces();
  if (!hallSpaces.some((space) => space.id === hallSpaceId)) hallSpaceId = hallSpaces[0]?.id ?? "";
  paintSpaces();
  void announceSpace();
}

async function announceSpace() {
  const space = selectedSpace();
  if (!space || socket?.readyState !== WebSocket.OPEN) return;
  const generation = ++spaceAnnounceGeneration;
  const session = await currentAccount();
  const tracks = await resolveDurations(space.tracks, peekHallTracks(session?.access_token ?? null));
  if (generation !== spaceAnnounceGeneration || selectedSpace()?.id !== space.id) return;
  send({
    type: "space",
    id: space.id,
    title: space.title,
    mood: space.mood,
    shell: space.shell === "stage" || space.shell === "roof" ? space.shell : "parlor",
    facade: space.facade ?? { door: space.shell === "stage" ? "red" : space.shell === "roof" ? "navy" : "wood", window: false, accent: "none" },
    objects: space.objects,
    tracks,
  });
}

async function publishRoomMusic(force = false) {
  if (!setupReady) return;
  const generation = ++spaceMusicGeneration;
  const tracks = selectedSpace()?.tracks ?? [];
  const music = tracks.length ? { tracks } : null;
  if (generation !== spaceMusicGeneration || !setupReady) return;
  if (!music?.tracks.length) {
    if (force) shareMusic();
    return;
  }
  const next = music.tracks.map((track) => ({
    title: track.title,
    url: track.url,
    duration: track.duration,
    ...(track.image ? { image: track.image } : {}),
  }));
  const urlKey = next.map((track) => track.url).join("|");
  const fullKey = next.map((track) => `${track.url}\t${track.title}\t${track.duration}`).join("|");
  if (!force && fullKey === spaceMusicFull) return;
  if (socket?.readyState !== WebSocket.OPEN) return;
  const restart = urlKey !== spaceMusicKey;
  spaceMusicKey = urlKey;
  spaceMusicFull = fullKey;
  savedMusic = { tracks: next };
  if (restart) rememberSetup();
  shareMusic(restart ? "restart" : "keep");
}

async function shareMusic(mode: "keep" | "restart" | "pause" | "resume" | "stop" | "from" = "keep", fromIndex = 0) {
  if (!setupReady || socket?.readyState !== WebSocket.OPEN) return;
  const generation = ++musicShareGeneration;
  if (!savedMusic?.tracks.length) {
    send({ type: "music", music: null });
    return;
  }
  const session = await currentAccount();
  if (generation !== musicShareGeneration) return;
  const tracks = await resolveDurations(savedMusic.tracks, peekHallTracks(session?.access_token ?? null));
  if (generation !== musicShareGeneration || !tracks.length) return;
  const filled = tracks.some((track, index) => track.duration !== savedMusic?.tracks[index]?.duration);
  savedMusic = { tracks };
  if (filled) rememberSetup();
  send({
    type: "music",
    music: {
      tracks,
      restart: mode === "restart",
      pause: mode === "pause",
      resume: mode === "resume",
      stopped: mode === "stop",
      fromIndex: mode === "from" ? fromIndex : undefined,
    },
  });
}

function measureDuration(url: string) {
  return new Promise<number>((resolve) => {
    const audio = new Audio();
    const finish = (value: number) => {
      audio.src = "";
      resolve(value);
    };
    const timer = window.setTimeout(() => finish(0), 8000);
    audio.preload = "metadata";
    audio.addEventListener("loadedmetadata", () => {
      window.clearTimeout(timer);
      finish(Number.isFinite(audio.duration) ? audio.duration : 0);
    }, { once: true });
    audio.addEventListener("error", () => {
      window.clearTimeout(timer);
      finish(0);
    }, { once: true });
    audio.src = url;
  });
}

async function resolveDurations(tracks: HallMusicTrack[], known: HallTrack[] | null) {
  const resolved: HallMusicTrack[] = [];
  for (const track of tracks) {
    let duration = track.duration;
    if (!(duration > 0)) duration = known?.find((card) => card.url === track.url)?.duration ?? 0;
    if (!(duration > 0)) duration = await measureDuration(track.url);
    if (duration > 0) resolved.push({ title: track.title, url: track.url, duration, ...(track.image ? { image: track.image } : {}) });
  }
  return resolved;
}

function stopRoomMusic() {
  window.clearTimeout(musicTimer);
  roomAudio?.pause();
  if (roomAudio) roomAudio.src = "";
  roomAudio = null;
  roomAudioUrl = "";
}

function musicClock(music: RoomMusic) {
  return music.pausedAt ? music.pausedAt : serverNow();
}

function playHeard(url: string, offset: number, paused: boolean, loop: boolean, remain: number) {
  const audioElNow = roomAudio;
  if (!audioElNow || roomAudioUrl !== url) {
    stopRoomMusic();
    const audioEl = new Audio(url);
    audioEl.loop = loop;
    audioEl.volume = 0.45;
    roomAudio = audioEl;
    roomAudioUrl = url;
    const start = () => {
      if (roomAudio !== audioEl) return;
      try { audioEl.currentTime = offset; } catch { /* metadata may still be arriving */ }
      if (paused) {
        audioEl.pause();
        window.clearTimeout(musicTimer);
        return;
      }
      void audioEl.play().catch(() => undefined);
      if (remain > 0) armMusic(remain);
    };
    if (audioEl.readyState >= 1) start();
    else audioEl.addEventListener("loadedmetadata", start, { once: true });
    return;
  }
  audioElNow.loop = loop;
  const drift = Math.abs(audioElNow.currentTime - offset);
  if (paused) {
    if (drift > 0.4) try { audioElNow.currentTime = offset; } catch { /* already current */ }
    audioElNow.pause();
    window.clearTimeout(musicTimer);
    return;
  }
  if (!audioElNow.paused && drift < 1.2) {
    if (remain > 0) armMusic(remain);
    return;
  }
  try { audioElNow.currentTime = offset; } catch { /* already current */ }
  void audioElNow.play().catch(() => undefined);
  if (remain > 0) armMusic(remain);
}

function playPersonal() {
  const spot = readEar();
  if (!spot?.url) {
    stopRoomMusic();
    return;
  }
  if (ear.mode === "pick" && (spot.index !== ear.index || spot.offset + 0.35 < ear.offset)) {
    ear = { mode: "pick", index: spot.index, offset: spot.offset, paused: spot.paused, at: Date.now() };
  }
  const remain = spot.paused ? 0 : Math.max(0, spot.duration - spot.offset);
  playHeard(spot.url, spot.offset, spot.paused, false, remain);
}

function syncRoomMusic() {
  showPlayingTrack();
  if (insideId !== earRoom) {
    earRoom = insideId;
    ear = { mode: "room" };
  }
  if (!soundOn) {
    stopRoomMusic();
    return;
  }
  if (ear.mode === "pick") {
    playPersonal();
    return;
  }
  const room = state?.rooms.find((item) => item.id === insideId);
  const music = insideId ? room?.occupant?.music ?? null : null;
  if (!music?.tracks.length || music.stopped) {
    stopRoomMusic();
    return;
  }
  const spot = musicSpot(music, musicClock(music));
  if (!spot) {
    stopRoomMusic();
    return;
  }
  playHeard(spot.url, spot.offset, !!music.pausedAt, music.tracks.length === 1, music.pausedAt ? 0 : spot.remain);
}

function armMusic(remain: number) {
  window.clearTimeout(musicTimer);
  const wait = Math.min(8000, Math.max(250, remain * 1000 - 120));
  musicTimer = window.setTimeout(() => syncRoomMusic(), wait);
}

fillDates();
birthMonth?.addEventListener("click", (event) => {
  event.stopPropagation();
  const open = monthList?.hidden !== false;
  closeDateMenus();
  closeLooks();
  if (open && monthList && birthMonth) {
    monthList.hidden = false;
    birthMonth.setAttribute("aria-expanded", "true");
  }
});
birthDay?.addEventListener("click", (event) => {
  event.stopPropagation();
  const open = dayList?.hidden !== false;
  closeDateMenus();
  closeLooks();
  if (open && dayList && birthDay) {
    dayList.hidden = false;
    birthDay.setAttribute("aria-expanded", "true");
  }
});
function closeLooks() {
  const host = document.querySelector<HTMLElement>("#gate-looks");
  const shown = document.querySelector<HTMLButtonElement>("#gate-shown");
  if (host) host.hidden = true;
  shown?.setAttribute("aria-expanded", "false");
}

document.addEventListener("click", () => {
  closeDateMenus();
  closeLooks();
});
document.querySelector("#gate-space")?.addEventListener("click", (event) => {
  event.stopPropagation();
  const list = document.querySelector<HTMLElement>("#gate-space-list");
  const button = document.querySelector<HTMLButtonElement>("#gate-space");
  const open = list?.hidden !== false;
  closeDateMenus();
  closeLooks();
  if (open && list && button) {
    list.hidden = false;
    button.setAttribute("aria-expanded", "true");
  }
});
paintBirth();

document.querySelector("#enter")?.addEventListener("click", () => {
  const date = chosenDate();
  if (!date) {
    toast("생일을 정해 주세요.");
    birthMonth?.focus();
    return;
  }
  const now = new Date();
  const today = now.getMonth() + 1 === date.month && now.getDate() === date.day;
  enterAs(today ? "birthday" : "guest");
});

const lookHost = document.querySelector<HTMLElement>("#gate-looks");

function shownCharacters() {
  const seen = new Set<string>();
  const cards: HallCharacter[] = [];
  const add = (card: HallCharacter | null | undefined) => {
    if (!card?.id || !card.bodyUrl || seen.has(card.id)) return;
    seen.add(card.id);
    cards.push(card);
  };
  for (const card of libraryCharacters) add(card);
  add(savedCharacter);
  return cards;
}

function keepLibrary(cards: HallCharacter[]) {
  const seen = new Set<string>();
  libraryCharacters = [];
  for (const card of cards) {
    if (!card.id || !card.bodyUrl || seen.has(card.id)) continue;
    seen.add(card.id);
    libraryCharacters.push(card);
  }
  paintLookChoices();
  wearLook();
}

function paintLookChoices() {
  if (!lookHost) return;
  lookHost.replaceChildren();
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
      wearGeneration += 1;
      clearFacePreview();
      characterLabel = "";
      characterThumb = "";
      savedCharacter = null;
      figure = null;
      selectedLook = look.id;
      localStorage.setItem("today-birthday-look", look.id);
      rememberSetup(true);
      shareFigure();
      if (lookHost) lookHost.hidden = true;
      shownLook?.setAttribute("aria-expanded", "false");
      paintLookChoices();
      wearLook();
    });
    lookHost.append(btn);
  }
  for (const card of shownCharacters()) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.character = card.id;
    if (card.thumbUrl) {
      const img = document.createElement("img");
      img.alt = "";
      img.src = card.thumbUrl;
      btn.append(img);
    } else {
      const mark = document.createElement("span");
      mark.className = "character-mark";
      mark.textContent = (card.title || "캐").slice(0, 1);
      btn.append(mark);
    }
    const label = document.createElement("span");
    label.textContent = card.title || "캐릭터";
    btn.append(label);
    btn.addEventListener("click", () => {
      if (lookHost) lookHost.hidden = true;
      shownLook?.setAttribute("aria-expanded", "false");
      void wearCharacter(card);
    });
    lookHost.append(btn);
  }
}

paintLookChoices();

const shownLook = document.querySelector<HTMLButtonElement>("#gate-shown");
shownLook?.addEventListener("click", (event) => {
  event.stopPropagation();
  if (!lookHost) return;
  closeDateMenus();
  lookHost.hidden = !lookHost.hidden;
  shownLook.setAttribute("aria-expanded", lookHost.hidden ? "false" : "true");
});
lookHost?.addEventListener("click", (event) => event.stopPropagation());

const accountEl = document.querySelector<HTMLElement>("#account");
const accountForm = document.querySelector<HTMLFormElement>("#account-form");
const accountEmail = document.querySelector<HTMLInputElement>("#account-email");
const accountPassword = document.querySelector<HTMLInputElement>("#account-password");
const accountLine = document.querySelector<HTMLElement>("#account-line");
const accountOpen = document.querySelector<HTMLButtonElement>("#account-open");
const accountOut = document.querySelector<HTMLButtonElement>("#account-out");
const charactersEl = document.querySelector<HTMLElement>("#characters");
const characterList = document.querySelector<HTMLElement>("#character-list");
const characterNote = document.querySelector<HTMLElement>("#character-note");
let accountEmailText = "";
let characterTab: "mine" | "free" = "mine";
let characterBusy = false;
let facePreview = false;
let faceObjectUrl = "";

function clearFacePreview() {
  facePreview = false;
  if (faceObjectUrl) {
    URL.revokeObjectURL(faceObjectUrl);
    faceObjectUrl = "";
  }
  void world.setFace(null);
  shareFace(null);
}

async function wearFace(url: string, label: string) {
  if (!url) {
    toast("붙일 사진이 없어요.");
    return;
  }
  if (faceObjectUrl && faceObjectUrl !== url) {
    URL.revokeObjectURL(faceObjectUrl);
    faceObjectUrl = "";
  }
  if (url.startsWith("blob:")) faceObjectUrl = url;
  const generation = ++wearGeneration;
  facePreview = true;
  if (figure && figure !== heldFigure) figure.dispose();
  figure = null;
  savedCharacter = null;
  characterLabel = label || "얼굴";
  characterThumb = url;
  shareFigure();
  paintLookChoices();
  wearLook();
  closeCharacters();
  try {
    const packed = await packFaceUrl(url);
    if (generation !== wearGeneration || !facePreview) return;
    const shown = packed || url;
    await world.setFace(shown);
    if (generation !== wearGeneration || !facePreview) return;
    if (packed) shareFace(packed);
    else if (url.startsWith("https://")) shareFace(url);
    toast("얼굴만 붙였어요. 거울 앞에서 앞모습을 볼 수 있어요.");
  } catch {
    if (generation !== wearGeneration) return;
    clearFacePreview();
    characterLabel = "";
    characterThumb = "";
    paintLookChoices();
    wearLook();
    toast("이 사진은 얼굴에 붙이지 못했어요. 다른 사진을 올려 보세요.");
  }
}

function closeAccount() {
  if (accountEl) accountEl.hidden = true;
}

let accountMode: "signin" | "signup" = "signin";

function accountSubmitIcon(mode: "signin" | "signup") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const add = (name: string, attrs: Record<string, string>) => {
    const node = document.createElementNS("http://www.w3.org/2000/svg", name);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    svg.append(node);
  };
  if (mode === "signup") {
    add("path", { d: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" });
    add("circle", { cx: "9", cy: "7", r: "4" });
    add("path", { d: "M19 8v6M22 11h-6" });
  } else {
    add("path", { d: "M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" });
    add("path", { d: "m10 17 5-5-5-5" });
    add("path", { d: "M15 12H3" });
  }
  return svg;
}

function paintAccount() {
  const signedIn = Boolean(accountEmailText);
  const title = document.querySelector<HTMLElement>("#account-title");
  const google = document.querySelector<HTMLElement>("#account-google");
  const divider = document.querySelector<HTMLElement>(".login-or");
  const forgot = document.querySelector<HTMLElement>("#account-forgot");
  const submit = document.querySelector<HTMLButtonElement>("#account-in");
  const switcher = document.querySelector<HTMLElement>(".login-switch");
  if (accountForm) accountForm.hidden = signedIn;
  if (google) google.hidden = signedIn;
  if (divider) divider.hidden = signedIn;
  if (switcher) switcher.hidden = signedIn;
  if (forgot) forgot.hidden = signedIn || accountMode === "signup";
  if (accountOut) accountOut.hidden = !signedIn;
  if (title) title.textContent = signedIn ? "계정" : accountMode === "signup" ? "회원가입" : "로그인";
  if (submit) {
    submit.replaceChildren(accountSubmitIcon(accountMode), document.createTextNode(accountMode === "signup" ? "회원가입" : "로그인"));
  }
  if (switcher) {
    switcher.replaceChildren(
      document.createTextNode(accountMode === "signup" ? "이미 계정이 있으신가요? " : "계정이 없으신가요? "),
    );
    const link = document.createElement("button");
    link.id = "account-up";
    link.type = "button";
    link.textContent = accountMode === "signup" ? "로그인" : "회원가입";
    link.addEventListener("click", () => {
      accountMode = accountMode === "signup" ? "signin" : "signup";
      paintAccount();
    });
    switcher.append(link);
  }
  if (accountLine) {
    accountLine.hidden = !signedIn && accountReady;
    accountLine.textContent = signedIn
      ? accountEmailText
      : accountReady
        ? ""
        : "계정 연결이 아직 없어요.";
  }
}

paintAccount();
function paintAccountFace(face: { name: string; avatarUrl: string } | null) {
  const button = document.querySelector<HTMLButtonElement>("#account-open");
  if (!button) return;
  const img = button.querySelector("img");
  if (!face?.avatarUrl) {
    button.classList.remove("has-face");
    button.setAttribute("aria-label", "계정");
    img?.remove();
    return;
  }
  button.classList.add("has-face");
  button.setAttribute("aria-label", face.name);
  const photo = img ?? document.createElement("img");
  photo.alt = "";
  photo.src = face.avatarUrl;
  if (!img) button.append(photo);
}

let accountSeen = false;
let accountTokens: { accessToken: string; refreshToken: string } | null = null;
let offeredTokens: { accessToken: string; refreshToken: string } | null = null;

function tokenUser(accessToken: string) {
  try {
    const part = accessToken.split(".")[1] ?? "";
    const json = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/"))) as { sub?: unknown };
    return typeof json.sub === "string" ? json.sub : "";
  } catch {
    return "";
  }
}

function readAuthTokens(accessToken: unknown, refreshToken: unknown) {
  if (typeof accessToken !== "string" || typeof refreshToken !== "string") return null;
  if (accessToken.length < 20 || accessToken.length > 32000) return null;
  if (refreshToken.length < 10 || refreshToken.length > 4096) return null;
  if (accessToken.split(".").length !== 3) return null;
  return { accessToken, refreshToken };
}

function postPicklike(message: object) {
  const frame = document.querySelector<HTMLIFrameElement>("#picklike-player-frame");
  if (!frame?.contentWindow || !picklikeReady) return;
  frame.contentWindow.postMessage(message, picklikeOrigin || picklikePage());
}

function pushAccountToPicklike(signedOut: boolean) {
  if (!picklikeReady || !accountSeen) return;
  if (accountTokens) {
    postPicklike({ type: "birthday-auth", accessToken: accountTokens.accessToken, refreshToken: accountTokens.refreshToken });
    postList({ type: "birthday-auth", accessToken: accountTokens.accessToken, refreshToken: accountTokens.refreshToken });
  } else if (signedOut) {
    postPicklike({ type: "birthday-auth-clear" });
    postList({ type: "birthday-auth-clear" });
  } else {
    postPicklike({ type: "birthday-auth-ask" });
    postList({ type: "birthday-auth-ask" });
  }
  void holdAccountRefresh(true);
}

function takeOfferedAccount() {
  if (!accountSeen || accountTokens || !offeredTokens) return;
  const offer = offeredTokens;
  offeredTokens = null;
  void adoptAccountSession(offer.accessToken, offer.refreshToken);
}

onAccount((session) => {
  const previous = accountTokens;
  accountTokens = session?.access_token && session.refresh_token
    ? { accessToken: session.access_token, refreshToken: session.refresh_token }
    : null;
  const signedOut = accountSeen && Boolean(previous) && !accountTokens;
  accountSeen = true;
  accountEmailText = session?.user.email ?? "";
  accountUserId = session?.user.id ?? "";
  paintAccount();
  pushAccountToPicklike(signedOut);
  if (accountTokens) offeredTokens = null;
  else takeOfferedAccount();
  if (!session) {
    restoredUser = "";
    setupReady = true;
    hallSpaces = [];
    hallSpaceId = "";
    paintSpaces();
    clearHallCharacterList();
    libraryCharacters = [];
    paintLookChoices();
    paintAccountFace(null);
    return;
  }
  void refreshSpaces();
  void accountFace().then(paintAccountFace);
  if (restoredUser !== session.user.id) {
    restoredUser = session.user.id;
    setupReady = false;
    void restoreSetup(session.user.id);
  }
});

accountForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  const email = accountEmail?.value.trim() ?? "";
  const password = accountPassword?.value ?? "";
  if (!email || !password) {
    toast("이메일과 비밀번호를 적어 주세요.");
    return;
  }
  const run = accountMode === "signup" ? signUpAccount : signInAccount;
  void run(email, password).then((message) => {
    if (message) toast(message);
    if (!message || message.startsWith("확인 메일")) closeAccount();
  });
});

document.querySelector("#account-google")?.addEventListener("click", () => {
  void signInWithGoogle().then((message) => {
    if (message) toast(message);
  });
});

document.querySelector("#account-forgot")?.addEventListener("click", () => {
  const email = accountEmail?.value.trim() ?? "";
  if (!email) {
    toast("이메일을 적어 주세요.");
    accountEmail?.focus();
    return;
  }
  void resetAccountPassword(email).then((message) => {
    if (message) toast(message);
  });
});

document.querySelector("#account-reveal")?.addEventListener("click", () => {
  if (!accountPassword) return;
  accountPassword.type = accountPassword.type === "password" ? "text" : "password";
});

accountOut?.addEventListener("click", () => {
  void signOutAccount();
});

document.querySelector("#account-open")?.addEventListener("click", () => {
  if (accountEl) accountEl.hidden = false;
});
document.querySelector("#account-close")?.addEventListener("click", closeAccount);
accountEl?.addEventListener("click", (event) => {
  if (event.target === accountEl) closeAccount();
});

function closeCharacters() {
  if (charactersEl) charactersEl.hidden = true;
}

async function wearCharacter(card: HallCharacter, quiet = false) {
  if (quiet && facePreview) return;
  if (heldFigure && heldId === card.id) {
    clearFacePreview();
    figure = heldFigure;
    characterLabel = card.title || "캐릭터";
    characterThumb = card.thumbUrl;
    savedCharacter = card;
    lookTouched = true;
    if (!quiet) rememberSetup();
    shareFigure();
    paintLookChoices();
    wearLook();
    closeCharacters();
    if (lookHost) lookHost.hidden = true;
    shownLook?.setAttribute("aria-expanded", "false");
    return;
  }
  if (characterBusy) return;
  const generation = ++wearGeneration;
  characterBusy = true;
  const warm = [card.bodyUrl, card.motions.walk, card.motions.sit, card.motions.bow].every(characterFileReady);
  if (!warm && !quiet) toast("캐릭터를 읽고 있어요.");
  try {
    const [body, walk, sit, bow] = await Promise.all([
      characterFile(card.bodyUrl),
      characterFile(card.motions.walk),
      characterFile(card.motions.sit),
      characterFile(card.motions.bow),
    ]);
    if (!body) throw new Error("missing body");
    const next = await loadFigure({ body, walk, sit, bow });
    if (generation !== wearGeneration) {
      next.dispose();
      return;
    }
    clearFacePreview();
    if (heldFigure && heldFigure !== next) heldFigure.dispose();
    heldFigure = next;
    heldId = card.id;
    figure = next;
    characterLabel = card.title || "캐릭터";
    characterThumb = card.thumbUrl;
    savedCharacter = card;
    lookTouched = true;
    if (!quiet) rememberSetup();
    shareFigure();
    paintLookChoices();
    wearLook();
    closeCharacters();
  } catch {
    if (generation === wearGeneration) toast("캐릭터를 읽지 못했어요.");
  } finally {
    characterBusy = false;
  }
}

function paintCharacters(cards: HallCharacter[], empty: string) {
  if (!characterList || !characterNote) return;
  characterList.replaceChildren();
  characterNote.textContent = cards.length === 0 ? empty : "";
  for (const card of cards) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "character-wear";
    if (card.thumbUrl) {
      const img = document.createElement("img");
      img.alt = "";
      img.src = card.thumbUrl;
      button.append(img);
    } else {
      const mark = document.createElement("span");
      mark.className = "character-mark";
      mark.textContent = (card.title || "캐").slice(0, 1);
      button.append(mark);
    }
    const copy = document.createElement("span");
    copy.className = "character-copy";
    const title = document.createElement("b");
    title.textContent = card.title || "캐릭터";
    const motions = document.createElement("span");
    motions.className = "character-motions";
    const labels: Record<string, string> = {
      walk: "걷기",
      run: "달리기",
      sit: "앉기",
      bow: "인사",
      jump: "점프",
    };
    for (const key of ["walk", "run", "sit", "bow", "jump"] as const) {
      if (!card.motions[key]) continue;
      const chip = document.createElement("span");
      chip.textContent = labels[key];
      motions.append(chip);
    }
    copy.append(title, motions);
    button.append(copy);
    button.addEventListener("click", () => {
      void wearCharacter(card);
    });
    const face = document.createElement("button");
    face.type = "button";
    face.className = "character-face";
    face.textContent = "얼굴만";
    face.disabled = !card.thumbUrl;
    face.addEventListener("click", () => {
      void wearFace(card.thumbUrl, card.title || "얼굴");
    });
    item.append(button, face);
    characterList.append(item);
  }
}

async function openCharacters(tab: "mine" | "free" = characterTab) {
  if (!charactersEl || !characterList || !characterNote) return;
  characterTab = tab;
  charactersEl.hidden = false;
  document.querySelectorAll<HTMLButtonElement>("#character-tabs button").forEach((button) => {
    const on = button.dataset.tab === tab;
    button.classList.toggle("on", on);
    button.setAttribute("aria-pressed", on ? "true" : "false");
  });
  if (tab === "mine" && !accountEmailText) {
    characterList.replaceChildren();
    characterNote.textContent = "로그인하면 내 캐릭터를 볼 수 있어요.";
    return;
  }
  const empty = tab === "mine" ? "3D와 동작이 있는 캐릭터가 없어요." : "공개된 무료 캐릭터가 아직 없어요.";
  try {
    const session = await currentAccount();
    const token = session?.access_token ?? null;
    const peeked = peekHallCharacters(token);
    if (peeked) {
      keepLibrary([...peeked.mine, ...peeked.free]);
      paintCharacters(tab === "mine" ? peeked.mine : peeked.free, empty);
      return;
    }
    characterList.replaceChildren();
    characterNote.textContent = "불러오고 있어요.";
    const listed = await loadHallCharacters(token);
    paintCharacters(tab === "mine" ? listed.mine : listed.free, empty);
    keepLibrary([...listed.mine, ...listed.free]);
  } catch (error) {
    console.error(error);
    if (!characterList.childElementCount) characterNote.textContent = "캐릭터 목록을 불러오지 못했어요.";
  }
}

let earRoom: string | null = null;
let ear: { mode: "room" } | { mode: "pick"; index: number; offset: number; paused: boolean; at: number } = { mode: "room" };

function playingMusic(roomId: string | null) {
  const room = roomId ? state?.rooms.find((item) => item.id === roomId) : undefined;
  return room?.occupant?.music ?? room?.music ?? null;
}

function liveTracks() {
  if (!insideId || !state) return [];
  return playingMusic(insideId)?.tracks ?? [];
}

function readEar() {
  const tracks = liveTracks();
  if (ear.mode !== "pick" || !tracks.length) return null;
  let index = Math.min(Math.max(ear.index, 0), tracks.length - 1);
  let offset = ear.paused ? ear.offset : ear.offset + (Date.now() - ear.at) / 1000;
  let guard = 0;
  while (!ear.paused && guard < tracks.length) {
    const duration = tracks[index]?.duration ?? 0;
    if (!(duration > 0) || offset < duration) break;
    offset -= duration;
    index = (index + 1) % tracks.length;
    guard += 1;
  }
  const track = tracks[index];
  if (!track?.url) return null;
  return { index, offset, paused: ear.paused, duration: track.duration, url: track.url, title: track.title };
}

function clockLabel(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function nowPlaying() {
  const tracks = liveTracks();
  if (ear.mode === "pick") {
    const spot = readEar();
    if (!spot) return null;
    return { index: spot.index, paused: spot.paused, offset: spot.offset, duration: spot.duration, personal: true, title: spot.title };
  }
  const music = state?.rooms.find((item) => item.id === insideId)?.occupant?.music ?? null;
  if (!music?.tracks.length || music.stopped) return null;
  const spot = musicSpot(music, music.pausedAt ? music.pausedAt : serverNow());
  if (!spot) return null;
  return {
    index: spot.index,
    paused: !!music.pausedAt,
    offset: spot.offset,
    duration: tracks[spot.index]?.duration ?? 0,
    personal: false,
    title: tracks[spot.index]?.title ?? "",
  };
}

function pauseEar() {
  const now = nowPlaying();
  if (!now) return;
  ear = { mode: "pick", index: now.index, offset: now.offset, paused: true, at: Date.now() };
}

function resumeEar() {
  if (ear.mode !== "pick") return;
  const now = nowPlaying();
  ear = { mode: "pick", index: ear.index, offset: now?.offset ?? ear.offset, paused: false, at: Date.now() };
}

function controlPlaylist(index: number) {
  const now = nowPlaying();
  if (now && now.index === index) {
    if (now.paused) resumeEar();
    else pauseEar();
  } else {
    ear = { mode: "pick", index, offset: 0, paused: false, at: Date.now() };
  }
  syncRoomMusic();
}

const nowBtn = document.querySelector<HTMLButtonElement>("#now-play");
const nowMark = document.querySelector<HTMLElement>("#now-mark");
const nowTitle = document.querySelector<HTMLElement>("#now-title");
const listenerEl = document.querySelector<HTMLElement>("#listener");
const listenerList = document.querySelector<HTMLElement>("#listener-list");
let listenerKey = "";
let playerMode: "music" | "youtube" = "music";
let ytQueue: { watchId: string; title: string; image?: string }[] = [];
let ytIndex = 0;
let ytPaused = true;
let ytPlayer: {
  loadVideoById: (id: string) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  destroy: () => void;
} | null = null;
let ytApi: Promise<void> | null = null;

function youtubeApi() {
  const host = window as Window & {
    YT?: { Player: new (el: HTMLElement, opts: object) => NonNullable<typeof ytPlayer> };
    onYouTubeIframeAPIReady?: () => void;
  };
  if (host.YT?.Player) return Promise.resolve();
  if (!ytApi) {
    ytApi = new Promise((resolve) => {
      const previous = host.onYouTubeIframeAPIReady;
      host.onYouTubeIframeAPIReady = () => {
        previous?.();
        resolve();
      };
      if (!document.querySelector("script[data-youtube-api]")) {
        const script = document.createElement("script");
        script.src = "https://www.youtube.com/iframe_api";
        script.dataset.youtubeApi = "1";
        document.head.append(script);
      }
    });
  }
  return ytApi;
}

function destroyYoutube() {
  try { ytPlayer?.destroy(); } catch { /* player may still be constructing */ }
  ytPlayer = null;
  document.querySelector("#listener-yt")?.replaceChildren();
}

function paintCover(image: string, title: string) {
  const cover = document.querySelector<HTMLImageElement>("#listener-cover");
  const frame = document.querySelector<HTMLElement>("#listener-yt");
  if (frame) frame.hidden = playerMode !== "youtube";
  if (!cover) return;
  if (playerMode === "youtube" || !image) {
    cover.hidden = true;
    cover.removeAttribute("src");
    return;
  }
  cover.hidden = false;
  if (cover.dataset.src !== image) {
    cover.dataset.src = image;
    cover.src = image;
  }
  cover.alt = title;
}

function paintNowButton() {
  if (playerMode === "youtube" && ytQueue.length) {
    if (!insideId) {
      closeListener();
      return;
    }
    const item = ytQueue[ytIndex];
    if (nowBtn) nowBtn.hidden = false;
    if (nowTitle) nowTitle.textContent = item?.title || "유튜브";
    if (nowMark) nowMark.textContent = ytPaused ? "▶" : "❚❚";
    nowBtn?.setAttribute("aria-label", `${item?.title || "유튜브"} 재생`);
    return;
  }
  const tracks = liveTracks();
  const show = !!insideId && tracks.length > 0;
  if (nowBtn) nowBtn.hidden = !show;
  if (!show) {
    if (listenerEl) listenerEl.hidden = true;
    nowBtn?.setAttribute("aria-expanded", "false");
    return;
  }
  const now = nowPlaying();
  const title = now?.title || tracks[0]?.title || "음악";
  if (nowTitle) nowTitle.textContent = title;
  if (nowMark) nowMark.textContent = now && !now.paused ? "❚❚" : "▶";
  nowBtn?.setAttribute("aria-label", `${title} 플레이리스트`);
}

function paintYoutubeList() {
  if (!listenerList) return;
  const key = ytQueue.map((item) => item.watchId).join("|");
  if (key !== listenerKey) {
    listenerKey = key;
    listenerList.replaceChildren();
    ytQueue.forEach((item, index) => {
      const rowItem = document.createElement("li");
      const row = document.createElement("button");
      row.type = "button";
      row.className = "listener-row";
      row.addEventListener("click", () => playYoutube(index));
      const mark = document.createElement("span");
      mark.className = "now-mark";
      const copy = document.createElement("span");
      copy.className = "listener-copy";
      const name = document.createElement("b");
      name.textContent = item.title;
      copy.append(name);
      row.append(mark, copy);
      rowItem.append(row);
      listenerList.append(rowItem);
    });
  }
  listenerList.querySelectorAll<HTMLButtonElement>(".listener-row").forEach((row, index) => {
    const on = index === ytIndex;
    row.classList.toggle("is-current", on);
    const mark = row.querySelector(".now-mark");
    if (mark) mark.textContent = on && !ytPaused ? "❚❚" : "▶";
  });
  const toggle = document.querySelector<HTMLButtonElement>("#listener-toggle");
  const back = document.querySelector<HTMLButtonElement>("#listener-room");
  if (toggle) toggle.textContent = ytPaused ? "재생" : "일시중지";
  if (back) back.hidden = true;
}

function paintListener() {
  if (playerMode === "youtube") {
    paintYoutubeList();
    return;
  }
  if (!listenerEl || listenerEl.hidden || !listenerList) return;
  const tracks = liveTracks();
  const now = nowPlaying();
  const current = now ? tracks[now.index] : tracks[0];
  paintCover(current?.image ?? "", current?.title ?? "");
  const key = tracks.map((track) => track.url).join("|");
  if (key !== listenerKey) {
    listenerKey = key;
    listenerList.replaceChildren();
    tracks.forEach((track, index) => {
      const item = document.createElement("li");
      const row = document.createElement("button");
      row.type = "button";
      row.className = "listener-row";
      row.dataset.index = String(index);
      row.addEventListener("click", () => controlPlaylist(index));
      const mark = document.createElement("span");
      mark.className = "now-mark";
      const copy = document.createElement("span");
      copy.className = "listener-copy";
      const name = document.createElement("b");
      name.textContent = track.title;
      const meta = document.createElement("span");
      meta.className = "listener-meta";
      copy.append(name, meta);
      row.append(mark, copy);
      item.append(row);
      listenerList.append(item);
    });
  }
  listenerList.querySelectorAll<HTMLButtonElement>(".listener-row").forEach((row) => {
    const index = Number(row.dataset.index);
    const on = !!now && index === now.index;
    row.classList.toggle("is-current", on);
    const mark = row.querySelector(".now-mark");
    if (mark) mark.textContent = on && now && !now.paused ? "❚❚" : "▶";
    const meta = row.querySelector(".listener-meta");
    if (!meta) return;
    meta.textContent = on && now
      ? `${now.paused ? "일시정지" : now.personal ? "듣는 중" : "방 음악"} ${clockLabel(now.offset)} / ${clockLabel(now.duration)}`
      : lengthLabel(tracks[index]?.duration ?? 0);
  });
  const toggle = document.querySelector<HTMLButtonElement>("#listener-toggle");
  const back = document.querySelector<HTMLButtonElement>("#listener-room");
  if (toggle) toggle.textContent = now && !now.paused ? "일시중지" : "이어 듣기";
  if (back) back.hidden = ear.mode !== "pick";
}

async function mountYoutube(watchId: string) {
  await youtubeApi();
  const frame = document.querySelector<HTMLElement>("#listener-yt");
  const api = (window as Window & { YT?: { Player: new (el: HTMLElement, opts: object) => NonNullable<typeof ytPlayer> } }).YT;
  if (!frame || !api || playerMode !== "youtube") return;
  frame.hidden = false;
  frame.replaceChildren();
  const slot = document.createElement("div");
  frame.append(slot);
  try { ytPlayer?.destroy(); } catch { /* replaced below */ }
  ytPlayer = new api.Player(slot, {
    videoId: watchId,
    playerVars: { autoplay: 1, rel: 0, modestbranding: 1, playsinline: 1, origin: location.origin },
    events: {
      onReady: (event: { target?: { playVideo?: () => void } }) => event.target?.playVideo?.(),
      onStateChange: (event: { data?: number }) => {
        if (playerMode !== "youtube") return;
        const state = event.data ?? -1;
        if (state === 0) {
          playYoutube(ytIndex + 1);
          return;
        }
        ytPaused = state !== 1 && state !== 3;
        paintYoutubeList();
        paintNowButton();
      },
    },
  });
}

function playYoutube(index: number) {
  if (!ytQueue.length) return;
  ytIndex = ((index % ytQueue.length) + ytQueue.length) % ytQueue.length;
  ytPaused = false;
  const item = ytQueue[ytIndex];
  if (ytPlayer) ytPlayer.loadVideoById(item.watchId);
  else void mountYoutube(item.watchId);
  paintYoutubeList();
  paintNowButton();
}

async function openYoutube(queue: { watchId: string; title: string; image?: string }[], shorts: boolean) {
  playerMode = "youtube";
  ytQueue = queue;
  ytIndex = 0;
  ytPaused = false;
  listenerKey = "";
  stopRoomMusic();
  const title = document.querySelector("#listener-title");
  if (title) title.textContent = shorts ? "유튜브 숏츠" : "유튜브";
  const help = document.querySelector("#listener-help");
  if (help) help.textContent = "이 영상은 이 화면에서만 재생돼요.";
  const stage = document.querySelector<HTMLElement>("#listener-stage");
  if (stage) stage.dataset.shape = shorts ? "short" : "";
  paintCover("", "");
  if (listenerEl) listenerEl.hidden = false;
  nowBtn?.setAttribute("aria-expanded", "true");
  paintYoutubeList();
  await mountYoutube(queue[0].watchId);
}

const picklikeBase = (import.meta.env.VITE_PICKLIKE_URL?.trim() || "http://127.0.0.1:3000").replace(/\/$/, "");
let picklikeReady = false;
let picklikeOrigin = "";
let roomPlayRequest: { title: string; fills?: RoomFill[]; tracks?: RoomMusicTrack[] } | null = null;

function picklikePage() {
  try {
    const configured = new URL(picklikeBase);
    if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
      configured.hostname = location.hostname;
    }
    return configured.origin;
  } catch {
    return picklikeBase;
  }
}

function samePicklike(origin: string) {
  try {
    const url = new URL(origin);
    const expected = new URL(picklikeBase);
    return url.protocol === expected.protocol && url.port === expected.port;
  } catch {
    return false;
  }
}

function postRoomPlay() {
  const frame = document.querySelector<HTMLIFrameElement>("#picklike-player-frame");
  if (!frame?.contentWindow || !roomPlayRequest || !picklikeReady) return;
  frame.contentWindow.postMessage({ type: "birthday-room-play", ...roomPlayRequest }, picklikeOrigin || picklikePage());
}

type PlayerFrame = { left: number; top: number; width: number; height: number };

const PLAYER_FRAME_KEY = "birthday.player-frame";

function readPlayerFrame(): PlayerFrame | null {
  try {
    const raw = localStorage.getItem(PLAYER_FRAME_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PlayerFrame>;
    const left = Number(parsed.left);
    const top = Number(parsed.top);
    const width = Number(parsed.width);
    const height = Number(parsed.height);
    if (![left, top, width, height].every(Number.isFinite)) return null;
    if (width < 300 || height < 360) return null;
    return { left, top, width, height };
  } catch {
    return null;
  }
}

function writePlayerFrame(frame: PlayerFrame) {
  try {
    localStorage.setItem(PLAYER_FRAME_KEY, JSON.stringify(frame));
  } catch {
    // ignore quota / private mode
  }
}

function clampPlayerFrame(frame: PlayerFrame, pinX: "left" | "right" = "left", pinY: "top" | "bottom" = "top"): PlayerFrame {
  const margin = 8;
  const minW = 300;
  const minH = 360;
  const maxW = Math.max(minW, window.innerWidth - margin * 2);
  const maxH = Math.max(minH, window.innerHeight - margin * 2);
  let width = Math.min(maxW, Math.max(minW, frame.width));
  let height = Math.min(maxH, Math.max(minH, frame.height));
  const right = frame.left + frame.width;
  const bottom = frame.top + frame.height;
  let left = pinX === "right" ? right - width : frame.left;
  let top = pinY === "bottom" ? bottom - height : frame.top;
  if (left < margin) {
    const shift = margin - left;
    left = margin;
    if (pinX === "right") width = Math.max(minW, width - shift);
  }
  if (left + width > window.innerWidth - margin) {
    if (pinX === "left") width = Math.max(minW, window.innerWidth - margin - left);
    else left = Math.max(margin, window.innerWidth - margin - width);
  }
  if (top < margin) {
    const shift = margin - top;
    top = margin;
    if (pinY === "bottom") height = Math.max(minH, height - shift);
  }
  if (top + height > window.innerHeight - margin) {
    if (pinY === "top") height = Math.max(minH, window.innerHeight - margin - top);
    else top = Math.max(margin, window.innerHeight - margin - height);
  }
  return { left, top, width, height };
}

function applyPlayerFrame(host: HTMLElement, frame: PlayerFrame) {
  host.style.left = `${Math.round(frame.left)}px`;
  host.style.top = `${Math.round(frame.top)}px`;
  host.style.right = "auto";
  host.style.bottom = "auto";
  host.style.width = `${Math.round(frame.width)}px`;
  host.style.height = `${Math.round(frame.height)}px`;
}

function clearPlayerFrameStyle(host: HTMLElement) {
  host.style.left = "";
  host.style.top = "";
  host.style.right = "";
  host.style.bottom = "";
  host.style.width = "";
  host.style.height = "";
}

function showListFrame(host: HTMLElement) {
  host.dataset.mode = "list";
  clearPlayerFrameStyle(host);
}

function showFullPlayerFrame(host: HTMLElement) {
  delete host.dataset.mode;
  const saved = readPlayerFrame();
  if (saved) applyPlayerFrame(host, clampPlayerFrame(saved));
  else clearPlayerFrameStyle(host);
}

let hostGesture: PlayerFrame & { screenX: number; screenY: number } | null = null;
let hostDragOverlay: HTMLDivElement | null = null;

function rememberHostFrame(host: HTMLElement) {
  const rect = host.getBoundingClientRect();
  const frame = clampPlayerFrame({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
  writePlayerFrame(frame);
}

function moveHostToPointer(screenX: number, screenY: number) {
  const host = document.querySelector<HTMLElement>("#picklike-player");
  if (!host || !hostGesture || host.dataset.mode === "mini" || host.dataset.mode === "list") return;
  const next = clampPlayerFrame({
    left: hostGesture.left + (screenX - hostGesture.screenX),
    top: hostGesture.top + (screenY - hostGesture.screenY),
    width: hostGesture.width,
    height: hostGesture.height,
  });
  applyPlayerFrame(host, next);
}

function showHostDragOverlay() {
  if (hostDragOverlay) return;
  const overlay = document.createElement("div");
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.zIndex = "30";
  overlay.style.cursor = "grabbing";
  overlay.style.touchAction = "none";
  const move = (event: PointerEvent) => moveHostToPointer(event.screenX, event.screenY);
  const end = () => {
    overlay.removeEventListener("pointermove", move);
    overlay.removeEventListener("pointerup", end);
    overlay.removeEventListener("pointercancel", end);
    overlay.remove();
    if (hostDragOverlay === overlay) hostDragOverlay = null;
    const host = document.querySelector<HTMLElement>("#picklike-player");
    hostGesture = null;
    if (host && host.dataset.mode !== "mini") rememberHostFrame(host);
  };
  overlay.addEventListener("pointermove", move);
  overlay.addEventListener("pointerup", end);
  overlay.addEventListener("pointercancel", end);
  document.body.appendChild(overlay);
  hostDragOverlay = overlay;
}

let listReady = false;
let listOrigin = "";
let roomListRequest: { title: string; fills?: RoomFill[]; tracks?: RoomMusicTrack[] } | null = null;

function listFrameEl() {
  return document.querySelector<HTMLIFrameElement>("#picklike-list-frame");
}

function postList(message: object) {
  const frame = listFrameEl();
  if (!frame?.contentWindow || !listReady) return;
  frame.contentWindow.postMessage(message, listOrigin || picklikePage());
}

function postListPlay() {
  if (!roomListRequest) return;
  postList({ type: "birthday-room-play", surface: "list", ...roomListRequest });
}

function openListFrame(request: { title: string; fills?: RoomFill[]; tracks?: RoomMusicTrack[] }) {
  const host = document.querySelector<HTMLElement>("#picklike-list");
  const frame = listFrameEl();
  if (!host || !frame) return;
  roomListRequest = request;
  if (!frame.src) frame.src = `${picklikePage()}/ko/room-player?surface=list`;
  host.hidden = false;
  postListPlay();
  if (accountTokens) {
    postList({ type: "birthday-auth", accessToken: accountTokens.accessToken, refreshToken: accountTokens.refreshToken });
  }
}

function closeListFrame() {
  const host = document.querySelector<HTMLElement>("#picklike-list");
  if (host?.hidden !== false) return;
  postList({ type: "birthday-room-stop" });
  host.hidden = true;
  roomListRequest = null;
}

function openPicklike(request: { title: string; fills?: RoomFill[]; tracks?: RoomMusicTrack[] }) {
  const host = document.querySelector<HTMLElement>("#picklike-player");
  const frame = document.querySelector<HTMLIFrameElement>("#picklike-player-frame");
  if (!host || !frame) return;
  stopRoomMusic();
  if (listenerEl) listenerEl.hidden = true;
  if (!host.hidden && host.dataset.mode === "mini") {
    openListFrame(request);
    return;
  }
  closeListFrame();
  roomPlayRequest = request;
  showListFrame(host);
  if (!frame.src) frame.src = `${picklikePage()}/ko/room-player`;
  host.hidden = false;
  postRoomPlay();
}

function closePicklike() {
  closeListFrame();
  const host = document.querySelector<HTMLElement>("#picklike-player");
  const frame = document.querySelector<HTMLIFrameElement>("#picklike-player-frame");
  if (host?.hidden !== false) return;
  if (frame?.contentWindow && picklikeReady) {
    frame.contentWindow.postMessage({ type: "birthday-room-stop" }, picklikeOrigin || picklikePage());
  }
  host.hidden = true;
  roomPlayRequest = null;
  syncRoomMusic();
}

function catalogTrackId(value: string | undefined) {
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value : "";
}

function playerTracks(tracks: RoomMusicTrack[]) {
  const byUrl = new Map<string, string>();
  for (const space of hallSpaces) {
    for (const track of space.tracks) {
      const id = catalogTrackId(track.id);
      if (id) byUrl.set(track.url, id);
    }
  }
  return tracks.map((track) => {
    const id = catalogTrackId(track.id) || byUrl.get(track.url) || "";
    return id ? { ...track, id } : track;
  });
}

function openRoomAudio() {
  const tracks = playerTracks(liveTracks());
  if (!tracks.length) {
    toast("이 방에는 음악이 없어요.");
    return;
  }
  openPicklike({ title: "이 방의 음악", tracks });
}

function showBoard(id?: string) {
  const layer = document.querySelector<HTMLElement>("#board-read");
  const text = document.querySelector<HTMLElement>("#board-read-text");
  if (!layer || !text) return;
  const item = state?.rooms.find((room) => room.id === insideId)?.layout?.find((row) => row.id === id && row.kind === "board");
  text.textContent = item?.note?.trim() || "아직 적힌 말이 없어요.";
  layer.hidden = false;
}

function hideBoard() {
  const layer = document.querySelector<HTMLElement>("#board-read");
  if (layer) layer.hidden = true;
}

function openBox(prop: RoomProp, id?: string) {
  if (prop === "player") {
    openRoomAudio();
    return;
  }
  const item = state?.rooms.find((room) => room.id === insideId)?.layout?.find((row) => row.id === id);
  const rows = [...(item?.fills ?? []), ...(item?.fill ? [item.fill] : [])];
  if (!rows.length) {
    toast("이 상자에는 재생할 내용이 없어요.");
    return;
  }
  openPicklike({
    title: item?.kind === "yt-shorts" ? "유튜브 숏츠" : "유튜브",
    fills: rows,
  });
}

window.addEventListener("message", (event) => {
  if (!samePicklike(event.origin)) return;
  const data = event.data as { type?: string } | null;
  if (!data || typeof data !== "object") return;
  const fromList = event.source === listFrameEl()?.contentWindow || data.type === "birthday-room-switch";
  if (fromList) {
    if (data.type === "birthday-room-ready") {
      listReady = true;
      listOrigin = event.origin;
      postListPlay();
      if (accountTokens) {
        postList({ type: "birthday-auth", accessToken: accountTokens.accessToken, refreshToken: accountTokens.refreshToken });
      }
    } else if (data.type === "birthday-room-closed" || data.type === "birthday-room-empty") {
      if (data.type === "birthday-room-empty") toast("이 상자에서 재생할 항목을 찾지 못했어요.");
      closeListFrame();
    } else if (data.type === "birthday-room-switch") {
      const frame = document.querySelector<HTMLIFrameElement>("#picklike-player-frame");
      const payload = data as { startId?: string; title?: string; fills?: unknown; tracks?: unknown };
      if (frame?.contentWindow && picklikeReady) {
        const message = {
          type: "birthday-room-queue",
          startId: payload.startId,
          title: payload.title,
          fills: payload.fills,
          tracks: payload.tracks,
        };
        const target = picklikeOrigin || picklikePage();
        try {
          frame.contentWindow.postMessage(message, target);
        } catch {
          frame.contentWindow.postMessage(message, "*");
        }
      }
    }
    return;
  }
  if (data.type === "birthday-room-mini" || data.type === "birthday-room-full" || data.type === "birthday-room-list") {
    const host = document.querySelector<HTMLElement>("#picklike-player");
    if (host) {
      if (data.type === "birthday-room-mini") {
        host.dataset.mode = "mini";
        clearPlayerFrameStyle(host);
      } else if (data.type === "birthday-room-list") showListFrame(host);
      else showFullPlayerFrame(host);
    }
  }
  if (data.type === "birthday-room-frame") {
    const host = document.querySelector<HTMLElement>("#picklike-player");
    const phase = (data as { phase?: string }).phase;
    const screenX = Number((data as { screenX?: unknown }).screenX);
    const screenY = Number((data as { screenY?: unknown }).screenY);
    if (host && host.dataset.mode !== "mini" && host.dataset.mode !== "list") {
      if (phase === "begin" && Number.isFinite(screenX) && Number.isFinite(screenY)) {
        const rect = host.getBoundingClientRect();
        hostGesture = { left: rect.left, top: rect.top, width: rect.width, height: rect.height, screenX, screenY };
        showHostDragOverlay();
      } else if (phase === "move" && Number.isFinite(screenX) && Number.isFinite(screenY)) {
        moveHostToPointer(screenX, screenY);
      } else if (phase === "end") {
        hostGesture = null;
        hostDragOverlay?.remove();
        hostDragOverlay = null;
        rememberHostFrame(host);
      }
    }
  }
  if (data.type === "birthday-room-closed") closePicklike();
  if (data.type === "birthday-room-ready") {
    picklikeReady = true;
    picklikeOrigin = event.origin;
    postRoomPlay();
    pushAccountToPicklike(false);
  }
  if (data.type === "birthday-auth-clear") {
    offeredTokens = null;
    if (accountTokens) void signOutAccount();
  }
  if (data.type === "birthday-auth") {
    const tokens = readAuthTokens(
      (data as { accessToken?: unknown }).accessToken,
      (data as { refreshToken?: unknown }).refreshToken,
    );
    if (!tokens || accountTokens?.accessToken === tokens.accessToken) return;
    const currentUser = accountTokens ? tokenUser(accountTokens.accessToken) : "";
    const incomingUser = tokenUser(tokens.accessToken);
    if (currentUser && incomingUser && currentUser !== incomingUser) return;
    if (!accountSeen) {
      offeredTokens = tokens;
      return;
    }
    offeredTokens = null;
    void adoptAccountSession(tokens.accessToken, tokens.refreshToken);
  }
  if (data.type === "birthday-room-empty") {
    toast("이 상자에서 재생할 항목을 찾지 못했어요.");
    closePicklike();
  }
  if (data.type === "birthday-room-auth") {
    toast("PickLike에 로그인한 뒤 이 상자를 열 수 있어요.");
    closePicklike();
  }
});

function openListener() {
  if (!listenerEl || !liveTracks().length) return;
  const resume = playerMode === "youtube";
  playerMode = "music";
  destroyYoutube();
  ytQueue = [];
  const title = document.querySelector("#listener-title");
  if (title) title.textContent = "이 방의 음악";
  const help = document.querySelector("#listener-help");
  if (help) help.textContent = "고른 곡은 나에게만 들립니다.";
  const stage = document.querySelector<HTMLElement>("#listener-stage");
  if (stage) delete stage.dataset.shape;
  listenerKey = "";
  listenerEl.hidden = false;
  nowBtn?.setAttribute("aria-expanded", "true");
  paintListener();
  if (resume) syncRoomMusic();
}

function closeListener() {
  const wasYoutube = playerMode === "youtube";
  playerMode = "music";
  destroyYoutube();
  ytQueue = [];
  if (listenerEl) listenerEl.hidden = true;
  nowBtn?.setAttribute("aria-expanded", "false");
  if (wasYoutube) syncRoomMusic();
}

function showPlayingTrack() {
  paintNowButton();
  paintListener();
}

function lengthLabel(duration: number) {
  const seconds = Math.max(1, Math.round(duration));
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}분 ${seconds % 60}초` : `${seconds}초`;
}

document.querySelector("#character-look")?.addEventListener("click", () => {
  if (!accountEmailText) {
    accountMode = "signup";
    paintAccount();
    if (accountEl) accountEl.hidden = false;
    return;
  }
  void openCharacters("mine");
});
document.querySelector("#character-face-file")?.addEventListener("change", (event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file || !file.type.startsWith("image/")) {
    toast("사진 파일을 골라 주세요.");
    return;
  }
  void wearFace(URL.createObjectURL(file), file.name.replace(/\.[^.]+$/, "") || "얼굴");
});
document.querySelector("#characters-close")?.addEventListener("click", closeCharacters);
charactersEl?.addEventListener("click", (event) => {
  if (event.target === charactersEl) closeCharacters();
});
document.querySelectorAll<HTMLButtonElement>("#character-tabs button").forEach((button) => {
  button.addEventListener("click", () => {
    const tab = button.dataset.tab === "free" ? "free" : "mine";
    void openCharacters(tab);
  });
});

wearLook();

function paintSound() {
  if (!soundBtn) return;
  soundBtn.dataset.on = soundOn ? "1" : "0";
  soundBtn.setAttribute("aria-label", soundOn ? "소리 끄기" : "소리 켜기");
}

nowBtn?.addEventListener("click", () => {
  const host = document.querySelector<HTMLElement>("#picklike-player");
  if (host && !host.hidden) closePicklike();
  else openRoomAudio();
});
document.querySelectorAll<HTMLElement>("#picklike-player .player-edge").forEach((edge) => {
  edge.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const host = document.querySelector<HTMLElement>("#picklike-player");
    if (!host || host.dataset.mode === "mini" || host.dataset.mode === "list") return;
    event.preventDefault();
    edge.setPointerCapture(event.pointerId);
    const which = edge.dataset.edge ?? "left";
    const fromLeft = which === "left" || which === "top-left" || which === "bottom-left";
    const fromRight = which === "right" || which === "top-right" || which === "bottom-right";
    const fromTop = which === "top-left" || which === "top-right";
    const fromBottom = which === "bottom" || which === "bottom-left" || which === "bottom-right";
    const rect = host.getBoundingClientRect();
    const start = { x: event.screenX, y: event.screenY, left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    const move = (ev: PointerEvent) => {
      const dx = ev.screenX - start.x;
      const dy = ev.screenY - start.y;
      const next = { left: start.left, top: start.top, width: start.width, height: start.height };
      if (fromLeft) {
        next.width = start.width - dx;
        next.left = start.left + dx;
      } else if (fromRight) {
        next.width = start.width + dx;
      }
      if (fromTop) {
        next.height = start.height - dy;
        next.top = start.top + dy;
      } else if (fromBottom) {
        next.height = start.height + dy;
      }
      applyPlayerFrame(host, clampPlayerFrame(next, fromLeft ? "right" : "left", fromTop ? "bottom" : "top"));
    };
    const up = () => {
      edge.removeEventListener("pointermove", move);
      edge.removeEventListener("pointerup", up);
      edge.removeEventListener("pointercancel", up);
      rememberHostFrame(host);
    };
    edge.addEventListener("pointermove", move);
    edge.addEventListener("pointerup", up);
    edge.addEventListener("pointercancel", up);
  });
});
window.addEventListener("resize", () => {
  const host = document.querySelector<HTMLElement>("#picklike-player");
  if (!host || host.hidden || host.dataset.mode === "mini") return;
  const saved = readPlayerFrame();
  if (!saved) return;
  applyPlayerFrame(host, clampPlayerFrame(saved));
});
document.querySelector("#listener-close")?.addEventListener("click", closeListener);
document.querySelector("#listener-toggle")?.addEventListener("click", () => {
  if (playerMode === "youtube") {
    if (ytPaused) ytPlayer?.playVideo();
    else ytPlayer?.pauseVideo();
    return;
  }
  const now = nowPlaying();
  if (now && !now.paused) pauseEar();
  else if (ear.mode === "pick") resumeEar();
  else ear = { mode: "pick", index: now?.index ?? 0, offset: now?.offset ?? 0, paused: false, at: Date.now() };
  syncRoomMusic();
});
document.querySelector("#listener-room")?.addEventListener("click", () => {
  ear = { mode: "room" };
  syncRoomMusic();
});
soundBtn?.addEventListener("click", () => {
  soundOn = !soundOn;
  audio.setMuted(!soundOn);
  paintSound();
  if (soundOn) audio.start();
  syncRoomMusic();
});

document.querySelector("#back")?.addEventListener("click", () => {
  void leaveToGate();
});

yardBtn?.addEventListener("click", () => {
  if (!yardsEl) return;
  const open = yardsEl.hidden;
  yardsEl.hidden = !open;
  yardBtn.setAttribute("aria-expanded", open ? "true" : "false");
  if (open) {
    sheetOpen = false;
    paintSheet();
  }
});

document.querySelector("#yards-close")?.addEventListener("click", () => closeYards());
yardsEl?.addEventListener("click", (event) => {
  if (event.target === yardsEl) closeYards();
});

document.querySelector("#board-read")?.addEventListener("click", (event) => {
  if (event.target === event.currentTarget) hideBoard();
});
document.querySelector("#board-read-close")?.addEventListener("click", () => hideBoard());
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") hideBoard();
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
    if (hit.kind === "prop" && hit.prop === "board") showBoard(hit.id);
    else if (hit.kind === "prop" && (hit.prop === "player" || hit.prop === "screen")) openBox(hit.prop, hit.id);
    else if (hit.kind === "prop") world.useProp(hit.prop satisfies RoomProp);
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
    closeSheet();
  }
  render();
});

window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (sheetOpen) {
    closeSheet();
    return;
  }
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

const authFrame = document.querySelector<HTMLIFrameElement>("#picklike-player-frame");
if (authFrame && !authFrame.src) authFrame.src = `${picklikePage()}/ko/room-player`;
