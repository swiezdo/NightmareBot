# waves-bot

Discord DM wizard: build and edit Tsushima waves via `/setup-waves` and `/edit-waves` (same `game` option, DM only). Command **`/waves`** is **public** (no allowlist): **`game`** (Tsushima / Yōtei) and **`lang`** (English / Russian). Use in a **guild channel or DMs**. **Tsushima**: **`GET /api/rotation/tsushima`** + **`NIGHTMARE_CLUB_TSUSHIMA_TOKEN`**; optional **`NIGHTMARE_CLUB_TSUSHIMA_READ_URL`**. **Yōtei**: **`GET /api/rotation/yotei`** + **`NIGHTMARE_CLUB_YOTEI_TOKEN`** (same as `BOT_API_TOKEN_YOTEI` on the site); optional **`NIGHTMARE_CLUB_YOTEI_READ_URL`** or derive from **`NIGHTMARE_CLUB_YOTEI_URL`** (`…/api/rotations/yotei` → `…/api/rotation/yotei`); default read URL `https://nightmare.club/api/rotation/yotei`. Tsushima map/modifier/bonus text uses local **`json/rotation_tsushima_*.json`**. For **`/waves` Yōtei**, local copy mirrors Tsushima: **`json/rotation_yotei_en.json`** and **`json/rotation_yotei_ru.json`**. Each file is an object with **`maps`** (array of **`{ "slug", "name" }`**), **`zones`** (array of **`{ "location", "zone" }`** — `location` must match API `location`, `zone` is the label in that file’s language), and **`challenge_cards`** (array of **`{ "slug", "line" }`**; optional **`emoji`** as Discord custom emoji **`<:name:id>`** (or **`<a:name:id>`** for animated) becomes **`https://cdn.discordapp.com/emojis/{id}.png`** / **`.gif`** and is used as the **Stage 1–4** embed **thumbnail**; optional **`image`** / **`image_url`** = direct thumbnail URL). Entries are merged by **`slug`** / **`location`**. If a string is missing in JSON, the bot falls back to the API (`map` name, `location`, `challenge.description` / `name`). Challenge text for each stage is shown in that stage embed’s **footer** (not in the main message). **`spawn_point`** is not shown in embeds. Credits still come from API `credit_text`.

When the grid is complete and the user presses **Done**, a **modal** asks for **Credits** (optional; UI strings follow the wizard language). If the field is left empty, **`Submitted by NightmareBot`** is sent as `credit_text`. Then the bot sends the JSON body to **Nightmare.Club** (`PUT /api/rotations/tsushima`) with `NIGHTMARE_CLUB_TSUSHIMA_URL` and `NIGHTMARE_CLUB_TSUSHIMA_TOKEN`. **`/edit-waves`** (Tsushima only) loads the current site week via **`GET /api/rotation/tsushima`** with the same token, merges `week_code` + `waves` + `map_slug` + `credit_text` from the API with local **`json/rotation_tsushima_*.json`** (mods/objectives/RU cells), and opens the wizard prefilled — no published draft is stored in SQLite. **`/waves` Yōtei** renders API data as one **content** message (map title + optional credits) plus **four embeds** (Stage 1–4: waves in body, challenge line in **footer**, optional emoji thumbnail); **`/waves` Tsushima** uses local rotation JSON plus wave embeds.

## Requirements

- Node.js 18+
- Discord application token and `CLIENT_ID` (see `.env.example`)
- In the Discord Developer Portal, enable the **Message Content Intent** for the bot (required to read DM text for bulk wave paste via the ✏️ button).

## Setup

```bash
npm install
cp .env.example .env
# fill DISCORD_TOKEN, CLIENT_ID, ALLOWED_USER_IDS (managers + /whitelist-*),
# NIGHTMARE_CLUB_TSUSHIMA_URL, NIGHTMARE_CLUB_TSUSHIMA_TOKEN
npm run deploy-commands   # when slash definitions change
npm start
```

## Data / SQLite

