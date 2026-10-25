const normalize = (value: string) => value.toLowerCase().replace(/[\s/_-]+/g, "");

/** Prefixes first, then city prefixes, substrings and ordered fuzzy matches. */
export function searchTimeZones(zones: string[], input: string): string[] {
  const query = normalize(input.trim());
  if (!query) return [...zones];
  const ranked = zones.map((zone) => {
    const candidate = normalize(zone);
    if (candidate === query) return { zone, score: 0 };
    if (candidate.startsWith(query)) return { zone, score: 1 };
    if (zone.split("/").some((part) => normalize(part).startsWith(query))) return { zone, score: 2 };
    if (candidate.includes(query)) return { zone, score: 3 };
    let cursor = 0, first = -1, last = -1;
    for (const char of query) {
      const index = candidate.indexOf(char, cursor);
      if (index < 0) return { zone, score: Infinity };
      if (first < 0) first = index;
      last = index;
      cursor = index + 1;
    }
    return { zone, score: 4 + (last - first + 1 - query.length) / (candidate.length + 1) };
  }).filter(({ score }) => Number.isFinite(score))
    .sort((a, b) => a.score - b.score || a.zone.localeCompare(b.zone, "en"));
  const direct = ranked.filter(({ score }) => score < 4);
  return (direct.length ? direct : ranked.slice(0, 20)).map(({ zone }) => zone);
}
