/**
 * Draw Steel – Hideout
 * Language extraction helper: finds a Draw Steel language name in a source text.
 */

/**
 * Try to find a matching Draw Steel language in a source text string.
 * Matches against ds.CONFIG.languages label values (case-insensitive).
 * Tries longest labels first to avoid partial matches.
 * Falls back to extracting the capitalised word immediately after "in" at the
 * end of the string (e.g. "Texts or lore in Caelian" → "Caelian").
 *
 * @param {string|null|undefined} sourceText  e.g. "Texts or lore in Caelian"
 * @returns {string|null}  The matched language label, or null if no match found.
 */
export function extractLanguageFromSource(sourceText) {
  if (!sourceText) return null;

  const languages = ds.CONFIG?.languages ?? {};
  const lower = sourceText.toLowerCase();

  // Sort by label length descending so longer names are preferred over partial matches
  const entries = Object.values(languages)
    .filter(lang => lang.label)
    .sort((a, b) => b.label.length - a.label.length);

  for (const lang of entries) {
    if (lower.includes(lang.label.toLowerCase())) return lang.label;
  }

  // Fallback: extract the capitalised word after "in " near the end of the string
  const match = sourceText.match(/\bin\s+([A-Z][a-zA-Z\u00C0-\u024F]+)\s*[.,]?\s*$/i);
  if (match) return match[1];

  return null;
}