- **Access:** **`ALLOWED_USER_IDS`** in `.env` lists **managers** (comma-separated or JSON array of Discord user IDs): they always may use `/setup-waves`, `/edit-waves`, bulk DM, and **`/whitelist-add`**, **`/whitelist-remove`**, **`/whitelist-show`** (all whitelist replies are ephemeral). Everyone else needs a row in table **`waves_setup_allowlist`** (added by managers). If **`ALLOWED_USER_IDS`** is empty, nobody can run whitelist commands; setup/edit then only works for users already present in that table (e.g. inserted manually). Upgrading from older configs: rename **`SETUP_WAVES_ALLOWED_USER_IDS`** → **`ALLOWED_USER_IDS`** in `.env`.
- **Sessions** are stored in **`data/waves_bot.db`** (SQLite via `better-sqlite3`), not in `sessions.json`.
- On first startup, if **`data/sessions.json`** exists and the DB table is empty, rows are imported and the file is renamed to **`data/sessions.json.migrated`**.
- Legacy table **`waves_tsushima_publish`** is dropped on bot startup if it exists (publishing no longer mirrors to SQLite).
- Do not commit `.db` files or `.env` (see `.gitignore`).

## sqlite-web (database browser UI)

Use [sqlite-web](https://github.com/coleifer/sqlite-web) (Flask + Peewee), same style as Charles Leifer’s SQLite browser, pointed at `data/waves_bot.db`.

1. Create a Python venv next to the app (e.g. `/opt/waves-bot/.venv`) and `pip install sqlite-web`.
2. Copy [`deploy/waves-bot-sqlite-web.service.example`](deploy/waves-bot-sqlite-web.service.example) to systemd, set `User`/`WorkingDirectory`/`paths` to match install.
3. Copy [`deploy/env.sqlite-web.example`](deploy/env.sqlite-web.example) to `.env.sqlite-web`, set a strong **`SQLITE_WEB_PASSWORD`** and optional **`SQLITE_WEB_PORT`** (default `8765`). `chmod 600` the file.
4. Point **nginx** at `http://127.0.0.1:<SQLITE_WEB_PORT>` — see [`deploy/nginx-sqlite-web.example.conf`](deploy/nginx-sqlite-web.example.conf). Enable TLS (e.g. Let’s Encrypt).
5. Bind **sqlite-web to localhost only** (`--host 127.0.0.1`); rely on `--password` plus HTTPS.

The bot process and sqlite-web both open the same SQLite file; avoid heavy writes from the UI while users edit (read-mostly is fine).

## Project layout

| Path | Purpose |
|------|---------|
| `src/index.js` | Discord client |
| `src/handlers/setup-waves.js` | `/setup-waves` and component interactions |
| `src/handlers/whitelist-command.js` | `/whitelist-add`, `/whitelist-remove`, `/whitelist-show` (managers only, ephemeral) |
| `src/utils/setup-access.js` | `ALLOWED_USER_IDS` managers + `isAllowedForSetupCommands` |
| `src/db/setup-allowlist.js` | SQLite `waves_setup_allowlist` CRUD |
| `src/handlers/bulk-waves-message.js` | DM `messageCreate` for bulk text wave import |
| `src/wizard/bulk-waves-text.js` | Bulk paste instructions, parser, spawn catalog |
| `src/db/bulk-session.js` | Resolve which session waits for bulk DM input |
| `src/db/database.js` | SQLite init + legacy JSON migration |
| `src/db/session.js` | Session load/save/delete |
| `src/api/nightmare-tsushima.js` | `PUT` payload, `GET` Tsushima, draft build for `/edit-waves` and `/waves` |
| `src/api/nightmare-yotei.js` | `GET` Yōtei rotation for `/waves` |
| `src/utils/wave-embed-lines.js` | Общая разметка волн (отступы, разделитель) для Tsushima и Yōtei |
| `src/utils/tsushima-waves-format.js` | Tsushima API + local JSON → сообщение + эмбеды волн |
| `src/data/yotei-labels.js` | Load `rotation_yotei_en.json` + `rotation_yotei_ru.json`, resolve labels |
| `src/utils/yotei-waves-format.js` | Yōtei API → контент (карта) + 4 эмбеда (волны + футер карточки) |
| `src/handlers/waves-command.js` | Slash `/waves` (guild or DM, no allowlist) |
| `json/rotation_tsushima_*.json` | Rotation source data (week codes, RU cells, objectives) |
| `json/rotation_yotei_en.json`, `json/rotation_yotei_ru.json` | Yōtei catalog: maps, zones, challenge lines + optional `emoji` (thumbnail CDN) |
