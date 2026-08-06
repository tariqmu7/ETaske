# ETaske Outlook Bridge

A lightweight local Python server that reads emails from the installed Outlook app and exposes them to the ETaske web app over `http://localhost:5111`.

## How it works

```
Local Outlook (Exchange) → win32com → Python FastAPI (localhost:5111) → ETaske browser tab
```

Emails never leave the user's machine — only when the user clicks "Create Task" does anything get saved to Firestore online.

## Requirements

- Windows PC
- Microsoft Outlook installed and configured (Exchange account already set up)
- Python 3.10+ **or** use the pre-built `.exe`

## Run with Python

```bat
pip install -r requirements.txt
python outlook_bridge.py
```

## Build a standalone .exe (distribute to users — no Python needed)

```bat
build.bat
```

The `.exe` will be in `dist\ETaske-OutlookBridge.exe`. Users just double-click it before opening ETaske.

**After rebuilding, copy the new binary into the web app so users can download it in-app:**

```bat
copy /Y dist\ETaske-OutlookBridge.exe ..\public\downloads\ETaske-OutlookBridge.exe
```

`public/downloads/` is copied verbatim into `dist/` by Vite, so the Outlook Feed page serves it at
`downloads/ETaske-OutlookBridge.exe` on GitHub Pages. That copy is committed — it is the version users get.

### Build gotcha: `win32timezone`

`pywintypes` imports `win32timezone` lazily the first time a COM datetime is read. PyInstaller can't see
that, so without `--hidden-import win32timezone` every `ReceivedTime`/`SentOn` raises `ModuleNotFoundError`
inside the EXE and **all timestamps silently come back empty** (the API still returns 200). It is in both
`ETaske-OutlookBridge.spec` and `build.bat` — don't drop it.

## API endpoints

| Endpoint | Description |
|---|---|
| `GET /status` | Outlook connectivity + `email_count` (inbox) and `sent_count` |
| `GET /emails?limit=50&folder=Inbox&search=query` | List emails. `folder` accepts `Inbox`, `Sent Items`, `Drafts`, `Deleted Items` |
| `GET /email/{entry_id}` | Get full email by ID |
| `GET /diagnose` | Per-item COM error detail — use when `/emails` returns nothing useful |

Every request needs the `X-Bridge-Token` header (or `?token=`).

### Inbox vs Sent

`Sent Items` is sorted by `SentOn` (not `ReceivedTime`, which is empty there) and each email carries
`direction: "sent" | "received"` plus `recipients[]` / `to`. The web UI uses `direction` to show
“To: …” instead of the sender, and falls back to the flat `.To` string when `Recipients` can't be read.

## Port

The bridge runs on **port 5111**. If that port is taken on a user's machine, change `PORT = 5111` in `outlook_bridge.py` and update `OUTLOOK_BRIDGE_URL` in `src/OutlookFeed.tsx`.
