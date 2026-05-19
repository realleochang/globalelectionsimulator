// Module-level cache so photos survive re-renders and aren't fetched twice.
const cache   = new Map<string, string | null>();
const pending = new Map<string, Promise<string | null>>();

export function fetchWikiPhoto(articleTitle: string): Promise<string | null> {
  if (cache.has(articleTitle)) return Promise.resolve(cache.get(articleTitle) ?? null);
  if (pending.has(articleTitle)) return pending.get(articleTitle)!;

  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(articleTitle)}`;
  const p = fetch(url)
    .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then((data: { thumbnail?: { source: string } }) => {
      const imgUrl = data?.thumbnail?.source ?? null;
      cache.set(articleTitle, imgUrl);
      pending.delete(articleTitle);
      return imgUrl;
    })
    .catch(() => {
      cache.set(articleTitle, null);
      pending.delete(articleTitle);
      return null;
    });

  pending.set(articleTitle, p);
  return p;
}
