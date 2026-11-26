import { createClient, type Session } from "@supabase/supabase-js";
import type { HallCharacter } from "./characters";

const url = import.meta.env.VITE_SUPABASE_URL?.trim() || "";
const key = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() || "";

export const accountReady = Boolean(url && key);

const supabase = accountReady
  ? createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export function onAccount(listener: (session: Session | null) => void): () => void {
  if (!supabase) {
    listener(null);
    return () => undefined;
  }
  const { data } = supabase.auth.onAuthStateChange((_event, session) => listener(session));
  return () => data.subscription.unsubscribe();
}

export async function currentAccount(): Promise<Session | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function signInAccount(email: string, password: string): Promise<string | null> {
  if (!supabase) return "계정 연결이 아직 없어요.";
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return error ? "로그인하지 못했어요. 이메일과 비밀번호를 확인해 주세요." : null;
}

export async function signUpAccount(email: string, password: string): Promise<string | null> {
  if (!supabase) return "계정 연결이 아직 없어요.";
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: window.location.origin },
  });
  if (error) return "가입하지 못했어요. 이메일과 비밀번호를 확인해 주세요.";
  if (!data.session) return "확인 메일을 보냈어요. 확인한 뒤 여기서 로그인하면 돼요.";
  return null;
}

export async function signInWithGoogle(): Promise<string | null> {
  if (!supabase) return "계정 연결이 아직 없어요.";
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin },
  });
  return error ? "Google 로그인으로 넘어가지 못했어요." : null;
}

