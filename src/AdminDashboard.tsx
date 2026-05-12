import React, { useState } from 'react';
import { AppUser } from './types';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from './lib/firebase';
import { Check, X, Shield, Users, Building, ShieldCheck, UserCog } from 'lucide-react';

interface Props { users: AppUser[]; }

export default function AdminDashboard({ users }: Props) {
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editTeamId, setEditTeamId] = useState('');
  const [editRole, setEditRole] = useState<'Admin' | 'Manager' | 'Employee'>('Employee');
  const [editDepartment, setEditDepartment] = useState('');
  const [editPhoneNumber, setEditPhoneNumber] = useState('');

  const updateStatus = async (userId: string, status: 'Approved' | 'Rejected') => {
    try { await updateDoc(doc(db, 'users', userId), { status }); }
    catch (e) { console.error(e); alert('Failed.'); }
  };

  const saveUser = async (userId: string) => {
    try {
      await updateDoc(doc(db, 'users', userId), {
        teamId: editTeamId, role: editRole,
        department: editDepartment, phoneNumber: editPhoneNumber
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
  return user.photoURL
    ? <img src={user.photoURL} referrerPolicy="no-referrer" className="avatar" style={{ width: 32, height: 32 }} alt="" />
    : <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg,#6366f1,#818cf8)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, color: '#fff', flexShrink: 0 }}>
        {user.displayName?.[0]?.toUpperCase() || '?'}
      </div>;
}
