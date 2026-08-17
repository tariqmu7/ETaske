// ─── Cross-record links: task / correspondence → opportunity + project ───────
//
// ONE place that (a) writes the link fields (`RecordLinks` in src/types.ts) onto
// a task or a correspondence and (b) mirrors a history entry into the linked
// record's own history collection — `opportunityFollowUps` for an opportunity,
// `projectUpdates` for a project. Everything that links records (create-a-task-
// from-a-bid, the task form's link picker, the email → opportunity picker, the
// ManagerInbox conversion) goes through here, so the history wording and the
// denormalized labels are written the same way everywhere.
//
// Rules constraints this file is written against (firestore.rules):
//   • opportunityFollowUps.create requires `authorId == request.auth.uid`
//     → every mirror carries the ACTOR's uid, never the record owner's.
//   • projectUpdates is open to any Approved user.
//   • opportunities/projects update is open to any Approved user.
// So task 2 needs NO rules change.
//
// Stored text is ENGLISH on purpose (the module's standing rule: what is written
// is language-independent, translation is a render-time projection).

import {
  collection, doc, addDoc, updateDoc, serverTimestamp, deleteField,
} from 'firebase/firestore';
import { db } from './firebase';
import { AppUser, Opportunity, Project, RecordLinks } from '../types';
import { getUserColor } from '../utils';

export type LinkedRecordKind = 'task' | 'correspondence';

const COLLECTION: Record<LinkedRecordKind, string> = {
  task: 'tasks',
  correspondence: 'correspondences',
};

/** The record being linked FROM, as far as the history entry is concerned. */
export interface LinkSource {
  kind: LinkedRecordKind;
  id: string;
  title: string;            // task name / correspondence subject
  serialNumber?: string;    // TK000123 / CR000045
  status?: string;
  assignedTo?: string;      // display name of the owner, when known
  dueDate?: string;
}

/** Who is performing the write. `uid` must be the signed-in user (rules). */
export interface LinkActor {
  uid: string;
  displayName?: string;
  color?: string;
}

export const actorFrom = (uid: string, appUser?: AppUser | null): LinkActor => ({
  uid,
  displayName: appUser?.displayName || 'Unknown',
  color: appUser?.userColor || getUserColor(appUser?.displayName || uid),
});

// ─── Building the link fields ────────────────────────────────────────────────

type OpportunityRef = Pick<Opportunity, 'id' | 'title'> & { serialNumber?: string };
type ProjectRef = Pick<Project, 'id' | 'name'>;

/**
 * Build the `RecordLinks` block from the picked records. Keys are OMITTED when
 * nothing is picked — Firestore rejects `undefined` values, and an omitted key
 * on a create means "no link" just as well as an absent one.
 */
export function buildRecordLinks(
  opportunity?: OpportunityRef | null,
  project?: ProjectRef | null,
): RecordLinks {
  const links: RecordLinks = {};
  if (opportunity?.id) {
    links.opportunityId = opportunity.id;
    if (opportunity.serialNumber) links.opportunitySerial = opportunity.serialNumber;
    if (opportunity.title) links.opportunityTitle = opportunity.title;
  }
  if (project?.id) {
    links.projectId = project.id;
    if (project.name) links.projectName = project.name;
  }
  return links;
}

const OPPORTUNITY_KEYS = ['opportunityId', 'opportunitySerial', 'opportunityTitle'] as const;
const PROJECT_KEYS = ['projectId', 'projectName'] as const;

/**
 * The patch for an UPDATE. Unlike `buildRecordLinks` this has to actively CLEAR
 * a link the user removed, so a dropped side is written as `deleteField()` —
 * leaving the key out would silently keep the old link.
 */
export function recordLinksPatch(links: RecordLinks): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const k of OPPORTUNITY_KEYS) patch[k] = links.opportunityId ? (links[k] ?? deleteField()) : deleteField();
  for (const k of PROJECT_KEYS) patch[k] = links.projectId ? (links[k] ?? deleteField()) : deleteField();
  return patch;
}

export const hasAnyLink = (links?: RecordLinks | null): boolean =>
  !!(links && (links.opportunityId || links.projectId));

/** True when the two blocks point at the same records (labels are ignored). */
export const sameLinkTargets = (a?: RecordLinks | null, b?: RecordLinks | null): boolean =>
  (a?.opportunityId || '') === (b?.opportunityId || '') &&
  (a?.projectId || '') === (b?.projectId || '');

/**
 * The targets in `links` that `previous` did not already name — i.e. the ones a
 * history entry is owed. Re-saving a form with the link untouched yields an
 * empty block, so a save is never spam. Used by `applyRecordLinks` and by every
 * caller that writes the link patch inside its own `updateDoc` (the task edit
 * form does, so it makes ONE write instead of two).
 */
export function newlyLinked(previous?: RecordLinks | null, links?: RecordLinks | null): RecordLinks {
  const prev = previous || {};
  const next = links || {};
  const fresh: RecordLinks = {};
  if (next.opportunityId && next.opportunityId !== prev.opportunityId) {
    fresh.opportunityId = next.opportunityId;
  }
  if (next.projectId && next.projectId !== prev.projectId) {
    fresh.projectId = next.projectId;
  }
  return fresh;
}

/** Read the link block back off a stored task / correspondence. */
export const linksOf = (rec?: Partial<RecordLinks> | null): RecordLinks => ({
  ...(rec?.opportunityId ? {
    opportunityId: rec.opportunityId,
    ...(rec.opportunitySerial ? { opportunitySerial: rec.opportunitySerial } : {}),
    ...(rec.opportunityTitle ? { opportunityTitle: rec.opportunityTitle } : {}),
  } : {}),
  ...(rec?.projectId ? {
    projectId: rec.projectId,
    ...(rec.projectName ? { projectName: rec.projectName } : {}),
  } : {}),
});

