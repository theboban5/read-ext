# Blog Tracker sync

A Cloudflare Worker + D1 database that lets you capture and rate reading on your
iPhone and see it in the laptop extension's stats — one unified history.

**This deployment**

| | |
|---|---|
| Production | `https://blog-sync.read-ext.workers.dev` |
| Staging | `https://blog-sync-staging.read-ext.workers.dev` |
| Token | `worker/.sync-token` (gitignored) — also in the extension options, the Shortcut, and the phone page's localStorage |
| Shortcut | `worker/.shortcut-link` (gitignored — see below) |

Three clients talk to it:

| Client | What it does |
|---|---|
| Chrome extension | Full local cache of the database; stats work offline |
| iOS Shortcut | Share sheet → Read / Read later → tap stars → done |
| `/` (this worker) | Phone web page: browse the queue, batch-rate, add links by hand |

---

## Why an iOS Shortcut and not an extension

Safari web extensions must be packaged inside an app built with Xcode and shipped
through the App Store, which needs a paid Apple Developer account. iOS also has no
Web Share Target API, so a home-screen web app cannot receive shares either.

A Shortcut with **Show in Share Sheet** turned on appears in the same share sheet
as everything else, runs inline without launching an app, and costs nothing.

---

## Setup

### 1. Create the databases

```bash
cd worker
npm install
npx wrangler login

npx wrangler d1 create blog-sync
npx wrangler d1 create blog-sync-staging
```

Paste each `database_id` into the matching block in `wrangler.toml`.

### 2. Apply the schema

```bash
npx wrangler d1 migrations apply blog-sync-staging --remote
npx wrangler d1 migrations apply blog-sync --remote
```

### 3. Make a token

```bash
openssl rand -base64 32 | tr '+/' '-_' | tr -d '='
```

Save it in your password manager now — **it goes in three places** (extension
options, the Shortcut, the phone web page), so rotating it means touching all three.

```bash
npx wrangler secret put SYNC_TOKEN --env staging
npx wrangler secret put SYNC_TOKEN
```

Optionally also set `CAPTURE_TOKEN`. If present it is accepted **only** by
`/api/capture`, so the Shortcut on your phone can hold a capture-only credential
instead of one that can read your whole history.

### 4. Deploy

```bash
npm test                       # url normalization must agree across both copies
npx wrangler deploy --env staging
npx wrangler deploy
```

Your worker is at `https://blog-sync.<your-subdomain>.workers.dev`.

> `*.workers.dev` is blocked on some corporate and school networks. If that bites,
> attach a custom domain through a Cloudflare-hosted zone — also free.

### 5. Connect the extension

Extension options (the **Sync** link in the popup footer):

1. Paste the worker URL and token → **Test connection**. This also asks Chrome for
   permission to reach that host.
2. **Preview** — shows how your existing entries map, including any URLs that
   normalize together and would merge. **Read this before migrating**; it is the
   one decision that is expensive to reverse.
3. **Connect & migrate** — downloads a pre-sync backup first, uploads everything,
   pulls the merged result back, and only deletes the old local keys once the
   counts check out.

Do this against staging first: point the extension at the staging URL, migrate,
compare the stats page against the numbers you wrote down, then repeat against
production.

### 6. The phone

Open `https://blog-sync.<your-subdomain>.workers.dev` in Safari, enter the token
once, then **Share → Add to Home Screen**. Then build the Shortcut below.

---
## The iOS Shortcut

> **Never commit the iCloud link.** The shortcut carries your token in its
> `Authorization` header, so anyone who opens the link installs a working copy of
> your credential. Keep it in `worker/.shortcut-link`, which is gitignored.

Shortcuts are unversioned and one bad edit loses the whole thing, so keep a link
backup: **⋯ → Share → Copy iCloud Link**, saved to `worker/.shortcut-link`. Restoring
is install-from-link, then re-check the token in the header.

Everything below is for rebuilding it from scratch.

### The design, and why

Six flat actions, no branches. The obvious build -- a `Choose from Menu` with a
nested five-item rating menu -- needs ~15 actions placed *inside* branches, which is
miserable on a touchscreen and easy to get subtly wrong.

Instead, `Choose from List` returns the picked line as a plain value, and the server
interprets it (`src/choice.js`). The phone does no branching and no string work.

Two server affordances exist purely to keep this shortcut simple:

- **`choice`** -- one human string instead of separate `status` + `rating` fields.
  Accepts `★★★`, `***`, `3`, `Read later`. Both star characters work because the iOS
  keyboard has no `★` key and pasted stars often arrive as asterisks.
- **`format: "text"`** -- the reply is the bare sentence instead of JSON. Shortcuts
  has no easy way to pluck one key out of a JSON response; doing it on-device needs
  an extra action dragged into the middle of the list. The server just answers in the
  shape the notification wants.

### Settings

