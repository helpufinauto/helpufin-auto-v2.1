// Shared helpers for normalizing multi-select Make/Body Type filters.
// Empty array means All (no restriction). Never send All to backend.

export function normalizeFilterValues(value) {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return [...new Set(value.map(v => String(v).trim()).filter(Boolean))];
  }
  const s = String(value).trim();
  if (!s || s.toLowerCase() === "all") return [];
  return [...new Set(s.split(",").map(v => v.trim()).filter(Boolean))];
}

export function valuesToUrlParam(value) {
  const arr = normalizeFilterValues(value);
  return arr.length ? arr.join(",") : "";
}

export function parseUrlParam(param) {
  return normalizeFilterValues(param);
}

export function joinDisplay(values, allLabel) {
  const arr = normalizeFilterValues(values);
  return arr.length ? arr.join(", ") : allLabel;
}

export function buildOrQuery(values) {
  return normalizeFilterValues(values);
}
