// GIF search via Tenor (Google). Free API key from
// https://developers.google.com/tenor — until one is set in .env as
// EXPO_PUBLIC_TENOR_API_KEY, the GIF button stays hidden.

const TENOR_KEY = process.env.EXPO_PUBLIC_TENOR_API_KEY ?? '';

export const GIFS_READY = TENOR_KEY.length > 0;

export type GifResult = {
  id: string;
  /** Small animated preview for the picker grid. */
  previewUrl: string;
  /** The GIF actually sent in chat. */
  url: string;
};

type TenorResponse = {
  results?: {
    id: string;
    media_formats?: Record<string, { url?: string }>;
  }[];
};

async function tenor(path: string, params: Record<string, string>): Promise<GifResult[]> {
  const query = new URLSearchParams({
    key: TENOR_KEY,
    client_key: 's333xhub',
    limit: '24',
    media_filter: 'tinygif,gif',
    ...params,
  });
  const res = await fetch(`https://tenor.googleapis.com/v2/${path}?${query}`);
  if (!res.ok) throw new Error('GIF search is not responding — try again.');
  const json = (await res.json()) as TenorResponse;
  return (json.results ?? [])
    .map((r) => ({
      id: r.id,
      previewUrl: r.media_formats?.tinygif?.url ?? r.media_formats?.gif?.url ?? '',
      url: r.media_formats?.gif?.url ?? r.media_formats?.tinygif?.url ?? '',
    }))
    .filter((r) => r.url && r.previewUrl);
}

export function searchGifs(term: string): Promise<GifResult[]> {
  return tenor('search', { q: term });
}

/** What shows before the user types anything. */
export function trendingGifs(): Promise<GifResult[]> {
  return tenor('featured', {});
}
