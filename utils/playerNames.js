function normalizePlayerName(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/^@/, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function uniqueNames(values) {
  const seen = new Set();
  const result = [];

  for (const raw of values) {
    const value = String(raw || '').trim();
    const normalized = normalizePlayerName(value);
    if (!value || !normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push({ value, normalized });
  }

  return result;
}

module.exports = {
  normalizePlayerName,
  escapeRegExp,
  uniqueNames,
};
