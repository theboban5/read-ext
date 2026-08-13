/**
 * Interpret a single human-readable choice string.
 *   "★★★★"       -> read, 4 stars
 *   "4"          -> read, 4 stars
 *   "Read later" -> queued
 *   "Read"       -> read, unrated
 *
 * This exists so a client can send one string instead of separate status/rating
 * fields. The iOS Shortcut uses it: a flat "Choose from List" returns the picked
 * line directly, which avoids hand-building five nested menu branches on a phone.
 *
 * Tolerant on purpose -- the list is typed by hand in the Shortcuts app, so a
 * stray space or a renamed line must not cost you the capture.
 */
export function parseChoice(raw) {
  const s = String(raw == null ? '' : raw).trim();

  // Both '★' and '*' count. The iOS keyboard has no star key, so pasted stars
  // often arrive as asterisks -- and typing '*' is easier than hunting the emoji
  // picker anyway. Accepting both means the list works however it got typed.
  const stars = (s.match(/[★*]/g) || []).length;
  if (stars > 0) return { status: 'read', rating: Math.min(5, stars) };

  if (/later|queue|save/i.test(s)) return { status: 'toread', rating: 0 };

  const n = Number.parseInt(s, 10);
  if (Number.isFinite(n) && n >= 1 && n <= 5) return { status: 'read', rating: n };

  // Anything else ("Read", "Done", a typo) counts as read but unrated -- better
  // than dropping the capture on the floor.
  return { status: 'read', rating: 0 };
}
