# Firestore rules hardening — review notes

Scope: full server-side enforcement of the real trust boundary. The previous
rules let **any authenticated account** (including Pending/Rejected users) read,
write, and delete every business record; the entire role model was cosmetic.

`firestore.rules` validated clean (`firebase validate`). **Not deployed yet** —
deploying to the live named production database is the one-way step; see below.

## What changed

| Area | Before | After |
|---|---|---|
| tasks / correspondences / milestones | `read, write: if request.auth != null` | read requires **Approved**; create/update scoped to manager-admin **or** owner/assignee/author; delete = manager-admin only |
| notifications | world-readable to all signed-in users | read only by the recipient (or admin); update limited to flipping `read`; no client deletes |
| `--stats--` counter | inherited the open write rule (resettable) | **increment-only** (`value == prev + 1`), single-field, never deletable |
| users — create | any field values | self-signup forced to `Pending`/`Employee` (admin email may bootstrap Admin) |
| users — update | self could rewrite own `role`/`status` | self-update cannot change own `role`/`status`; only admin can approve/promote |

The two `users` fixes were not in the original four findings but are the same
class of bug — without them a Pending user just calls
`updateDoc(users/me, {status:'Approved', role:'Admin'})` and every other rule
above is bypassed.

## Findings status

1. Open CRUD on business data — **closed** (Approved gate + role/ownership writes).
2. Notifications world-readable — **closed** (recipient-only read).
3. Counter tamperable — **closed** (increment-only, non-deletable).
4. Pending/Rejected retain access — **closed** (server-side `status == 'Approved'`).

## Client impact: none

Verified every Firestore call site. No client code or query changes are
required, and no data migration:

- All read listeners (unfiltered, team-filtered, and `forUserId`-filtered) pass
  under an Approved-only read rule.
- Task creates set `assignedById == uid`; correspondence creates set
  `userId == uid`; milestone creates set `addedById == uid` — all satisfied.
- `counters.ts` writes exactly `{value: prev+1}` in a transaction — matches the
  increment-only rule.
- Sidebar notification "mark read" writes only `{read: true}` — matches the
  `hasOnly(['read'])` update rule.

> Superseded for chat by the announcements/presence change — see the section
> at the bottom of this file.

Pending/Rejected accounts now get `permission-denied` on dashboard listeners.
That is the intended effect; those users are already UI-gated to the
Pending/Rejected screens, and existing `onSnapshot` error handlers swallow it.

## Residual risk (intentional, documented)

- **No read isolation between approved members.** This is a shared org board;
  the client deliberately uses whole-collection / team-wide listeners (e.g.
  `App.tsx` due-soon, the milestones listeners) and milestones carry no
  `teamId`. Per-record read scoping would reject those queries wholesale and
  break the app for every employee. Any approved member can still read all
  tasks/correspondences/milestones. Tightening this requires rewriting ~10
  listeners to be user/team-scoped + denormalizing `teamId` onto milestones +
  a backfill — a separate, larger piece of work. Flagged here as opt-in.
- **User directory is readable to any signed-in account** (kept as-is: the
  assignment UI and the pre-approval Pending screen need it). Profile metadata
  (name, email, role, department) is visible to authenticated users.
- **Cost:** each tasks/correspondences/milestones/notifications request does one
  cached `get()` of the caller's user doc (one extra read per request; the admin
  path short-circuits on the email token claim with no get()).
- Legacy `--stats--` docs with extra fields would fail `hasOnly(['value'])` and
  fall back to `counters.ts`'s random-number path (no crash). The live docs only
  ever hold `{value}`, so this is theoretical.

## Deploy (not done — your call)

Rules deploy is separate from the app and targets the **named** database
(`.firebaserc` / `firebase.json`), not `(default)`:

```bash
firebase deploy --only firestore:rules
```

Recommended before deploy: sign in as a non-admin Approved user and as a
Pending user in two browsers and confirm the Approved user works normally while
the Pending user is denied.

## Rollback

`git checkout HEAD -- firestore.rules` then re-run the deploy command to restore
the previous open ruleset.

## Update — announcements + chat presence

Added with the department-announcements and chat-receipt features. **Requires a
fresh `firebase deploy --only firestore:rules` to the named DB** — until then
the live rules reject announcement writes and the chat seen-receipt write.

- **New `announcements` collection.** Read = any Approved member (no per-record
  isolation — same shared-org trust boundary as tasks/correspondences above;
  department scoping is applied client-side, not in rules, by design). Create =
  Approved and `authorId == uid`. Update = manager/admin, the author, **or** a
  non-author whose diff touches only `readBy` (the mark-as-seen
  `arrayUnion(uid)` path — same shape as the notifications `read` rule). Delete
  = manager/admin or the author. Same residual openness as the rest of the
  board: every Approved user can read every department's announcements; the
  feed is filtered client-side.
- **Messages update rule widened** from `hasOnly(['read'])` to
  `hasOnly(['read', 'readAt'])` so the receiver can stamp a seen-time for the
  "Seen HH:MM" receipt. Still receiver-only, still no other field writable, no
  deletes. This supersedes the "mark read writes only `{read:true}`" note in
  *Client impact* above — the receiver write is now `{read:true, readAt:ts}`.
- **Presence:** the heartbeat is a self-update of `users/{me}.lastSeen` only;
  it already satisfies the existing `users` update rule (role/status unchanged),
  so no rule change was needed for it. Cost: one `users` write per active tab
  per minute, fanned out to every open client via the existing users listener —
  acceptable for a small org, standard presence trade-off.