export async function resetAccountPassword(email: string): Promise<string | null> {
  if (!supabase) return "계정 연결이 아직 없어요.";
  const picklike = (import.meta.env.VITE_PICKLIKE_URL?.trim() || "http://127.0.0.1:3000").replace(/\/$/, "");
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${picklike}/auth/reset-password`,
  });
  return error ? "비밀번호 메일을 보내지 못했어요." : "비밀번호 메일을 보냈어요.";
}

export async function signOutAccount(): Promise<void> {
  await supabase?.auth.signOut();
}

let refreshHeld = false;

/** The room frame refreshes the shared login, so this page does not rotate the same token. */
export async function holdAccountRefresh(hold: boolean): Promise<void> {
  refreshHeld = hold;
  if (!supabase) return;
  if (hold) await supabase.auth.stopAutoRefresh();
  else await supabase.auth.startAutoRefresh();
}

export async function adoptAccountSession(accessToken: string, refreshToken: string): Promise<void> {
  if (!supabase) return;
  const { data } = await supabase.auth.getSession();
  if (data.session?.access_token === accessToken) return;
  const { error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  if (!error && refreshHeld) await supabase.auth.stopAutoRefresh();
}

export type HallMusicTrack = { id?: string; title: string; url: string; duration: number; image?: string };

export type HallMusic = { tracks: HallMusicTrack[] };

export type HallSetup = {
  name: string;
  look: string;
  month: number;
  day: number;
  character: HallCharacter | null;
  music: HallMusic | null;
  at: number;
};

function parseTrack(value: unknown): HallMusicTrack | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const url = typeof row.url === "string" && row.url.startsWith("https://") ? row.url : "";
  if (!url) return null;
  const title = typeof row.title === "string" && row.title.trim() ? row.title.trim().slice(0, 40) : "배경음악";
  const duration = Number(row.duration);
  const image = typeof row.image === "string" && row.image.startsWith("https://") ? row.image : "";
  const id = typeof row.id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.id) ? row.id : "";
  return {
    ...(id ? { id } : {}),
    title,
    url,
    duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
    ...(image ? { image } : {}),
  };
}

function parseMusic(value: unknown): HallMusic | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const source = Array.isArray(row.tracks) ? row.tracks : [row];
  const tracks = source.map(parseTrack).filter((track): track is HallMusicTrack => !!track).slice(0, 100);
  return tracks.length ? { tracks } : null;
}

function motionUrl(value: unknown): string | undefined {
  return typeof value === "string" && value.startsWith("https://") ? value : undefined;
}

export function parseHallSetup(value: unknown): HallSetup | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const month = Number(row.month);
  const day = Number(row.day);
  let character: HallCharacter | null = null;
  if (row.character && typeof row.character === "object") {
    const card = row.character as Record<string, unknown>;
    const bodyUrl = typeof card.bodyUrl === "string" ? card.bodyUrl : "";
    const motions = card.motions && typeof card.motions === "object" ? card.motions as Record<string, unknown> : {};
    if (bodyUrl.startsWith("https://")) {
      character = {
        id: typeof card.id === "string" ? card.id : "",
        title: typeof card.title === "string" && card.title ? card.title : "캐릭터",
        thumbUrl: typeof card.thumbUrl === "string" && card.thumbUrl.startsWith("https://") ? card.thumbUrl : "",
        bodyUrl,
        motions: {
          walk: motionUrl(motions.walk),
          run: motionUrl(motions.run),
          sit: motionUrl(motions.sit),
          bow: motionUrl(motions.bow),
          jump: motionUrl(motions.jump),
        },
      };
    }
  }
  const setup: HallSetup = {
    name: typeof row.name === "string" ? Array.from(row.name).slice(0, 12).join("") : "",
    look: typeof row.look === "string" ? row.look : "",
    month: month >= 1 && month <= 12 ? month : 0,
    day: day >= 1 && day <= 31 ? day : 0,
    character,
    music: parseMusic(row.music),
    at: typeof row.at === "number" && Number.isFinite(row.at) ? row.at : 0,
  };
  if (!setup.name && !setup.look && !setup.month && !setup.character && !setup.music) return null;
  return setup;
}

export async function loadHallSetup(): Promise<HallSetup | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return parseHallSetup(data.user.user_metadata?.hall_setup);
}

export async function saveHallSetup(setup: HallSetup): Promise<void> {
  if (!supabase) return;
  await supabase.auth.updateUser({ data: { hall_setup: setup } });
}

export type HallSpaceFill = {
  source: string;
  refId: string;
  title: string;
  image?: string;
  medium?: "music" | "video";
  watchId?: string;
};

export type HallSpaceObject = {
  id: string;
  kind: string;
  x: number;
  z: number;
  fill?: HallSpaceFill;
  fills?: HallSpaceFill[];
  note?: string;
};

export type HallFacade = {
  door: "wood" | "cream" | "red" | "green" | "navy";
  window: boolean;
  accent: "none" | "lamp" | "plant" | "wreath";
};

export type HallSpace = {
  id: string;
  title: string;
  mood: string;
  shell?: "parlor" | "stage" | "roof";
  facade?: HallFacade;
  at: number;
  tracks: HallMusicTrack[];
  objects: HallSpaceObject[];
};

const SPACE_MOODS = new Set(["cool", "lantern", "flower", "dim", "warm", "moon"]);
const SPACE_KINDS = new Set([
  "cake",
  "sofa",
  "mirror",
  "player",
  "album",
  "yt-music",
  "yt-playlist",
  "yt-video",
  "yt-shorts",
  "board",
]);

function parseFacade(value: unknown, shell: "parlor" | "stage" | "roof"): HallFacade {
  const row = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const doors = ["wood", "cream", "red", "green", "navy"] as const;
  const accents = ["none", "lamp", "plant", "wreath"] as const;
  const fallback = shell === "stage" ? "red" : shell === "roof" ? "navy" : "wood";
  const door = doors.find((item) => item === row.door) ?? fallback;
  const accent = accents.find((item) => item === row.accent) ?? "none";
  return { door, window: row.window === true, accent };
}

function parseSpaceFill(value: unknown): HallSpaceFill | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const source = row.source;
  if (source !== "album" && source !== "track" && source !== "playlist" && source !== "film" && source !== "series" && source !== "short") return null;
  const refId = typeof row.refId === "string" ? row.refId.trim().slice(0, 80) : "";
  const title = typeof row.title === "string" ? row.title.trim().slice(0, 80) : "";
  if (!refId || !title) return null;
  const image = typeof row.image === "string" && row.image.startsWith("https://") ? row.image : "";
  const medium = row.medium === "music" || row.medium === "video" ? row.medium : undefined;
  const watchRaw = typeof row.watchId === "string" ? row.watchId.trim() : "";
  const watchId = /^[A-Za-z0-9_-]{11}$/.test(watchRaw) ? watchRaw : undefined;
  return { source, refId, title, ...(image ? { image } : {}), ...(medium ? { medium } : {}), ...(watchId ? { watchId } : {}) };
}

function parseSpaceObject(value: unknown): HallSpaceObject | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const kind = typeof row.kind === "string" ? row.kind : "";
  if (!SPACE_KINDS.has(kind)) return null;
  const x = Number(row.x);
  const z = Number(row.z);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  const id = typeof row.id === "string" && row.id.trim() ? row.id.trim().slice(0, 80) : kind;
  const fills: HallSpaceFill[] = [];
  const seen = new Set<string>();
  const pushFill = (fill: HallSpaceFill | null) => {
    if (!fill || fills.length >= 100) return;
    const key = `${fill.source}:${fill.refId}`;
    if (seen.has(key)) return;
    seen.add(key);
    fills.push(fill);
  };
  if (Array.isArray(row.fills)) for (const item of row.fills) pushFill(parseSpaceFill(item));
  const fill = parseSpaceFill(row.fill);
  const note = typeof row.note === "string" ? row.note.replace(/\r/g, "").trim().slice(0, 160) : "";
  return {
    id,
    kind,
    x: Math.round(Math.max(-5.4, Math.min(5.4, x)) * 100) / 100,
    z: Math.round(Math.max(-5.2, Math.min(5.2, z)) * 100) / 100,
    ...(fill ? { fill } : {}),
    ...(fills.length ? { fills } : {}),
    ...(note ? { note } : {}),
  };
}

export function parseHallSpaces(value: unknown): HallSpace[] {
  if (!Array.isArray(value)) return [];
  const spaces: HallSpace[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id.trim().slice(0, 40) : "";
    const title = typeof row.title === "string" ? row.title.trim().slice(0, 40) : "";
    const mood = typeof row.mood === "string" ? row.mood : "";
    if (!id || !title || !SPACE_MOODS.has(mood)) continue;
    const at = typeof row.at === "number" && Number.isFinite(row.at) ? row.at : 0;
    const objects: HallSpaceObject[] = [];
    if (Array.isArray(row.objects)) {
      for (const object of row.objects) {
        const parsed = parseSpaceObject(object);
        if (!parsed) continue;
        objects.push(parsed);
        if (objects.length >= 24) break;
      }
    }
    const shell = row.shell === "stage" || row.shell === "roof" ? row.shell : "parlor";
    spaces.push({
      id,
      title,
      mood,
      shell,
      facade: parseFacade(row.facade, shell),
      at,
      tracks: parseMusic({ tracks: row.tracks })?.tracks ?? [],
      objects,
    });
    if (spaces.length >= 24) break;
  }
  return spaces;
}

export async function loadHallSpaces(): Promise<HallSpace[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return [];
  return parseHallSpaces(data.user.user_metadata?.hall_spaces).sort((a, b) => b.at - a.at);
}

/** Playlist on the newest PickLike space. Empty until that space has tracks. */
export async function loadHallSpaceMusic(): Promise<HallMusic | null> {
  const tracks = (await loadHallSpaces())[0]?.tracks ?? [];
  return tracks.length ? { tracks } : null;
}

const FACE_PRESETS: Record<string, readonly [string, string]> = {
  "char-01": ["adventurer", "Aneka"],
  "char-02": ["adventurer", "Blaze"],
  "char-03": ["adventurer", "Coral"],
  "char-04": ["adventurer", "Dusty"],
  "char-05": ["adventurer", "Ember"],
  "char-06": ["adventurer", "Frost"],
  "char-07": ["lorelei", "Harper"],
  "char-08": ["lorelei", "Indigo"],
  "char-09": ["lorelei", "Jade"],
  "char-10": ["lorelei", "Kai"],
  "char-11": ["lorelei", "Luna"],
  "char-12": ["lorelei", "Milo"],
  "char-13": ["adventurer", "Nova"],
  "char-14": ["adventurer", "Orion"],
  "char-15": ["adventurer", "Piper"],
  "char-16": ["adventurer", "Quinn"],
  "char-17": ["adventurer", "River"],
  "char-18": ["adventurer", "Sage"],
  "char-19": ["lorelei", "Tessa"],
  "char-20": ["lorelei", "Uma"],
  "char-21": ["lorelei", "Vesper"],
  "char-22": ["lorelei", "Wren"],
  "char-23": ["lorelei", "Xander"],
  "char-24": ["lorelei", "Yuki"],
  "char-25": ["personas", "Aria"],
  "char-26": ["personas", "Boden"],
  "char-27": ["personas", "Cleo"],
  "char-28": ["personas", "Dario"],
  "char-29": ["personas", "Elara"],
  "char-30": ["personas", "Felix"],
  "char-31": ["personas", "Gia"],
  "char-32": ["personas", "Hugo"],
  "char-33": ["personas", "Iris"],
  "char-34": ["personas", "Jules"],
  "char-35": ["personas", "Kira"],
  "char-36": ["personas", "Leo"],
};

function presetFace(preset: string): string {
  const pair = FACE_PRESETS[preset];
  if (!pair) return "";
  return `https://api.dicebear.com/9.x/${pair[0]}/svg?seed=${encodeURIComponent(pair[1])}&size=96`;
}

export async function accountFace(): Promise<{ name: string; avatarUrl: string } | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user;
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, avatar_url, avatar_preset")
    .eq("id", user.id)
    .maybeSingle();
  const meta = user.user_metadata as {
    full_name?: string;
    name?: string;
    avatar_url?: string;
    picture?: string;
  };
  const row = profile as { display_name?: string | null; avatar_url?: string | null; avatar_preset?: string | null } | null;
  const name =
    row?.display_name?.trim() ||
    meta.full_name ||
    meta.name ||
    user.email?.split("@")[0] ||
    "계정";
  const custom = row?.avatar_url?.trim() || "";
  const preset = row?.avatar_preset ? presetFace(row.avatar_preset) : "";
  const google = meta.avatar_url || meta.picture || "";
  return { name, avatarUrl: custom || preset || google };
}
