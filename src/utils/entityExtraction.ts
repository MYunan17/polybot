const COUNTRY_NAMES = [
  "United States",
  "China",
  "Russia",
  "Ukraine",
  "Israel",
  "Iran",
  "India",
  "Pakistan",
  "Taiwan",
  "Japan",
  "South Korea",
  "North Korea",
  "United Kingdom",
  "France",
  "Germany",
  "Canada",
  "Mexico",
  "Brazil",
  "Australia",
  "Indonesia"
];

const STOP_WORDS = new Set([
  "will",
  "before",
  "after",
  "with",
  "from",
  "that",
  "this",
  "have",
  "has",
  "what",
  "when",
  "where",
  "which",
  "market",
  "resolve"
]);

export function extractKeyEntities(text: string, max = 8): string[] {
  if (!text) return [];
  const entities: string[] = [];

  const quoted = text.match(/"([^"]+)"|'([^']+)'/g) ?? [];
  for (const q of quoted) {
    entities.push(q.replace(/^["']|["']$/g, "").trim());
  }

  const caps = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b/g) ?? [];
  entities.push(...caps);

  for (const country of COUNTRY_NAMES) {
    if (text.toLowerCase().includes(country.toLowerCase())) entities.push(country);
  }

  const keywords = text
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 4 && !STOP_WORDS.has(w.toLowerCase()));
  entities.push(...keywords.slice(0, 10));

  const deduped = Array.from(new Set(entities.map((e) => e.trim()).filter(Boolean)));
  return deduped.slice(0, max);
}
