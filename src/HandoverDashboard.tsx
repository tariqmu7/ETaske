import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { User } from 'firebase/auth';
import { collection, doc, onSnapshot, serverTimestamp, updateDoc } from 'firebase/firestore';
import {
  Handshake, CheckSquare, MailOpen, Target, FileSignature, Copy, Download, Info, ArrowRight, Check,
} from 'lucide-react';
import { db } from './lib/firebase';
import { subscribeVisibleTasks } from './lib/taskVisibility';
import { requestOpen } from './lib/deepLink';
import { createNotification } from './lib/pushNotification';
import { useFormat, DATE_MEDIUM } from './lib/format';
import { useDisplayLabel } from './lib/displayLabel';
import {
  buildHandover, handoverSummary, canHandOver, handoverWrites, handoverNote, NOTIFY_TYPE, KIND_ORDER,
  type HandItem, type HandKind, type Person,
} from './lib/handover';
import { AppUser } from './types';
import type { AppView } from './App';

interface Props {
  user: User;
  appUser: AppUser;
  projectUsers: AppUser[];
  onNavigate: (v: AppView) => void;
}

/** yyyy-mm-dd → a local Date (new Date('yyyy-mm-dd') would be UTC midnight). */
const localDate = (isoDay: string) => {
  const [y, m, d] = isoDay.split('-').map(Number);
  return new Date(y, m - 1, d);
};

const rows = (snap: any) => snap.docs.filter((d: any) => d.id !== '--stats--').map((d: any) => ({ id: d.id, ...d.data() }));

/** `#/handover?person=<uid>` → that uid, or ''. */
const personFromHash = (hash: string) => {
  const q = hash.split('?')[1] || '';
  return new URLSearchParams(q).get('person') || '';
};

const KIND_ICON: Record<HandKind, React.ReactNode> = {
  task: <CheckSquare size={14} />,
  letter: <MailOpen size={14} />,
  bid: <Target size={14} />,
  contract: <FileSignature size={14} />,
};

const KIND_HEADING: Record<HandKind, string> = { task: 'Tasks', letter: 'Letters', bid: 'Bids', contract: 'Contracts' };

const COLLECTION_OF: Record<HandKind, string> = {
  task: 'tasks', letter: 'correspondences', bid: 'opportunities', contract: 'projectContracts',
};

/** "5 items" with Arabic number agreement — separate keys, not i18next plurals. */
function itemsText(t: TFunction, n: number): string {
  if (n === 1) return t('1 item');
  if (n === 2) return t('2 items');
  return n <= 10 ? t('{{count}} items', { count: n }) : t('{{count}} open items', { count: n });
}

/**
 * Handover file (queue task D7) — one page of everything still open in one
 * person's name (tasks, letters, bids, contract lines they are in charge of),
 * each movable to a colleague in a click, or all of it at once. A plain-text
 * note of the same list can be copied or downloaded for the person taking over.
 *
 * Managers pick anyone (including someone no longer approved — that is exactly
 * who needs a handover); an employee sees their own file. What each reader may
 * move mirrors firestore.rules (`canHandOver`). The logic is in
 * `lib/handover.ts` (pure, harness-covered).
 */
