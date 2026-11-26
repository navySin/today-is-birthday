export type HallTrack = {
  id: string;
  title: string;
  url: string;
  duration: number | null;
  image: string;
  at: number;
};

const LIST_MS = 60_000;
let listCache: { key: string; at: number; data: HallTrack[] } | null = null;

export function peekHallTracks(token: string | null) {
  if (!listCache || listCache.key !== (token ?? "")) return null;
  return listCache.data;
}

export async function loadHallTracks(token: string | null): Promise<HallTrack[]> {
  const key = token ?? "";
  if (listCache && listCache.key === key && Date.now() - listCache.at < LIST_MS) return listCache.data;
  const base = (import.meta.env.VITE_PICKLIKE_URL?.trim() || "http://127.0.0.1:3000").replace(/\/$/, "");
  const res = await fetch(`${base}/api/hall/tracks`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const json = (await res.json()) as { success?: boolean; data?: { mine?: HallTrack[] } };
  if (!res.ok || !json.success || !json.data) throw new Error("REQUEST_FAILED");
  const data = (json.data.mine ?? []).map(asTrack);
  listCache = { key, at: Date.now(), data };
  return data;
}

function asTrack(card: HallTrack): HallTrack {
  const image = typeof card.image === "string" && card.image.startsWith("https://") ? card.image : "";
  const at = typeof card.at === "number" && Number.isFinite(card.at) ? card.at : 0;
  return {
    id: typeof card.id === "string" ? card.id : card.url,
    title: card.title || "배경음악",
    url: card.url,
    duration: typeof card.duration === "number" && card.duration > 0 ? card.duration : null,
    image,
    at,
  };
}
