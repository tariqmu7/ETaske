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

## API endpoints

| Endpoint | Description |
|---|---|
| `GET /status` | Check if Outlook is connected |
| `GET /emails?limit=50&folder=Inbox&search=query` | List emails |
| `GET /email/{entry_id}` | Get full email by ID |

## Port

The bridge runs on **port 5111**. If that port is taken on a user's machine, change `PORT = 5111` in `outlook_bridge.py` and update `OUTLOOK_BRIDGE_URL` in `src/OutlookFeed.tsx`.
