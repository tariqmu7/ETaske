// Notification body builder.
//
// Every notification is mirrored out of the app (Telegram DM / FCM push), so the
// body is often the ONLY thing a manager reads — they shouldn't have to open the
// record to know what happened. These helpers turn a Task / Corresponding into a
// compact detail block appended under the headline sentence.
//
// Kept plain-text + "\n" separated: the Apps Script Telegram sender HTML-escapes
// the body and preserves newlines (google-apps-script.js -> sendTelegramMessage),
// and the in-app list renders it with `white-space: pre-line`.

import { Task, Corresponding, Opportunity } from '../types';

// Telegram caps a message at 4096 chars and a wall of text defeats the purpose
// of a glanceable alert. Long descriptions get an ellipsis.
const MAX_DESC = 280;

function truncate(text: string | undefined, max = MAX_DESC): string {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** "Label: value" for each non-empty pair, one per line. */
function block(rows: Array<[string, string | undefined]>): string {
  return rows
    .filter(([, value]) => value && value.trim())
    .map(([label, value]) => `${label}: ${value}`)
    .join('\n');
}

/** Detail block for a task. `headline` becomes the first line. */
export function taskDetails(headline: string, task: Partial<Task>): string {
  const details = block([
    ['Ref', task.serialNumber],
    ['Description', truncate(task.description)],
    ['Assigned to', task.assignedTo],
    ['Priority', task.priority],
    ['Status', task.status],
    ['Due', task.dueDate],
  ]);
  return details ? `${headline}\n\n${details}` : headline;
}

/**
 * Detail block for an opportunity (tender / bid).
 *
 * A bid alert is read away from the app more often than any other — the value
 * and the client are what make it worth opening, so they lead. `value` is
 * pre-formatted by the caller (it owns the currency).
 */
export function opportunityDetails(
  headline: string,
  opp: Partial<Opportunity>,
  value?: string,
): string {
  const details = block([
    ['Ref', opp.serialNumber],
    ['Client', [opp.client, opp.sector].filter(Boolean).join(' · ')],
    ['Tender no.', opp.tenderNumber],
    ['Value', value],
    ['Stage', opp.stage],
    ['Bid owner', opp.ownerName],
    ['Submission deadline', opp.submissionDeadline],
    ['Scope', truncate(opp.scope)],
  ]);
  return details ? `${headline}\n\n${details}` : headline;
}

/** Detail block for a correspondence. `body` is its description field. */
export function corrDetails(headline: string, corr: Partial<Corresponding>): string {
  const details = block([
    ['Ref', corr.serialNumber],
    ['Description', truncate(corr.body)],
    ['From', corr.sentFrom],
    ['Department', corr.department],
    ['Priority', corr.priority],
    ['Status', corr.status],
    ['Deadline', corr.deadline],
  ]);
  return details ? `${headline}\n\n${details}` : headline;
}
