import React, { useState } from 'react';
import { AppUser } from './types';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from './lib/firebase';
import { Check, X, Shield, Users, Building, ShieldCheck, UserCog, Download, FileSpreadsheet, Database, Loader2 } from 'lucide-react';
import { exportToExcel, downloadFullBackup } from './lib/exportData';

interface Props { users: AppUser[]; }

const codeStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 12,
  background: 'var(--surface-2)',
  padding: '1px 6px',
  borderRadius: 4,
};

function ExportBackupCard() {
  const [busy, setBusy] = useState<null | 'excel' | 'backup'>(null);
  const [result, setResult] = useState<React.ReactNode>(null);

  const runExcel = async () => {
    setBusy('excel'); setResult(null);
    try {
      const r = await exportToExcel();
      setResult(
        <span style={{ color: 'var(--text-secondary)' }}>
          ✓ Exported <strong>{r.correspondences}</strong> correspondences and{' '}
          <strong>{r.tasks}</strong> tasks → <strong>{r.fileName}</strong>
        </span>
      );
    } catch (e: any) {
      setResult(<span style={{ color: '#f87171' }}>Export failed: {e?.message || 'Unknown error'}</span>);
    } finally { setBusy(null); }
  };

  const runBackup = async () => {
    setBusy('backup'); setResult(null);
    try {
      const r = await downloadFullBackup();
      const ok = Object.entries(r.collections).map(([k, v]) => `${k} (${v})`).join(', ');
      setResult(
        <div style={{ color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span>✓ Saved <strong>{r.fileName}</strong> — {ok || 'no documents'}.</span>
          {r.skipped.length > 0 && (
            <span style={{ color: '#fbbf24', fontSize: 12 }}>
              Not included from the browser: {r.skipped.map(s => s.collection).join(', ')}. Run{' '}
              <code style={codeStyle}>npm run firestore:backup</code> for a complete server-side
              backup (includes chat).
            </span>
          )}
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Restore with <code style={codeStyle}>npm run firestore:restore backups/{r.fileName}</code>
          </span>
        </div>
      );
    } catch (e: any) {
      setResult(<span style={{ color: '#f87171' }}>Backup failed: {e?.message || 'Unknown error'}</span>);
    } finally { setBusy(null); }
  };

  return (
    <div className="card" style={{ padding: '20px 24px', marginBottom: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <Download className="w-4 h-4" style={{ color: 'var(--accent)' }} />
        <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Export &amp; Backup
        </h2>
      </div>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 16 }}>
        Download all correspondences and tasks as an Excel workbook, or take a full JSON
        backup of the database for safekeeping.
      </p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button className="btn btn-primary btn-sm" disabled={busy !== null} onClick={runExcel}>
          {busy === 'excel'
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <FileSpreadsheet className="w-3.5 h-3.5" />}
          {busy === 'excel' ? 'Exporting…' : 'Export to Excel'}
        </button>
        <button className="btn btn-ghost btn-sm" disabled={busy !== null} onClick={runBackup}>
          {busy === 'backup'
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <Database className="w-3.5 h-3.5" />}
          {busy === 'backup' ? 'Backing up…' : 'Download Full Backup (JSON)'}
        </button>
      </div>
      {result && <div style={{ marginTop: 14, fontSize: 13, lineHeight: 1.5 }}>{result}</div>}
    </div>
  );
}

export default function AdminDashboard({ users }: Props) {
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editTeamId, setEditTeamId] = useState('');
  const [editRole, setEditRole] = useState<'Admin' | 'Manager' | 'Employee'>('Employee');
  const [editDepartment, setEditDepartment] = useState('');
  const [editPhoneNumber, setEditPhoneNumber] = useState('');
  const [editPhotoURL, setEditPhotoURL] = useState('');
  const [editUserColor, setEditUserColor] = useState('');

  const updateStatus = async (userId: string, status: 'Approved' | 'Rejected') => {
    try { await updateDoc(doc(db, 'users', userId), { status }); }
    catch (e) { console.error(e); alert('Failed.'); }
  };

  const saveUser = async (userId: string) => {
    try {
      await updateDoc(doc(db, 'users', userId), {
        teamId: editTeamId, role: editRole,
        department: editDepartment, phoneNumber: editPhoneNumber,
        photoURL: editPhotoURL, userColor: editUserColor
      });
      setEditingUserId(null);
    } catch (e) { console.error(e); alert('Failed.'); }
  };

  const startEdit = (u: AppUser) => {
    setEditingUserId(u.id);
    setEditTeamId(u.teamId || '');
    setEditRole(u.role === 'Admin' ? 'Admin' : u.role === 'Manager' ? 'Manager' : 'Employee');
    setEditDepartment(u.department || '');
    setEditPhoneNumber(u.phoneNumber || '');
    setEditPhotoURL(u.photoURL || '');
    setEditUserColor(u.userColor || '#6366f1');
  };

  const pending = users.filter(u => u.status === 'Pending');
  const approved = users.filter(u => u.status === 'Approved');
  const rejected = users.filter(u => u.status === 'Rejected');

  return (
    <div style={{ padding: '4px 0', minHeight: '60vh' }}>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em', marginBottom: 4 }}>User Management</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>Approve users, assign roles and departments.</p>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16, marginBottom: 28 }}>
        {[
          { label: 'Pending', value: pending.length, cls: 'stat-amber' },
          { label: 'Approved', value: approved.length, cls: 'stat-green' },
          { label: 'Rejected', value: rejected.length, cls: 'stat-red' },
        ].map(s => (
          <div key={s.label} className={`card ${s.cls}`} style={{ padding: '20px 24px' }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--text-primary)' }}>{s.value}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 4 }}>{s.label}</div>
          </div>
        ))}
      </div>

      <ExportBackupCard />

      {/* Pending requests first */}
      {pending.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: '#fbbf24', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 14 }}>⚠ Pending Approval</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {pending.map(u => (
              <div key={u.id} className="card" style={{ padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 16, borderColor: 'rgba(245,158,11,0.3)' }}>
                <UserAvatar user={u} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>{u.displayName}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{u.email}</div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-success btn-sm" onClick={() => updateStatus(u.id, 'Approved')}>
                    <Check className="w-3.5 h-3.5" /> Approve
                  </button>
                  <button className="btn btn-danger btn-sm" onClick={() => updateStatus(u.id, 'Rejected')}>
                    <X className="w-3.5 h-3.5" /> Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* All users table */}
      <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 14 }}>All Users</h2>
      <div className="card" style={{ overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['User', 'Status', 'Role', 'Team/Dept', 'Actions'].map(h => (
                <th key={h} style={{ padding: '14px 20px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '14px 20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <UserAvatar user={u} />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>{u.displayName || 'No Name'}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{u.email}</div>
                    </div>
                  </div>
                </td>
                <td style={{ padding: '14px 20px' }}>
                  <span className={`badge ${u.status === 'Approved' ? 'badge-done' : u.status === 'Rejected' ? 'badge-urgent' : 'badge-pending'}`}>
                    {u.status}
                  </span>
                  {u.status === 'Pending' && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                      <button className="btn btn-success btn-sm btn-icon" onClick={() => updateStatus(u.id, 'Approved')} title="Approve"><Check className="w-3 h-3" /></button>
                      <button className="btn btn-danger btn-sm btn-icon" onClick={() => updateStatus(u.id, 'Rejected')} title="Reject"><X className="w-3 h-3" /></button>
                    </div>
                  )}
                </td>
                <td style={{ padding: '14px 20px' }}>
                  {editingUserId === u.id ? (
                    <select
                      value={editRole}
                      onChange={e => setEditRole(e.target.value as any)}
                      className="input"
                      style={{ padding: '6px 10px', fontSize: 12 }}
                    >
                      <option value="Employee">Employee</option>
                      <option value="Manager">Manager</option>
                      <option value="Admin">Admin</option>
                    </select>
                  ) : (
                    <span style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Shield className="w-3 h-3" /> {u.role}
                    </span>
                  )}
                </td>
                <td style={{ padding: '14px 20px' }}>
                  {editingUserId === u.id ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <input className="input" style={{ padding: '6px 10px', fontSize: 12 }} placeholder="Team ID" value={editTeamId} onChange={e => setEditTeamId(e.target.value)} />
                      <input className="input" style={{ padding: '6px 10px', fontSize: 12 }} placeholder="Department" value={editDepartment} onChange={e => setEditDepartment(e.target.value)} />
                      <input className="input" style={{ padding: '6px 10px', fontSize: 12 }} placeholder="Photo URL" value={editPhotoURL} onChange={e => setEditPhotoURL(e.target.value)} />
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Color:</span>
                        <input type="color" value={editUserColor} onChange={e => setEditUserColor(e.target.value)} style={{ width: 40, height: 24, padding: 0, border: 'none', background: 'none', cursor: 'pointer' }} />
                      </div>
                    </div>
                  ) : (
                    <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                      {u.teamId || u.department || <span style={{ fontStyle: 'italic', color: 'var(--text-muted)' }}>Unassigned</span>}
                    </span>
                  )}
                </td>
                <td style={{ padding: '14px 20px', textAlign: 'right' }}>
                  {editingUserId === u.id ? (
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      <button className="btn btn-primary btn-sm" onClick={() => saveUser(u.id)}>Save</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => setEditingUserId(null)}>Cancel</button>
                    </div>
                  ) : (
                    <button className="btn btn-ghost btn-sm" onClick={() => startEdit(u)}>
                      <UserCog className="w-3.5 h-3.5" /> Edit
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UserAvatar({ user }: { user: AppUser }) {
  const bgColor = user.userColor || 'linear-gradient(135deg,#6366f1,#818cf8)';
  return user.photoURL
    ? <img src={user.photoURL} referrerPolicy="no-referrer" className="avatar" style={{ width: 32, height: 32, objectFit: 'cover' }} alt="" />
    : <div style={{ width: 32, height: 32, borderRadius: 0, background: bgColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, color: '#fff', flexShrink: 0 }}>
        {user.displayName?.[0]?.toUpperCase() || '?'}
      </div>;
}
