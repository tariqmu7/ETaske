"""
ETaske Outlook Bridge
---------------------
Reads emails from the locally installed Outlook app via win32com and exposes
them over a local HTTP API so the ETaske browser app can create tasks from emails.

A small status window (tkinter) shows the bridge is running and lets the user stop it.

Usage:
    python outlook_bridge.py          # run with status window
    python outlook_bridge.py --headless  # run without window (for testing)

Requirements:
    pip install -r requirements.txt   (flask, flask-cors, pywin32 — all pure-Python/binary, no Rust)

Build to .exe (no Python needed on target machine):
    pip install pyinstaller
    pyinstaller --onefile --name "ETaske-OutlookBridge" outlook_bridge.py
"""

import json
import sys
import threading
import tkinter as tk
from tkinter import font as tkfont
from datetime import datetime

import pythoncom
import win32com.client
from flask import Flask, jsonify, request
from flask_cors import CORS

PORT = 5111
# Static token — only ETaske knows this value. Blocks other sites from reading the bridge.
API_TOKEN = "etaske-bridge-2f9a7c"

app = Flask(__name__)
CORS(app, allow_private_network=True)


@app.before_request
def require_token():
    # Allow preflight OPTIONS through (needed for CORS handshake)
    if request.method == "OPTIONS":
        return
    token = request.headers.get("X-Bridge-Token") or request.args.get("token")
    if token != API_TOKEN:
        return jsonify({"error": "unauthorized"}), 401


# ---------------------------------------------------------------------------
# Outlook helpers
# ---------------------------------------------------------------------------

def _get_namespace():
    pythoncom.CoInitialize()
    outlook = win32com.client.dynamic.Dispatch("Outlook.Application")
    return outlook.GetNamespace("MAPI")


def _importance_label(value):
    return {0: "Low", 1: "Normal", 2: "High"}.get(value, "Normal")


def _default_folder_id(name):
    return {"Inbox": 6, "Sent Items": 5, "Drafts": 16, "Deleted Items": 3}.get(name, 6)


def _safe_get(item, attr, default=""):
    try:
        return getattr(item, attr) or default
    except Exception:
        return default


def _email_to_dict(item, folder_name="Inbox"):
    # ReceivedTime — pywintypes.datetime in frozen EXEs needs explicit str conversion
    received_iso = ""
    try:
        rt = item.ReceivedTime
        if rt:
            received_iso = str(rt)[:19].replace(" ", "T")
    except Exception:
        pass

    body_text = _safe_get(item, "Body", "")
    preview = body_text[:300].replace("\r\n", " ").replace("\n", " ").strip()

    # Attachments — must use .Item(i) with 1-based index, NOT brackets
    attachment_names = []
    try:
        count = item.Attachments.Count
        for i in range(1, count + 1):
            try:
                attachment_names.append(item.Attachments.Item(i).FileName)
            except Exception:
                pass
    except Exception:
        pass

    return {
        "id": _safe_get(item, "EntryID"),
        "subject": _safe_get(item, "Subject", "(no subject)"),
        "sender": _safe_get(item, "SenderName"),
        "sender_email": _safe_get(item, "SenderEmailAddress"),
        "received_at": received_iso,
        "body_preview": preview,
        "body": body_text[:3000],
        "is_read": _safe_get(item, "UnRead", True) is False,
        "importance": _importance_label(_safe_get(item, "Importance", 1)),
        "has_attachments": len(attachment_names) > 0,
        "attachment_names": attachment_names,
        "folder": folder_name,
    }


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route("/status")
def status():
    try:
        ns = _get_namespace()
        inbox = ns.GetDefaultFolder(6)
        count = inbox.Items.Count
        return jsonify({"running": True, "outlook_connected": True, "email_count": count, "version": "1.0.0"})
    except Exception as e:
        return jsonify({"running": True, "outlook_connected": False, "email_count": 0, "version": "1.0.0", "error": str(e)})


@app.route("/diagnose")
def diagnose():
    """Returns detailed per-item error info — run this to find out why /emails returns 0."""
    try:
        ns = _get_namespace()
        folder = ns.GetDefaultFolder(6)
        items = folder.Items
        total = items.Count
        results = []
        try:
            items.Sort("[ReceivedTime]", True)
            sort_ok = True
        except Exception as se:
            sort_ok = str(se)

        for i in range(1, min(11, total + 1)):
            row = {"index": i}
            try:
                item = items.Item(i)
                row["item_ok"] = True
                try: row["class"] = item.Class
                except Exception as e: row["class_error"] = str(e)
                try: row["subject"] = str(item.Subject)[:80]
                except Exception as e: row["subject_error"] = str(e)
                try: row["unread"] = item.UnRead
                except Exception as e: row["unread_error"] = str(e)
                try: row["sender"] = item.SenderName
                except Exception as e: row["sender_error"] = str(e)
            except Exception as e:
                row["item_error"] = str(e)
            results.append(row)
        return jsonify({"total": total, "sort_ok": sort_ok, "items": results})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/debug")