export default function HandoverDashboard({ user, appUser, projectUsers, onNavigate }: Props) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const label = useDisplayLabel();
  const isManager = appUser.role === 'Admin' || appUser.role === 'Manager';

  const [personId, setPersonId] = useState(() => (isManager && personFromHash(window.location.hash)) || user.uid);
  const [tasks, setTasks] = useState<any[] | null>(null);
  const [letters, setLetters] = useState<any[] | null>(null);
  const [bids, setBids] = useState<any[] | null>(null);
  const [contracts, setContracts] = useState<any[] | null>(null);
  const [projects, setProjects] = useState<any[] | null>(null);
  // Per-row "give to" choice, and the whole-file one.
  const [pick, setPick] = useState<Record<string, string>>({});
  const [allTo, setAllTo] = useState('');
  const [confirmAll, setConfirmAll] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const unsubT = subscribeVisibleTasks(user.uid, list => setTasks(list), () => setTasks([]));
    const sub = (name: string, set: (v: any[]) => void) => onSnapshot(collection(db, name), s => set(rows(s)),
      err => { console.warn(`Handover — ${name} listener:`, err.code); set([]); });
    const u = [sub('correspondences', setLetters), sub('opportunities', setBids), sub('projectContracts', setContracts), sub('projects', setProjects)];
    return () => { unsubT(); u.forEach(f => f()); };
  }, [user.uid]);

  // Back / Forward and a pasted `#/handover?person=…` link.
  useEffect(() => {
    if (!isManager) return;
    const onHash = () => { const p = personFromHash(window.location.hash); if (p) setPersonId(p); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [isManager]);

  const choosePerson = (id: string) => {
    setPersonId(id);
    setPick({});
    setAllTo('');
    setConfirmAll(false);
    setMessage(null);
    window.history.replaceState(null, '', `#/handover?person=${encodeURIComponent(id)}`);
  };

  const names = useMemo(() => Object.fromEntries(projectUsers.map(u => [u.id, u.displayName])), [projectUsers]);
  const byName = (a: AppUser, b: AppUser) => (a.displayName || '').localeCompare(b.displayName || '');
  // Anyone may be handed over FROM — someone who left is the usual case — but
  // work only goes TO an approved colleague.
  const fromPeople = useMemo(() => [...projectUsers].filter(u => u.displayName).sort(byName), [projectUsers]);
  const toPeople = useMemo(() => projectUsers.filter(u => u.status === 'Approved' && u.displayName && u.id !== personId).sort(byName), [projectUsers, personId]);

  const person: Person = { id: personId, name: names[personId] || (personId === user.uid ? appUser.displayName : '') };
  const loaded = !!(tasks && letters && bids && contracts && projects);
  const items = useMemo(
    () => (loaded && person.name ? buildHandover({ tasks: tasks!, correspondences: letters!, opportunities: bids!, contracts: contracts!, projects: projects! }, person) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loaded, tasks, letters, bids, contracts, projects, person.id, person.name],
  );
  const sum = handoverSummary(items);

  const recordOf = (it: HandItem) => {
    const list = it.kind === 'task' ? tasks : it.kind === 'letter' ? letters : it.kind === 'bid' ? bids : contracts;
    return list?.find(r => r.id === it.id) || null;
  };
  const movable = (it: HandItem) => canHandOver(it, recordOf(it), user.uid, isManager);
  const movableItems = items.filter(movable);

  const dateText = (d: string) => fmt.date(localDate(d), DATE_MEDIUM);

  /** Write one item across; returns false when Firestore refused it. */
  const moveOne = async (it: HandItem, to: Person): Promise<boolean> => {
    const rec = recordOf(it);
    const linked = it.kind === 'letter' && rec?.convertedToTaskId ? tasks?.find(tk => tk.id === rec.convertedToTaskId) : undefined;
    const writes = handoverWrites(it, rec, person, to, names, linked);
    if (!writes.length) return false;
    try {
      for (const w of writes) await updateDoc(doc(db, w.collection, w.id), { ...w.data, updatedAt: serverTimestamp() });
      return true;
    } catch (e) {
      console.error(`Handover — ${COLLECTION_OF[it.kind]}/${it.id} failed:`, e);
      return false;
    }
  };

  const notify = async (to: Person, type: string, title: string, text: string, relatedId?: string) => {
    if (to.id === user.uid) return;
    try {
      await createNotification({
        type: type as any, title, message: text, forUserId: to.id, read: false,
        ...(relatedId ? { relatedId } : { link: '#handover' }),
        createdAt: serverTimestamp(),
      }, projectUsers);
    } catch (e) {
      console.warn('Handover — notification failed:', e);
    }
  };

  const toPerson = (id: string): Person => ({ id, name: names[id] || '' });

  const moveRow = async (it: HandItem) => {
    const to = toPerson(pick[it.key] || '');
    if (!to.id) return;
    setBusy(it.key);
    setMessage(null);
    const ok = await moveOne(it, to);
    setBusy(null);
    if (!ok) { setMessage({ kind: 'error', text: t('Could not save the change. Check your connection and try again.') }); return; }
    setPick(p => { const n = { ...p }; delete n[it.key]; return n; });
    setMessage({ kind: 'ok', text: t('"{{title}}" is now with {{name}}.', { title: it.title, name: to.name }) });
    await notify(to, NOTIFY_TYPE[it.kind], 'Work handed over to you',
      `${appUser.displayName} handed you "${it.title}"${it.serial ? ` (${it.serial})` : ''} from ${person.name}.`,
      it.kind === 'contract' ? undefined : it.id);
  };

  const moveAll = async () => {
    const to = toPerson(allTo);
    if (!to.id) return;
    const list = movableItems;
    setConfirmAll(false);
    setBusy('__all__');
    setMessage(null);
    setProgress({ done: 0, total: list.length });
    const moved: HandItem[] = [];
    let failed = 0;
    for (const it of list) {
      if (await moveOne(it, to)) moved.push(it); else failed++;
      setProgress(p => (p ? { ...p, done: p.done + 1 } : p));
    }
    setBusy(null);
    setProgress(null);
    if (moved.length) {
      const s = handoverSummary(moved).byKind;
      const parts = KIND_ORDER.filter(k => s[k]).map(k => `${s[k]} ${KIND_HEADING[k].toLowerCase()}`).join(', ');
      await notify(to, 'handover_received', 'Work handed over to you',
        `${appUser.displayName} handed you ${moved.length} open item(s) from ${person.name}: ${parts}. Open ETaske → Handover to see them.`);
    }
    setMessage(failed
      ? { kind: 'error', text: t('Moved {{moved}} to {{name}}; {{failed}} could not be saved — try those again.', { moved: moved.length, name: to.name, failed }) }
      : { kind: 'ok', text: t('Moved {{moved}} to {{name}}.', { moved: moved.length, name: to.name }) });
  };

  const noteText = () => handoverNote(items, person, (k, o) => t(k, o as any) as string, dateText);

  const copyNote = async () => {
    try {
      await navigator.clipboard.writeText(noteText());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setMessage({ kind: 'error', text: t('Could not copy — use Download instead.') });
    }
  };

  const downloadNote = () => {
    const blob = new Blob(['﻿' + noteText()], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `handover-${(person.name || 'file').replace(/[^\p{L}\p{N}]+/gu, '-')}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const openRecord = (it: HandItem) => {
    if (it.kind === 'contract') {
      if (!it.projectId) return;
      requestOpen({ type: 'project', id: it.projectId, label: it.project || '', tab: 'contracts' });
      onNavigate('projects');
      return;
    }
    const type = it.kind === 'task' ? 'task' : it.kind === 'letter' ? 'corresponding' : 'opportunity';
    requestOpen({ type, id: it.id, label: it.title, serial: it.serial });
    onNavigate(it.kind === 'task' ? 'tasks' : it.kind === 'letter' ? 'correspondences' : 'opportunities');
  };

  const small: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', minHeight: 32, cursor: 'pointer',
    fontFamily: 'inherit', fontSize: 12, fontWeight: 600, background: 'var(--surface)', color: 'var(--blue-600)', border: '1px solid var(--border)',
  };
  const selectStyle: React.CSSProperties = { fontFamily: 'inherit', fontSize: 13, minHeight: 36, maxWidth: 240, minWidth: 0 };

  const ownFile = personId === user.uid;

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '20px 16px' }} data-handover="page">
      <div style={{ marginBottom: 14 }}>
        <h1 style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
          <Handshake size={22} style={{ color: 'var(--blue-600)' }} /> {t('Handover')}
        </h1>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: '4px 0 0' }}>
          {t('Everything still open in one person’s name — hand it to a colleague in a click.')}
        </p>
      </div>

      {/* Whose file */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        {isManager ? (
          <>
            <label htmlFor="handover-person" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>{t('Whose file')}</label>
            <select id="handover-person" className="input" data-handover="person" value={personId} onChange={e => choosePerson(e.target.value)} style={selectStyle}>
              {!fromPeople.some(u => u.id === personId) && <option value={personId}>{person.name || '—'}</option>}
              {fromPeople.map(u => (
                <option key={u.id} value={u.id}>{u.displayName}{u.status !== 'Approved' ? ` (${t(u.status)})` : ''}</option>
              ))}
            </select>
          </>
        ) : (
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', margin: 0 }}>{t('Your handover file')}</p>
        )}
      </div>

      {/* Summary + whole-file actions */}
      <section className="card" data-handover="summary" style={{ padding: 16, marginBottom: 16 }}>
        {!loaded ? (
          <p role="status" style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>{t('Reading the boards…')}</p>
        ) : (
          <>
            <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
              <bdi>{person.name}</bdi>{' · '}
              <span data-handover="total">{itemsText(t, sum.total)}</span>
              {sum.late > 0 && <> {' · '}<span style={{ color: 'var(--danger)' }}>{t('{{count}} late', { count: sum.late })}</span></>}
            </p>
            {sum.total > 0 && (
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '4px 0 0' }}>
                {KIND_ORDER.filter(k => sum.byKind[k]).map(k => `${t(KIND_HEADING[k])} ${sum.byKind[k]}`).join(' · ')}
                {sum.shared > 0 && ` · ${t('Co-owner on {{count}}', { count: sum.shared })}`}
              </p>
            )}

            {sum.total > 0 && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 12 }}>
                <button type="button" data-handover="copy" onClick={copyNote} style={small}>
                  {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? t('Copied') : t('Copy handover note')}
                </button>
                <button type="button" data-handover="download" onClick={downloadNote} style={small}>
                  <Download size={13} /> {t('Download note')}
                </button>
              </div>
            )}

            {movableItems.length > 0 && toPeople.length > 0 && (
              <div data-handover="all" style={{ borderTop: '1px solid var(--border)', marginTop: 14, paddingTop: 12 }}>
                {!confirmAll ? (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <label htmlFor="handover-all" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{t('Give everything to')}</label>
                    <select id="handover-all" className="input" data-handover="all-to" value={allTo} onChange={e => setAllTo(e.target.value)} style={selectStyle} disabled={!!busy}>
                      <option value="">{t('Choose a colleague…')}</option>
                      {toPeople.map(u => <option key={u.id} value={u.id}>{u.displayName}</option>)}
                    </select>
                    <button type="button" className="btn btn-primary" data-handover="all-go" disabled={!allTo || !!busy} onClick={() => setConfirmAll(true)} style={{ minHeight: 36 }}>
                      {t('Hand over {{count}}', { count: movableItems.length })}
                    </button>
                  </div>
                ) : (
                  <div data-handover="confirm" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                      {t('Move {{count}} open items from {{from}} to {{to}}?', { count: movableItems.length, from: person.name, to: names[allTo] })}
                    </span>
                    <button type="button" className="btn btn-primary" data-handover="confirm-yes" onClick={moveAll} style={{ minHeight: 36 }}>{t('Yes, hand over')}</button>
                    <button type="button" className="btn btn-ghost" onClick={() => setConfirmAll(false)} style={{ minHeight: 36 }}>{t('Cancel')}</button>
                  </div>
                )}
                {movableItems.length < sum.total && (
                  <p data-handover="not-movable" style={{ fontSize: 12, color: 'var(--text-muted)', margin: '8px 0 0' }}>
                    {t('{{count}} of these can only be moved by a manager or the person who logged them.', { count: sum.total - movableItems.length })}
                  </p>
                )}
              </div>
            )}
          </>
        )}
        {progress && (
          <p role="status" data-handover="progress" style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '10px 0 0' }}>
            {t('Moving {{done}} of {{total}}…', { done: progress.done, total: progress.total })}
          </p>
        )}
        {message && (
          <p role={message.kind === 'error' ? 'alert' : 'status'} data-handover="message" style={{ fontSize: 13, fontWeight: 600, color: message.kind === 'error' ? 'var(--danger)' : 'var(--success)', margin: '10px 0 0' }}>
            {message.text}
          </p>
        )}
      </section>

      {loaded && sum.total === 0 && (
        <p data-handover="empty" style={{ fontSize: 14, color: 'var(--text-secondary)', margin: '0 0 12px' }}>
          {ownFile ? t('Nothing open is in your name.') : t('Nothing open is in {{name}}’s name.', { name: person.name })}
        </p>
      )}

      {loaded && KIND_ORDER.map(kind => {
        const list = items.filter(i => i.kind === kind);
        if (!list.length) return null;
        return (
          <section key={kind} className="card" data-handover={`section-${kind}`} style={{ padding: 16, marginBottom: 12, minWidth: 0 }}>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 16, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 10px' }}>
              <span style={{ color: 'var(--blue-600)', display: 'flex' }}>{KIND_ICON[kind]}</span>
              {t(KIND_HEADING[kind])}
              <span className="ltr-data" style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-muted)' }}>{list.length}</span>
            </h2>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {list.map(it => {
                const can = movable(it);
                const sub = [
                  label(it.status),
                  it.role === 'collaborator' ? t('Co-owner') : '',
                  it.project ? t('Project: {{name}}', { name: it.project }) : '',
                  it.party || '',
                ].filter(Boolean) as string[];
                return (
                  <li key={it.key} data-handover="row" data-key={it.key} style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', minWidth: 0 }}>
                    <button
                      type="button"
                      onClick={() => openRecord(it)}
                      style={{ width: '100%', display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 10px', textAlign: 'start', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', minWidth: 0 }}
                    >
                      <span style={{ color: 'var(--blue-600)', display: 'flex', flexShrink: 0, marginTop: 2 }}>{KIND_ICON[it.kind]}</span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'flex', gap: 6, alignItems: 'baseline', minWidth: 0 }}>
                          {it.serial && <span className="ltr-data" style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{it.serial}</span>}
                          {/* Wraps rather than ellipsises: the whole title is what a successor needs. */}
                          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflowWrap: 'break-word', minWidth: 0 }}><bdi>{it.title}</bdi></span>
                        </span>
                        <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {sub.map((part, i) => <React.Fragment key={i}>{i > 0 && ' · '}<bdi>{part}</bdi></React.Fragment>)}
                        </span>
                        {it.lastNote && (
                          <span data-handover="note" style={{ display: 'block', fontSize: 11, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            <bdi>{it.lastNote}</bdi>
                          </span>
                        )}
                        {it.due && (
                          <span data-handover="due" style={{ display: 'block', marginTop: 2, fontSize: 12, fontWeight: it.late ? 700 : 500, color: it.late ? 'var(--danger)' : 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                            {it.late ? t('Was due {{date}}', { date: dateText(it.due) }) : t('Due {{date}}', { date: dateText(it.due) })}
                          </span>
                        )}
                      </span>
                    </button>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', padding: '0 10px 8px' }}>
                      {can && toPeople.length > 0 ? (
                        <>
                          <select
                            className="input"
                            data-handover="give-to"
                            aria-label={t('Give to')}
                            value={pick[it.key] || ''}
                            onChange={e => setPick(p => ({ ...p, [it.key]: e.target.value }))}
                            disabled={!!busy}
                            style={{ ...selectStyle, fontSize: 12, minHeight: 32 }}
                          >
                            <option value="">{t('Give to…')}</option>
                            {toPeople.map(u => <option key={u.id} value={u.id}>{u.displayName}</option>)}
                          </select>
                          <button type="button" data-handover="give" disabled={!pick[it.key] || !!busy} onClick={() => moveRow(it)} style={{ ...small, opacity: pick[it.key] ? 1 : 0.5 }}>
                            <ArrowRight size={13} /> {busy === it.key ? t('Saving…') : t('Hand over')}
                          </button>
                        </>
                      ) : !can ? (
                        <span data-handover="locked" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          {t('Only a manager or the person who logged it can move this.')}
                        </span>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      <p style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: 12, color: 'var(--text-muted)', margin: '14px 0 0', lineHeight: 1.5 }}>
        <Info size={13} style={{ flexShrink: 0, marginTop: 2 }} />
        <span>
          {t('Contracts are matched on the “in charge” name typed on the project, so a spelling different from the person’s ETaske name will not show here.')}{' '}
          {t('Private tasks are listed only in their owner’s own file.')}{' '}
          {t('The new person gets a notification; a letter’s linked task moves with the letter.')}
        </span>
      </p>
    </div>
  );
}
