export type HallCharacter = {
  id: string;
  title: string;
  thumbUrl: string;
  bodyUrl: string;
  motions: {
    walk?: string;
    run?: string;
    sit?: string;
    bow?: string;
    jump?: string;
  };
};

function picklikeOrigin() {
  const base = (import.meta.env.VITE_PICKLIKE_URL?.trim() || "http://127.0.0.1:3000").replace(/\/$/, "");
  try {
    const configured = new URL(base);
    if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
      configured.hostname = location.hostname;
    }
    return configured.origin;
  } catch {
    return base;
  }
}

const LIST_MS = 60_000;
let listCache: { key: string; at: number; data: { mine: HallCharacter[]; free: HallCharacter[] } } | null = null;
const fileCache = new Map<string, Promise<ArrayBuffer>>();

export function clearHallCharacterList() {
  listCache = null;
}

export function peekHallCharacters(token: string | null) {
  if (!listCache || listCache.key !== (token ?? "")) return null;
  return listCache.data;
}

export async function loadHallCharacters(token: string | null): Promise<{
  mine: HallCharacter[];
  free: HallCharacter[];
}> {
  const key = token ?? "";
  if (listCache && listCache.key === key && Date.now() - listCache.at < LIST_MS) return listCache.data;
  const res = await fetch(`${picklikeOrigin()}/api/hall/characters`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const json = (await res.json()) as {
    success?: boolean;
    data?: { mine?: HallCharacter[]; free?: HallCharacter[] };
  };
  if (!res.ok || !json.success || !json.data) throw new Error("REQUEST_FAILED");
  const data = {
    mine: json.data.mine ?? [],
    free: json.data.free ?? [],
  };
  listCache = { key, at: Date.now(), data };
  return data;
}

export function characterFileReady(url: string | undefined) {
  return !url || fileCache.has(url);
}

export async function characterFile(url: string | undefined): Promise<ArrayBuffer | null> {
  if (!url) return null;
  let pending = fileCache.get(url);
  if (!pending) {
    pending = fetch(url).then(async (res) => {
      if (!res.ok) throw new Error("FETCH_FAILED");
      return res.arrayBuffer();
    });
    pending.catch(() => {
      if (fileCache.get(url) === pending) fileCache.delete(url);
    });
    fileCache.set(url, pending);
  }
  const bytes = await pending;
  return bytes.slice(0);
}