// ─── History wording ─────────────────────────────────────────────────────────

export type LinkEvent =
  | 'created'    // the task/email was created already linked
  | 'linked'     // an existing record was attached afterwards
  | 'status'     // its status moved
  | 'completed'  // it was finished
  | 'note';      // free-text update from the record

const KIND_LABEL: Record<LinkedRecordKind, string> = {
  task: 'Task',
  correspondence: 'Correspondence',
};

/** `Task TK000123 "Prepare technical proposal"` */
export function sourceLabel(source: LinkSource): string {
  const serial = source.serialNumber ? ` ${source.serialNumber}` : '';
  return `${KIND_LABEL[source.kind]}${serial} "${source.title}"`;
}

/**
 * The sentence stored in the opportunity follow-up / project update. English by
 * design; `note` is appended verbatim so a status change can carry the user's
 * own words.
 */
export function historyText(source: LinkSource, event: LinkEvent, note?: string): string {
  const label = sourceLabel(source);
  const who = source.assignedTo ? ` — assigned to ${source.assignedTo}` : '';
  const due = source.dueDate ? `, due ${source.dueDate}` : '';
  let head: string;
  switch (event) {
    case 'created':   head = `${label} created${who}${due}.`; break;
    case 'linked':    head = `${label} linked to this record${who}.`; break;
    case 'status':    head = `${label} is now ${source.status || 'updated'}.`; break;
    case 'completed': head = `${label} completed${source.assignedTo ? ` by ${source.assignedTo}` : ''}.`; break;
    default:          head = `${label} updated.`; break;
  }
  const extra = note?.trim();
  return extra ? `${head} ${extra}` : head;
}

// ─── Writing the history entries ─────────────────────────────────────────────

export interface MirrorResult {
  opportunity: boolean;
  project: boolean;
  errors: string[];
}

/**
 * Post one history entry into whichever targets `links` names.
 *
 * Best-effort ON PURPOSE: a failed mirror is reported, never thrown. The task or
 * email is the record the user came to write; losing its history echo must not
 * roll back or block that write.
 */
export async function mirrorRecordEvent(
  links: RecordLinks,
  source: LinkSource,
  actor: LinkActor,
  event: LinkEvent,
  note?: string,
): Promise<MirrorResult> {
  const text = historyText(source, event, note);
  const result: MirrorResult = { opportunity: false, project: false, errors: [] };
  const authorName = actor.displayName || 'Unknown';
  const authorColor = actor.color || getUserColor(authorName);

  if (links.opportunityId) {
    try {
      await addDoc(collection(db, 'opportunityFollowUps'), {
        opportunityId: links.opportunityId,
        text,
        authorId: actor.uid,     // rules: must equal the signed-in uid
        authorName,
        authorColor,
        createdAt: serverTimestamp(),
      });
      // Mirror ONLY the summary fields. `stage` and `nextActionDate` belong to
      // the bid owner's own follow-ups — a task event knows nothing about them
      // and must never move the pipeline.
      await updateDoc(doc(db, 'opportunities', links.opportunityId), {
        lastFollowUpText: text,
        lastFollowUpAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      result.opportunity = true;
    } catch (e) {
      console.error('mirror to opportunity failed:', e);
      result.errors.push('opportunity');
    }
  }

  if (links.projectId) {
    try {
      await addDoc(collection(db, 'projectUpdates'), {
        projectId: links.projectId,
        text,
        authorId: actor.uid,
        authorName,
        authorColor,
        createdAt: serverTimestamp(),
      });
      // No `status`/`currentStatus` here either — a task's status is not the
      // project's status; only the "last update" summary is shared.
      await updateDoc(doc(db, 'projects', links.projectId), {
        lastUpdateText: text,
        lastUpdateAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      result.project = true;
    } catch (e) {
      console.error('mirror to project failed:', e);
      result.errors.push('project');
    }
  }

  return result;
}

/**
 * Attach / re-attach / detach an EXISTING task or correspondence, then mirror a
 * history entry into every target that is newly linked.
 *
 * The link write is awaited and DOES throw — if it fails there is no link and
 * the caller must say so. The mirror that follows is best-effort (above).
 *
 * `previous` is the record's current link block; a target already present in it
 * gets no second "linked" entry, so re-saving a form is not spam.
 */
export async function applyRecordLinks(
  source: LinkSource,
  links: RecordLinks,
  actor: LinkActor,
  opts: { previous?: RecordLinks | null; event?: LinkEvent; note?: string } = {},
): Promise<MirrorResult> {
  await updateDoc(doc(db, COLLECTION[source.kind], source.id), {
    ...recordLinksPatch(links),
    updatedAt: serverTimestamp(),
  });

  const fresh = newlyLinked(opts.previous, links);
  if (!hasAnyLink(fresh)) return { opportunity: false, project: false, errors: [] };

  return mirrorRecordEvent(fresh, source, actor, opts.event || 'linked', opts.note);
}

/**
 * The create-time twin: the new doc was written WITH its links already in it, so
 * there is nothing to patch — only the history to mirror.
 */
export const announceNewRecord = (
  links: RecordLinks,
  source: LinkSource,
  actor: LinkActor,
  note?: string,
): Promise<MirrorResult> => mirrorRecordEvent(links, source, actor, 'created', note);
