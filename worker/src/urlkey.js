// URL normalization: the identity function for an article.
//
// This is MIRRORED at background/urlkey.js. The two copies must stay byte-for-byte
// identical in behavior -- test/urlkey.test.mjs imports both and asserts they agree.
//
// Changing these rules after a migration RE-KEYS THE ENTIRE DATABASE. Bump
// URLKEY_VERSION and write a migration if you ever need to. Prefer conservative
// rules: a missed duplicate is annoying, a wrongly-merged pair loses data.

export const URLKEY_VERSION = 1;

// Params that never identify content. Anything matching /^utm_/ is also stripped.
const STRIP_PARAMS = new Set([
  'utm_id',
  'fbclid', 'gclid', 'dclid', 'gbraid', 'wbraid', 'msclkid', 'twclid', 'yclid',
  'igshid', 'igsh', 'mc_cid', 'mc_eid', '_hsenc', '_hsmi', 'vero_id', 'vero_conv',
  'ref_src', 'ref_url', '__twitter_impression', 's', 'si', 'share_id', 'spm',
  'source', 'trk', 'trkCampaign', 'sh', 'at_medium', 'at_campaign',
]);

// Deliberately NOT stripped: `ref` (Substack uses it in real routes), `id`, `p`,
// `page`, `v` (YouTube), `story`, `article`. Deliberately NOT doing: AMP unwrapping,
// m./mobile. host rewriting, path-case folding.

/**
 * Fragments are usually in-page anchors and should be dropped -- but on hash-routed
 * apps the fragment IS the identity. Gmail is the case that matters here:
 * mail.google.com/mail/u/1/#inbox/<id> differs from the next message only after the
 * '#', so stripping it collapses every newsletter into one row.
 *
 * Heuristic: a fragment containing '/' is a route, keep it. Anchors are single
 * tokens (#intro, #section-2, #fn3). Chrome text fragments (#:~:text=) can contain
 * '/' but are never identity, so they go regardless.
 */
function stripFragment(hash) {
  if (!hash || hash === '#') return '';
  const body = hash.slice(1);
  if (body.startsWith(':~:')) return '';
  return body.includes('/') ? hash : '';
}

/**
 * @param {string} input
 * @returns {string|null} normalized key, or null if not a usable http(s) URL
 */
export function urlKey(input) {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  let u;
  try {
    u = new URL(trimmed);
  } catch {
    return null;
  }

  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (!u.hostname) return null;

  u.protocol = 'https:';
  u.hash = stripFragment(u.hash);
  u.username = '';
  u.password = '';
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
  // Default ports are already dropped by the URL parser once protocol is https,
  // but an explicit :443 survives the protocol swap on some engines.
  if (u.port === '443') u.port = '';

  const keep = [];
  for (const [k, v] of u.searchParams.entries()) {
    const lower = k.toLowerCase();
    if (lower.startsWith('utm_')) continue;
    if (STRIP_PARAMS.has(lower)) continue;
    keep.push([k, v]);
  }
  keep.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  u.search = keep.length
    ? '?' + keep.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
    : '';

  // Normalize the trailing slash on the PATH itself, not on the finished string --
  // with a fragment kept, the string no longer ends where the path does.
  if (u.pathname !== '/' && u.pathname.endsWith('/')) {
    u.pathname = u.pathname.replace(/\/+$/, '');
  }

  let s = u.toString();
  // A bare root with nothing after it loses its slash ("https://x.com/" -> "https://x.com").
  if (u.pathname === '/' && !u.search && !u.hash) s = s.replace(/\/$/, '');

  return s;
}

/**
 * Display hostname for an entry, matching what popup.js has always stored:
 * hostname minus a leading "www.".
 * @param {string} input
 * @returns {string}
 */
export function hostOf(input) {
  try {
    return new URL(String(input).trim()).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}