Tap the shortcut name → **Details** (Apple moves this around between iOS releases;
it may also be under an ⓘ in the editor's bottom bar):

- **Show in Share Sheet** → **ON**

Then close Details. With that on, a **Receive** bar appears at the top of the action
list -- that is where the rest lives on current iOS:

- **Receive** → *Safari Web Pages* + *URLs* from **Share Sheet**
- **If there's no input** → **Ask For** → **Text**
  (There is no URL option; Text is right, because `Get URLs from Input` extracts the
  link from whatever you type. This is the manual-entry path when you run it from the
  Home Screen.)

There is no **Show When Run** toggle on recent iOS, and it does not matter here:
`Choose from List` has to show UI anyway.

### Actions

| # | Action | Settings |
|---|---|---|
| 1 | **Get URLs from Input** | Input: *Shortcut Input* |
| 2 | **Text** | six lines: `*****` / `****` / `***` / `**` / `*` / `Read Later` |
| 3 | **Split Text** | Input: *Text*, Separator: **New Lines** |
| 4 | **Choose from List** | Input: *Split Text*, Prompt: `Track this` |
| 5 | **Get Contents of URL** | see below |
| 6 | **Show Notification** | Body: *Contents of URL* |

**Action 5 — Get Contents of URL**

- URL: `https://blog-sync.<your-subdomain>.workers.dev/api/capture`
- **Method:** `POST`
- **Headers:** `Authorization` = `Bearer <SYNC_TOKEN>` (the word Bearer, a space, then
  the token)
- **Request Body:** **JSON** -- not Text, not File
- Fields:

| Key | Value |
|---|---|
| `url` | the **URLs** variable (a colored pill) |
| `choice` | the **Selected Item** variable (a colored pill) |
| `format` | `text` (plain typed text) |

### The two mistakes that cost the most time

**A variable is a colored pill, not typed words.** Typing "the URLs variable" into the
value field sends that literal string. Clear the field, then tap the variable chip
from the bar above the keyboard. If the server replies quoting your words back at you,
a field is still plain text.

**Each body row is `Key | Value`, left to right.** Putting the variable pill in the
left cell names the field after the variable and leaves it empty.

### Pin it to the share sheet

Share anything from Safari → scroll the bottom action row right → **Edit Actions…** →
find **Track Read** → **+** → drag to the top → **Done**.

Also worth doing: **Add to Home Screen** (manual-entry fallback), and
**Settings → Action Button → Shortcut → Track Read** on iPhone 15 Pro and later.

### Why it doesn't send the title

`Get Details of Safari Web Page → Name` only works when the share started in Safari --
shares from Twitter, Reddit or Mail carry a bare URL with no title. And Shortcuts has
no JSON-escape action, so a title containing a `"` would corrupt the request body.

Instead the worker responds immediately and fetches the title afterwards
(`src/title.js`), so the share sheet stays instant and every source app behaves the
same. Paywalled and JS-rendered pages fall back to a de-slugified URL path; fix any of
those in the **Recent** tab of the phone page.

---

## How conflicts resolve

Two devices disagree in predictable ways, so a few rules are fixed server-side in
`src/apply.js` — clients never merge, they write what the server hands back.

- **A re-read is a new event.** `entries` holds articles; `reads` holds one row per
  time you read one. Reading something in 2025 and again in 2026 lights up both
  heatmap cells.
- **Rating lives on the read event**, not the article. This is why a bare share-sheet
  capture can never wipe a rating you gave on the laptop.
- **Same article within 24h** updates the existing read rather than inserting one, so
  a double-tap in the share sheet doesn't invent a re-read.
- **`read` beats `toread`.** Queued on the laptop, read on the phone resolves to read
  regardless of which write arrives first.
- **Empty never overwrites non-empty.** The phone rarely knows the author; it must
  not blank out what you typed.
- **URLs are normalized** (`src/urlkey.js`) so `?utm_source=…` variants are the same
  article. Those rules are duplicated in `background/urlkey.js` and a test asserts
  the two files stay identical — changing them after migrating re-keys the database.

---

## Endpoints

All `/api/*` need `Authorization: Bearer <SYNC_TOKEN>`.

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | counts + cursor; used by the options page's Test button |
| `POST /api/capture` | the Shortcut endpoint; returns a preformatted `message` |
| | accepts `choice` (`"★★★"` / `"***"` / `"3"` / `"Read later"`) instead of `status`+`rating` |
| | accepts `format: "text"` to reply with the bare message instead of JSON |
| `GET /api/pull?since=<seq>` | delta sync for the extension; includes tombstones |
| `POST /api/push` | batch upsert; echoes the merged rows |
| `POST /api/rate` | batch rating from the phone page |
| `POST /api/delete` | soft delete |
| `GET /api/list?status=` | convenience read for the phone page |
| `GET /` | the phone web page |

`seq` is the sync cursor, not a timestamp: a batch write stamps many rows with the
same millisecond, which would make a timestamp cursor either skip rows or resend
the boundary forever.

---

## Tests

```bash
npm test                  # url normalization; both copies must agree
npx wrangler dev          # then, in another terminal:
./test/smoke.sh           # 30 endpoint checks incl. re-reads and merge rules
node test/integration.mjs # drives the real extension store.js/sync.js under a fake chrome.*
```

`integration.mjs` covers the parts that are expensive to get wrong: migration and
its collision handling, re-reads landing on separate heatmap days, offline writes
queueing and draining, and a phone capture failing to clobber laptop data.

Both scripts mutate whatever database they point at — use local dev or staging.

---

## Backups

The extension still downloads a JSON backup every 100 articles and monthly. For a
server-side dump:

```bash
npx wrangler d1 export blog-sync --remote --output backup.sql
```

---

## If something looks wrong

- **Red `!` badge on the extension icon** — sync is failing. Open the options page;
  the reason is under Status. A rejected token stops retrying until you fix it.
- **Local data looks wrong** — options → Danger zone → *Reset local cache and
  re-pull*. The server is the source of truth; this rebuilds the cache from it.
- **Duplicates across devices** — two URLs that should normalize together don't. Add
  the offending query param to `STRIP_PARAMS` in `src/urlkey.js`, copy the file over
  `background/urlkey.js`, bump `URLKEY_VERSION`, and migrate — it re-keys rows, so
  it is a deliberate operation, not a config tweak.
