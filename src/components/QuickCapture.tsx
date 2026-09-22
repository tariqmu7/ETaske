import React, { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { User } from 'firebase/auth';
import {
  Sparkles, CheckSquare, MailOpen, Target, User as UserIcon, CalendarClock,
  Link2, Flag, X, ArrowRight, Check, Mic, Square, MicOff,
} from 'lucide-react';
import { AppUser, RecordLinks } from '../types';
import type { AppView } from '../App';
import CreateTaskPanel, { NewTaskDraft } from './CreateTaskPanel';
import { requestCreate } from '../lib/createIntent';
import { useKnownParties } from '../hooks/useKnownParties';
import { useFormat, DATE_MEDIUM } from '../lib/format';
import { useDisplayLabel } from '../lib/displayLabel';
import { readCapture, type CaptureProposal } from '../lib/quickCapture';
import type { SuggestedKind } from '../lib/mailSuggest';
import { useDictation } from '../hooks/useDictation';
import { initialLang, withSpoken, type DictationError, type DictationLang } from '../lib/dictation';

interface Props {
  user: User;
  appUser: AppUser;
  projectUsers: AppUser[];
  onNavigate: (v: AppView) => void;
}

const KINDS: { kind: SuggestedKind; label: string; icon: React.ReactNode }[] = [
  { kind: 'task', label: 'Task', icon: <CheckSquare size={14} /> },
  { kind: 'corresponding', label: 'Correspondence', icon: <MailOpen size={14} /> },
  { kind: 'opportunity', label: 'Bid', icon: <Target size={14} /> },
];

const VOICE_LANG_KEY = 'etaske.voiceLang';
const VOICE_LANGS: { lang: DictationLang; label: string }[] = [
  { lang: 'ar-EG', label: 'عربي' },
  { lang: 'en-US', label: 'EN' },
];

function voiceErrorText(e: DictationError, t: TFunction): string {
  switch (e) {
    case 'blocked': return t('The microphone is blocked. Allow it for this site in the browser settings, then try again.');
    case 'no-speech': return t('Nothing was heard. Tap the microphone and speak again.');
    case 'network': return t('Voice typing needs an internet connection.');
    case 'no-mic': return t('No microphone was found on this device.');
    default: return t('Voice typing stopped. Try again, or type instead.');
  }
}

/** yyyy-mm-dd → a local Date (new Date('yyyy-mm-dd') would be UTC midnight). */
const localDate = (isoDay: string) => {
  const [y, m, d] = isoDay.split('-').map(Number);
  return new Date(y, m - 1, d);
};

function whyText(p: CaptureProposal, t: TFunction): string {
  return p.reasons.map(r => {
    switch (r.code) {
      case 'pasted-email': return t('read as an e-mail from {{sender}}', { sender: r.value });
      case 'tender-words':
      case 'letter-words': return t('mentions “{{word}}”', { word: r.value });
      case 'owner-named': return t('{{name}} is named as doing it', { name: r.value });
      case 'owner-me': return t('you are doing it');
      case 'date': return t('date from “{{words}}”', { words: r.value });
      case 'known-client': return t('{{client}} is already on your boards', { client: r.value });
      case 'urgent-words': return t('marked urgent');
      default: return '';
    }
  }).filter(Boolean).join(' · ');
}

/**
 * One-box capture (queue task C1) — the default way to add work from Home.
 *
 * The user pastes an e-mail or writes a sentence; `readCapture` proposes the
 * record, owner, date and link as they type, and "Review and save" opens the
 * normal create form already filled in. Nothing is written from this box: the
 * user always confirms in that form, where every guess can still be changed.
 * A task opens the shared CreateTaskPanel right here; a correspondence or a
 * bid is handed to its own board through createIntent, like the Outlook Feed.
 *
 * The microphone (queue task C2) is for following up away from the desk: the
 * browser turns speech into text in the box — Arabic by default — and from
 * there it is read exactly like typing. It only fills the box.
 */
export default function QuickCapture({ user, appUser, projectUsers, onNavigate }: Props) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const label = useDisplayLabel();
  const { parties, records } = useKnownParties();
  const [text, setText] = useState('');
  const [kindOverride, setKindOverride] = useState<SuggestedKind | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [savedNote, setSavedNote] = useState(false);
  const boxRef = useRef<HTMLTextAreaElement>(null);

  const [voiceLang, setVoiceLang] = useState<DictationLang>(() => {
    try { return initialLang(localStorage.getItem(VOICE_LANG_KEY)); } catch { return initialLang(null); }
  });
  // What was in the box when the mic was pressed: the transcript is added to it.
  const beforeVoice = useRef('');
  const voice = useDictation(transcript => {
    setText(withSpoken(beforeVoice.current, transcript));
    setKindOverride(null);
    setSavedNote(false);
  });
  const toggleVoice = () => {
    if (voice.listening) { voice.stop(); return; }
    beforeVoice.current = text;
    setSavedNote(false);
    voice.start(voiceLang);
  };
  const pickVoiceLang = (lang: DictationLang) => {
    setVoiceLang(lang);
    try { localStorage.setItem(VOICE_LANG_KEY, lang); } catch { /* private window */ }
    if (voice.listening) voice.stop();
  };

  // Only the people the create form's Assignee list offers (CreateTaskPanel:
  // yourself, or your own department + team, or anyone for an Admin) — a name
  // the form cannot select must not be proposed as the owner.
  const people = useMemo(() => {
    const list = projectUsers
      .filter(u => u.status === 'Approved' && u.displayName)
      .filter(u =>
        u.id === user.uid ||
        appUser.role === 'Admin' ||
        (u.department === appUser.department && u.teamId === appUser.teamId))
      .map(u => ({ id: u.id, name: u.displayName }));
    if (!list.some(p => p.id === user.uid)) list.push({ id: user.uid, name: appUser.displayName });
    return list;
  }, [projectUsers, user.uid, appUser.displayName, appUser.role, appUser.department, appUser.teamId]);

  const ownDomain = (appUser.email || user.email || '').split('@')[1] || '';

  const read = useMemo(() => readCapture(text, {
    me: { id: user.uid, name: appUser.displayName },
    people,
    parties,
    ownDomain,
  }), [text, people, parties, ownDomain, user.uid, appUser.displayName]);

  const proposal = read && kindOverride ? { ...read, kind: kindOverride } : read;

  const linkPrefill: RecordLinks | undefined = useMemo(() => {
    const m = proposal?.match;
    if (!m) return undefined;
    const rec = records[m.id];
    return m.type === 'opportunity'
      ? { opportunityId: m.id, opportunitySerial: rec?.serial, opportunityTitle: rec?.title || m.label }
      : { projectId: m.id, projectName: rec?.title || m.label };
  }, [proposal?.match, records]);

  const taskPrefill: Partial<NewTaskDraft> | undefined = useMemo(() => proposal ? {
    taskName: proposal.title,
    description: proposal.description,
    priority: proposal.priority,
    dueDate: proposal.date || '',
    category: proposal.category,
    department: appUser.department || 'None',
    assignedTo: proposal.owner.name,
    assignedToId: proposal.owner.id,
    collaboratorIds: proposal.others.map(p => p.id),
  } : undefined, [proposal, appUser.department]);

  const reset = () => {
    if (voice.listening) voice.stop();
    voice.clearError();
    setText('');
    setKindOverride(null);
  };

  const confirm = () => {
    if (!proposal) return;
    if (voice.listening) voice.stop();
    if (proposal.kind === 'task') {
      setPanelOpen(true);
      return;
    }
    if (proposal.kind === 'opportunity') {
      requestCreate({
        type: 'opportunity',
        prefill: {
          title: proposal.title,
          client: proposal.client,
          tenderNumber: proposal.tenderNumber,
          submissionDeadline: proposal.date,
          scope: proposal.description.slice(0, 600),
        },
      });
      reset();
      onNavigate('opportunities');
      return;
    }
    requestCreate({
      type: 'corresponding',
      prefill: {
        subject: proposal.title,
        body: proposal.description,
        sentFrom: proposal.sender || proposal.client,
        category: proposal.category,
        priority: proposal.priority,
        deadline: proposal.date,
      },
    });
    reset();
    onNavigate('correspondences');
  };

  const chip = (icon: React.ReactNode, caption: string, value: string | null) => (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', minWidth: 0,
      background: 'var(--surface-2)', border: '1px solid var(--border)',
    }}>
      <span style={{ color: value ? 'var(--blue-600)' : 'var(--text-muted)', display: 'flex', flexShrink: 0 }}>{icon}</span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)' }}>{caption}</span>
        <span style={{
          display: 'block', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          color: value ? 'var(--text-primary)' : 'var(--text-muted)', fontStyle: value ? 'normal' : 'italic',
        }}>
          {value || t('none found — add it in the form')}
        </span>
      </span>
    </div>
  );

  return (
    <div className="card" style={{ background: 'var(--surface)', border: '1px solid var(--border)', padding: 16, marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <label htmlFor="quick-capture" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 800, color: 'var(--text-primary)' }}>
          <Sparkles size={16} style={{ color: 'var(--blue-600)' }} />
          {t('Add anything')}
        </label>
        {voice.supported && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div role="radiogroup" aria-label={t('Voice language')} style={{ display: 'flex', border: '1px solid var(--border)' }}>
              {VOICE_LANGS.map(v => {
                const active = voiceLang === v.lang;
                return (
                  <button
                    key={v.lang}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    lang={v.lang.slice(0, 2)}
                    onClick={() => pickVoiceLang(v.lang)}
                    style={{
                      padding: '0 10px', minHeight: 36, cursor: 'pointer', border: 'none', fontFamily: 'inherit',
                      fontSize: 12, fontWeight: 700,
                      background: active ? 'rgba(59,130,246,0.10)' : 'var(--surface)',
                      color: active ? 'var(--blue-600)' : 'var(--text-muted)',
                    }}
                  >
                    {v.label}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              data-voice="mic"
              onClick={toggleVoice}
              aria-pressed={voice.listening}
              aria-label={voice.listening ? t('Stop listening') : t('Speak instead of typing')}
              title={voice.listening ? t('Stop listening') : t('Speak instead of typing')}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 36, padding: '0 12px', cursor: 'pointer',
                fontFamily: 'inherit', fontSize: 13, fontWeight: 700,
                border: `1.5px solid ${voice.listening ? 'var(--danger, #dc2626)' : 'var(--border-md)'}`,
                background: voice.listening ? 'var(--danger, #dc2626)' : 'var(--surface)',
                color: voice.listening ? '#fff' : 'var(--blue-600)',
              }}
            >
              {voice.listening ? <Square size={14} fill="currentColor" /> : <Mic size={16} />}
              {voice.listening ? t('Stop') : t('Speak')}
            </button>
          </div>
        )}
      </div>
      <textarea
        id="quick-capture"
        ref={boxRef}
        className="input"
        value={text}
        onChange={e => {
          // Typing takes over from the mic, or the next spoken piece would
          // overwrite what was just typed.
          if (voice.listening) voice.stop();
          setText(e.target.value); setKindOverride(null); setSavedNote(false);
        }}
        onKeyDown={e => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); confirm(); }
          if (e.key === 'Escape' && text) { e.preventDefault(); reset(); }
        }}
        dir="auto"
        rows={text.includes('\n') ? 6 : 2}
        placeholder={t('Paste an e-mail or write a sentence — e.g. “Meeting with Petrojet Tuesday about the Algeria offer, Ahmed to send prices”')}
        style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit', fontSize: 14, lineHeight: 1.5 }}
      />

      {voice.listening && (
        <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 12, minWidth: 0 }}>
          <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--danger, #dc2626)', flexShrink: 0 }} />
          <span style={{ fontWeight: 700, color: 'var(--text-secondary)', flexShrink: 0 }}>{t('Listening… tap Stop when you finish.')}</span>
          {voice.interim && (
            <span dir="auto" data-voice="interim" style={{ color: 'var(--text-muted)', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
              {voice.interim}
            </span>
          )}
        </div>
      )}
      {voice.error && !voice.listening && (
        <div role="alert" data-voice="error" style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginTop: 8, fontSize: 12, color: 'var(--danger, #dc2626)', fontWeight: 600, lineHeight: 1.5 }}>
          <MicOff size={14} style={{ flexShrink: 0, marginTop: 2 }} /> {voiceErrorText(voice.error, t)}
        </div>
      )}

      {savedNote && !text && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 12, color: 'var(--success, #16a34a)', fontWeight: 600 }}>
          <Check size={14} /> {t('Saved. Add the next one.')}
        </div>
      )}

      {proposal && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>{t('This looks like a')}</span>
            <div role="radiogroup" aria-label={t('Record type')} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {KINDS.map(k => {
                const active = proposal.kind === k.kind;
                return (
                  <button
                    key={k.kind}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setKindOverride(k.kind)}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 10px', cursor: 'pointer',
                      fontFamily: 'inherit', fontSize: 12, fontWeight: 700,
                      border: `1.5px solid ${active ? 'var(--blue-500)' : 'var(--border-md)'}`,
                      background: active ? 'rgba(59,130,246,0.08)' : 'var(--surface-2)',
                      color: active ? 'var(--blue-600)' : 'var(--text-secondary)',
                    }}
                  >
                    {k.icon}{t(k.label)}
                  </button>
                );
              })}
            </div>
          </div>

          <div dir="auto" style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10, overflowWrap: 'anywhere' }}>
            {proposal.title}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 8 }}>
            {/* A bid or a correspondence has no owner field in its create form,
                so the owner is only proposed for a task. */}
            {proposal.kind === 'task' && chip(
              <UserIcon size={15} />,
              t('Owner'),
              proposal.owner.id === user.uid
                ? t('You')
                : proposal.owner.name + (proposal.others.length ? ` +${proposal.others.length}` : ''),
            )}
            {chip(
              <CalendarClock size={15} />,
              proposal.kind === 'opportunity' ? t('Submission deadline') : t('Due date'),
              proposal.date ? fmt.date(localDate(proposal.date), { weekday: 'short', ...DATE_MEDIUM }) : null,
            )}
            {chip(<Link2 size={15} />, t('Linked to'), proposal.match?.label || null)}
            {chip(<Flag size={15} />, t('Priority'), label(proposal.priority))}
          </div>

          {proposal.reasons.length > 0 && (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '10px 0 0', lineHeight: 1.5 }}>
              <span style={{ fontWeight: 700 }}>{t('Why:')}</span> {whyText(proposal, t)}
            </p>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={confirm}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 16px', cursor: 'pointer',
                background: 'var(--blue-600)', color: '#fff', border: 'none', fontFamily: 'inherit', fontWeight: 600, fontSize: 13,
              }}
            >
              {t('Review and save')} <ArrowRight size={15} className="dir-arrow" />
            </button>
            <button
              type="button"
              onClick={() => { reset(); boxRef.current?.focus(); }}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 14px', cursor: 'pointer',
                background: 'var(--surface)', color: 'var(--text-secondary)', border: '1px solid var(--border)',
                fontFamily: 'inherit', fontWeight: 600, fontSize: 13,
              }}
            >
              <X size={14} /> {t('Clear')}
            </button>
            <span style={{ alignSelf: 'center', fontSize: 11, color: 'var(--text-muted)' }}>
              {t('Nothing is saved until you press Save in the form.')}
            </span>
          </div>
        </div>
      )}

      <CreateTaskPanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        user={user}
        appUser={appUser}
        projectUsers={projectUsers}
        prefill={taskPrefill}
        linkPrefill={linkPrefill}
        headerIcon={<Sparkles size={16} color="#fff" />}
        headerTitle={t('Check and save')}
        headerSubtitle={t('Filled in from what you wrote — change anything that is wrong.')}
        onCreated={() => {
          setPanelOpen(false);
          reset();
          setSavedNote(true);
        }}
      />
    </div>
  );
}
