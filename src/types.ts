export const CARDS = [
  { id: "birthday", text: "생일 축하해" },
  { id: "enough", text: "올해도 수고했어" },
  { id: "eat", text: "맛있는 거 먹어" },
  { id: "health", text: "건강해" },
  { id: "soft", text: "오늘 하루가 포근하길" },
  { id: "day", text: "좋은 하루 보내" },
  { id: "rest", text: "오늘은 쉬어도 돼" },
  { id: "glad", text: "네가 있어서 다행이야" },
  { id: "side", text: "올해도 네 편이야" },
  { id: "warmth", text: "따뜻하게 지내" },
  { id: "joy", text: "작은 기쁨이 많기를" },
  { id: "slow", text: "오늘만큼은 느긋하게" },
  { id: "thanks", text: "잘 살아줘서 고마워" },
  { id: "smile", text: "웃음이 많은 하루이길" },
  { id: "breath", text: "편히 숨 쉬어" },
  { id: "seat", text: "네 자리가 여기 있어" },
] as const;

export type CardId = (typeof CARDS)[number]["id"];

export function cardLabel(id: string) {
  return CARDS.find((card) => card.id === id)?.text ?? "";
}

export type Candle = {
  id: string;
  card: string;
  text?: string;
  fromId: string;
  fromName: string;
  at: number;
  online?: boolean | null;
};

export type Mood = "cool" | "lantern" | "flower" | "dim" | "warm" | "moon";

export type Occupant = {
  name: string;
  kind: "hall" | "guest";
  ownerId: string | null;
  color: string;
  skin: string;
  hair?: string;
  bowingUntil: number;
  note?: string;
  music?: RoomMusic | null;
};

export type RoomMusicTrack = {
  id?: string;
  title: string;
  url: string;
  duration: number;
  image?: string;
};

export type RoomFill = {
  source: string;
  refId: string;
  title: string;
  image?: string;
  medium?: "music" | "video";
  watchId?: string;
};

export type RoomMusic = {
  tracks: RoomMusicTrack[];
  startedAt: number;
  pausedAt?: number | null;
  stopped?: boolean;
};

export type RoomLayoutItem = {
  id: string;
  kind: string;
  x: number;
  z: number;
  fill?: RoomFill;
  fills?: RoomFill[];
  /** Welcome or guide written on a whiteboard. */
  note?: string;
};

export type RoomFacade = {
  door: "wood" | "cream" | "red" | "green" | "navy";
  window: boolean;
  accent: "none" | "lamp" | "plant" | "wreath";
};

export type RoomState = {
  id: string;
  title: string;
  trait: string;
  mood: Mood;
  /** Custom rooms only. Template yard rooms stay the parlor. */
  shell?: "parlor" | "stage" | "roof";
  /** Custom rooms only. The owner’s door, extra window, and door ornament. */
  facade?: RoomFacade;
  x: number;
  z: number;
  angle: number;
  occupant: Occupant | null;
  candleCount?: number;
  candles: Candle[];
  /** PickLike space placed in the yard. Stays out of the saved template rooms. */
  custom?: boolean;
  layout?: RoomLayoutItem[];
  /** Plays inside this room even before someone claims it. */
  music?: RoomMusic | null;
};

export type WalkerFigure = {
  body: string;
  walk?: string;
  sit?: string;
  bow?: string;
};

export type Walker = {
  id: string;
  name: string;
  x: number;
  z: number;
  roomId: string | null;
  visitRoomId: string | null;
  visitX: number;
  visitZ: number;
  pose: "stand" | "sit" | "mirror";
  color: string;
  skin: string;
  hair?: string;
  kind?: "person" | "dog" | "cat";
  figure?: WalkerFigure | null;
  face?: string | null;
};

export type DayRole = "birthday" | "guest";

export type YardInfo = {
  id: string;
  name: string;
  birthday: number;
  empty: number;
  users: number;
  max: number;
};

export type HallState = {
  type: "state";
  date: string;
  yesterday: number;
  yardId: string;
  yards: YardInfo[];
  youId: string;
  yourName: string;
  yourLook: { id: string; color: string; skin: string; hair: string } | null;
  yourRole: DayRole | null;
  yourRoomId: string | null;
  litRoomIds: string[];
  rooms: RoomState[];
  walkers: Walker[];
  facePack?: Record<string, string | null>;
  now: number;
  ack?: "bow" | "claim" | "release" | "light";
  ackText?: string;
  event?: { kind: "candle"; roomId: string; ownerId: string | null };
  thanks?: { fromName: string; text?: string };
};

export type RoomProp = "cake" | "sofa" | "mirror" | "player" | "screen" | "board";

export type WorldPick =
  | { kind: "room"; id: string }
  | { kind: "ground"; x: number; z: number }
  | { kind: "prop"; prop: RoomProp; id?: string };