def debug():
    try:
        ns = _get_namespace()
        folder = ns.GetDefaultFolder(6)
        items = folder.Items
        items.Sort("[ReceivedTime]", True)
        sample = []
        for i in range(1, min(6, items.Count + 1)):
            try:
                item = items.Item(i)
                sample.append({"index": i, "class": item.Class, "subject": str(item.Subject)[:60]})
            except Exception as e:
                sample.append({"index": i, "error": str(e)})
        return jsonify({"count": items.Count, "sample": sample})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/emails")
def get_emails():
    limit = min(int(request.args.get("limit", 50)), 100)
    folder_name = request.args.get("folder", "Inbox")
    search = (request.args.get("search") or "").lower()

    try:
        ns = _get_namespace()
        folder = ns.GetDefaultFolder(_default_folder_id(folder_name))
        items = folder.Items
        items.Sort("[ReceivedTime]", True)

        emails = []
        total = items.Count
        for i in range(1, total + 1):
            if len(emails) >= limit:
                break
            try:
                item = items.Item(i)
                if item.Class != 43:   # 43 = olMail
                    continue
                e = _email_to_dict(item, folder_name)
                if search and search not in e["subject"].lower() and search not in e["sender"].lower() and search not in e["body_preview"].lower():
                    continue
                emails.append(e)
            except Exception:
                continue

        return jsonify(emails)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/email/<path:entry_id>")
def get_email(entry_id):
    try:
        ns = _get_namespace()
        item = ns.GetItemFromID(entry_id)
        return jsonify(_email_to_dict(item))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ---------------------------------------------------------------------------
# Status window (tkinter)
# ---------------------------------------------------------------------------

def _get_email_count():
    try:
        pythoncom.CoInitialize()
        outlook = win32com.client.dynamic.Dispatch("Outlook.Application")
        ns = outlook.GetNamespace("MAPI")
        return ns.GetDefaultFolder(6).Items.Count
    except Exception:
        return None


def run_status_window():
    root = tk.Tk()
    root.title("ETaske Outlook Bridge")
    root.geometry("380x300")
    root.resizable(False, False)
    root.configure(bg="#1e1e2e")

    # Keep on top so users don't lose it
    root.attributes("-topmost", False)

    # ---- header ----
    header_frame = tk.Frame(root, bg="#6366f1", height=56)
    header_frame.pack(fill="x")
    header_frame.pack_propagate(False)

    title_lbl = tk.Label(
        header_frame, text="ETaske  ·  Outlook Bridge",
        bg="#6366f1", fg="white",
        font=("Segoe UI", 13, "bold"),
        anchor="w", padx=16
    )
    title_lbl.pack(fill="both", expand=True)

    # ---- body ----
    body = tk.Frame(root, bg="#1e1e2e", padx=24, pady=20)
    body.pack(fill="both", expand=True)

    # Status dot + label
    status_row = tk.Frame(body, bg="#1e1e2e")
    status_row.pack(anchor="w", pady=(0, 6))

    dot = tk.Label(status_row, text="●", fg="#22c55e", bg="#1e1e2e", font=("Segoe UI", 14))
    dot.pack(side="left")

    status_lbl = tk.Label(
        status_row, text="  Bridge is running on port 5111",
        bg="#1e1e2e", fg="#e2e8f0",
        font=("Segoe UI", 11)
    )
    status_lbl.pack(side="left")

    # Email count
    count_lbl = tk.Label(
        body, text="Connecting to Outlook…",
        bg="#1e1e2e", fg="#94a3b8",
        font=("Segoe UI", 10)
    )
    count_lbl.pack(anchor="w", pady=(0, 16))

    # Info box
    info_bg = tk.Frame(body, bg="#2d2d3f", padx=12, pady=10)
    info_bg.pack(fill="x", pady=(0, 16))

    info_text = (
        "Keep this window open while using ETaske.\n"
        "The browser tab can read your Outlook emails\n"
        "only while this bridge is running."
    )
    tk.Label(
        info_bg, text=info_text,
        bg="#2d2d3f", fg="#94a3b8",
        font=("Segoe UI", 9),
        justify="left"
    ).pack(anchor="w")

    # Stop button
    def on_stop():
        root.destroy()
        sys.exit(0)

    stop_btn = tk.Button(
        body, text="Stop Bridge",
        command=on_stop,
        bg="#ef4444", fg="white", activebackground="#dc2626", activeforeground="white",
        relief="flat", font=("Segoe UI", 10, "bold"),
        padx=18, pady=8, cursor="hand2", bd=0
    )
    stop_btn.pack(anchor="w")

    # Fetch email count in background and update label
    def fetch_count():
        count = _get_email_count()
        if count is not None:
            count_lbl.config(text=f"Inbox: {count} emails available")
        else:
            count_lbl.config(text="Outlook not reachable — is Outlook open?")
            dot.config(fg="#f97316")
            status_lbl.config(text="  Bridge running — Outlook not connected")

    threading.Thread(target=fetch_count, daemon=True).start()

    root.mainloop()


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    headless = "--headless" in sys.argv

    # Start Flask in a background daemon thread
    flask_thread = threading.Thread(
        target=lambda: app.run(host="127.0.0.1", port=PORT, use_reloader=False),
        daemon=True
    )
    flask_thread.start()

    if headless:
        print(f"\n  ETaske Outlook Bridge running on http://localhost:{PORT}")
        print("  Press Ctrl+C to stop.\n")
        flask_thread.join()
    else:
        run_status_window()
