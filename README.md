# waves-bot

Discord DM wizard: build and edit Tsushima waves via `/setup-waves` and `/edit-waves` (same `game` option, DM only). The published draft is stored in **SQLite** (`waves_tsushima_publish`), not in `waves/tsushima.json`.

## Requirements

- Node.js 18+
- Discord application token and `CLIENT_ID` (see `.env.example`)

## Setup

```bash
npm install
cp .env.example .env
# fill DISCORD_TOKEN, CLIENT_ID, SETUP_WAVES_ALLOWED_USER_IDS
npm run deploy-commands   # when slash definitions change
npm start
```

## Data / SQLite

- **Sessions** are stored in **`data/waves_bot.db`** (SQLite via `better-sqlite3`), not in `sessions.json`.
- On first startup, if **`data/sessions.json`** exists and the DB table is empty, rows are imported and the file is renamed to **`data/sessions.json.migrated`**.
- If **`waves/tsushima.json`** exists and there is no published row for Tsushima yet, it is imported into **`waves_tsushima_publish`** and the file is renamed to **`waves/tsushima.json.migrated`**.
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
| `src/db/database.js` | SQLite init + legacy JSON migration |
| `src/db/session.js` | Session load/save/delete |
| `src/db/tsushima-publish.js` | Published Tsushima draft (`waves_tsushima_publish`) |
| `json/rotation_tsushima_*.json` | Rotation source data |
| `waves/tsushima.json` | Legacy only: imported once into DB then renamed to `.migrated` |
