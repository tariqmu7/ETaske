#!/usr/bin/env python
# Extracts the Agiba/Meleiha tracker workbook into scripts/agiba-seed.json,
# shaped for the ETaske `projects` feature (see scripts/seed-agiba.ts).
# Usage:  PYTHONIOENCODING=utf-8 python scripts/extract-agiba.py
import json
import os
import datetime
import openpyxl

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
XLSM = os.path.join(ROOT, "Excel", "Agiba Tracker - email.xlsm")
OUT = os.path.join(HERE, "agiba-seed.json")

PROJECT_ID = "agiba-meleiha"


def s(v):
    """Cell -> clean string ('' for blanks)."""
    if v is None:
        return ""
    if isinstance(v, datetime.datetime):
        return v.date().isoformat()
    if isinstance(v, datetime.date):
        return v.isoformat()
    return str(v).strip()


def sid(v):
    """Sanitize a value into a doc-id-safe slug."""
    out = "".join(c if c.isalnum() else "-" for c in s(v))
    while "--" in out:
        out = out.replace("--", "-")
    return out.strip("-").lower()


def rows(ws, start):
    for i, row in enumerate(ws.iter_rows(values_only=True), 1):
        if i < start:
            continue
        yield i, list(row)


def main():
    wb = openpyxl.load_workbook(XLSM, data_only=True, read_only=True)

    projects = [{
        "id": PROJECT_ID,
        "serialNumber": "PR000001",
        "name": "Meleiha Gas Plant O&M Contract",
        "code": "4600002981",
        "client": "AGIBA",
        "operator": "EPROM",
        "description": "MGP Project — contracts, service orders and subcontractors tracker (imported from the Agiba tracker workbook).",
        "location": "Meleiha, Western Desert",
        "status": "Active",
        "issueDate": "2025-09-24",
        "rev": "0",
        "currentStatus": "Active",
        "lastUpdateText": "Imported from Agiba tracker workbook (Rev. 0).",
    }]

    contracts = []
    financials = []

    ws = wb["AGIBA Contracts"]
    last_contract_id = None
    for i, r in rows(ws, 6):
        r += [""] * (24 - len(r))
        num, ab, dep = s(r[1]), s(r[2]), s(r[3])
        company, subject = s(r[7]), s(r[6])
        if not (num or company or subject):
            continue

        if num:
            cid = "c-" + (sid(num) or str(i))
            last_contract_id = cid
            parent = None
            ctype = "contract"
        else:
            # continuation row (e.g. A/B split) -> sub-contract under the prior contract
            cid = (last_contract_id or "c") + "-" + (sid(ab) or str(i))
            parent = last_contract_id
            ctype = "sub_contract"

        contracts.append({
            "id": cid, "projectId": PROJECT_ID, "parentId": parent, "type": ctype,
            "contractNumber": num, "subject": subject, "companyName": company,
            "department": dep, "srDate": s(r[4]), "srValue": s(r[5]),
            "contractValue": s(r[8]), "currency": "EGP", "loaDate": s(r[9]),
            "startDate": s(r[10]), "endDate": s(r[11]), "status": s(r[12]) or s(r[22]),
            "logStatus": s(r[13]), "contractingMethod": s(r[17]),
            "remarks": s(r[19]), "inCharge": s(r[23]),
        })

        # Amendment columns present -> child amendment item
        if s(r[14]) or s(r[15]) or s(r[16]) or s(r[18]):
            contracts.append({
                "id": cid + "-am", "projectId": PROJECT_ID, "parentId": cid, "type": "amendment",
                "amendmentNumber": s(r[14]), "startDate": s(r[15]), "endDate": s(r[16]),
                "contractingMethod": s(r[17]), "valueAfterIncrease": s(r[18]),
                "remarks": s(r[19]), "companyName": company, "currency": "EGP",
            })

        if s(r[8]):
            financials.append({
                "id": "f-" + cid, "projectId": PROJECT_ID, "type": "budget",
                "title": (subject[:80] or company or num) or "Contract",
                "amount": s(r[8]), "currency": "EGP", "date": s(r[10]),
                "relatedContractId": cid, "status": s(r[12]),
                "notes": ("Contract " + num) if num else "",
            })

    subcontracts = []
    ws = wb["AGIBA SOs"]
    for i, r in rows(ws, 6):
        r += [""] * (14 - len(r))
        so, item, supplier = s(r[1]), s(r[2]), s(r[3])
        if not (so or supplier) or supplier in ("0", "") and so in ("0", ""):
            continue
        if supplier in ("", "0") and so in ("", "0"):
            continue
        subcontracts.append({
            "id": "s-" + (sid(so) or str(i)), "projectId": PROJECT_ID,
            "name": supplier or so, "typeOfService": item, "soOrContract": so,
            "price": s(r[4]), "currency": "EGP", "startDate": s(r[6]),
            "expiryDate": s(r[7]), "status": s(r[8]),
            "currentStatus": s(r[11]) or s(r[8]), "remarks": s(r[11]),
        })

    updates = [{
        "id": "u-import", "projectId": PROJECT_ID, "status": "Active",
        "text": "Initial import from the Agiba tracker workbook: %d contract items, %d subcontracts, %d financial records."
                % (len(contracts), len(subcontracts), len(financials)),
        "authorId": "system", "authorName": "Importer",
    }]

    data = {
        "projects": projects,
        "projectContracts": contracts,
        "projectSubcontracts": subcontracts,
        "projectFinancials": financials,
        "projectUpdates": updates,
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print("Wrote %s" % OUT)
    for k, v in data.items():
        print("  %-22s %d docs" % (k, len(v)))


if __name__ == "__main__":
    main()
