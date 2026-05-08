import React, { useState } from 'react';
import { AppUser } from './types';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from './lib/firebase';
import { Check, X, Shield, Users, Building, ShieldAlert } from 'lucide-react';

interface Props {
  users: AppUser[];
}

export default function AdminDashboard({ users }: Props) {
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editTeamId, setEditTeamId] = useState('');
  const [editRole, setEditRole] = useState<'Admin' | 'Member' | 'Manager'>('Member');
  const [editPhoneNumber, setEditPhoneNumber] = useState('');

  const updateUserStatus = async (userId: string, status: 'Approved' | 'Rejected') => {
    try {
      await updateDoc(doc(db, 'users', userId), { status });
    } catch (e) {
      console.error(e);
      alert("Failed to update status.");
    }
  };

  const saveUserDetails = async (userId: string) => {
    try {
      await updateDoc(doc(db, 'users', userId), { 
        teamId: editTeamId,
        role: editRole,
        phoneNumber: editPhoneNumber
      });
      setEditingUserId(null);
    } catch (e) {
      console.error(e);
      alert("Failed to update user.");
    }
  };

  const startEdit = (user: AppUser) => {
    setEditingUserId(user.id);
    setEditTeamId(user.teamId || '');
    setEditRole(user.role || 'Member');
    setEditPhoneNumber(user.phoneNumber || '');
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-center gap-3 mb-8">
        <ShieldAlert className="w-8 h-8 text-neutral-900" />
        <h2 className="text-2xl font-bold">Admin specific tasks and approval</h2>
      </div>

      <div className="bg-white border text-sm text-neutral-900 border-neutral-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-neutral-50 text-xs font-semibold text-neutral-500 uppercase tracking-wider">
              <tr>
                <th className="px-6 py-4">User</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Role / Team</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {users.map(u => (
                <tr key={u.id} className="hover:bg-neutral-50/50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      {u.photoURL ? (
                        <img src={u.photoURL} className="w-8 h-8 rounded-full" alt="avatar" />
                      ) : (
                        <div className="w-8 h-8 bg-neutral-200 rounded-full flex items-center justify-center">
                          <Users className="w-4 h-4 text-neutral-500" />
                        </div>
                      )}
                      <div>
                        <div className="font-semibold text-neutral-900">{u.displayName || 'No Name'}</div>
                        <div className="text-xs text-neutral-500">{u.email}</div>
                        {u.phoneNumber && <div className="text-xs text-neutral-400 mt-0.5">{u.phoneNumber}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                      u.status === 'Approved' ? 'bg-green-50 text-green-700' :
                      u.status === 'Rejected' ? 'bg-red-50 text-red-700' :
                      'bg-amber-50 text-amber-700'
                    }`}>
                      {u.status}
                    </span>
                    {u.status === 'Pending' && (
                      <div className="flex items-center gap-2 mt-2">
                        <button onClick={() => updateUserStatus(u.id, 'Approved')} className="p-1 hover:bg-green-100 text-green-600 rounded">
                          <Check className="w-4 h-4" />
                        </button>
                        <button onClick={() => updateUserStatus(u.id, 'Rejected')} className="p-1 hover:bg-red-100 text-red-600 rounded">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    {editingUserId === u.id ? (
                      <div className="space-y-2">
                        <select 
                          value={editRole} 
                          onChange={e => setEditRole(e.target.value as 'Admin'|'Member'|'Manager')}
                          className="w-full px-2 py-1 border rounded text-xs"
                        >
                          <option value="Member">Member</option>
                          <option value="Manager">Manager</option>
                          <option value="Admin">Admin</option>
                        </select>
                        <input 
                          type="text" 
                          placeholder="Team / Dept" 
                          value={editTeamId} 
                          onChange={e => setEditTeamId(e.target.value)}
                          className="w-full px-2 py-1 border rounded text-xs"
                        />
                        <input 
                          type="text" 
                          placeholder="Phone Number (e.g. +2010...)" 
                          value={editPhoneNumber} 
                          onChange={e => setEditPhoneNumber(e.target.value)}
                          className="w-full px-2 py-1 border rounded text-xs"
                        />
                      </div>
                    ) : (
                      <div>
                        <div className="flex items-center gap-1.5 text-xs font-medium mb-1">
                          <Shield className="w-3.5 h-3.5 text-neutral-400" />
                          {u.role}
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-neutral-500">
                          <Building className="w-3.5 h-3.5" />
                          {u.teamId || <span className="italic text-neutral-400">Unassigned</span>}
                        </div>
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right">
                    {editingUserId === u.id ? (
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => saveUserDetails(u.id)} className="text-xs bg-neutral-900 border text-white font-medium px-3 py-1.5 rounded-lg hover:bg-neutral-800 transition-colors">Save</button>
                        <button onClick={() => setEditingUserId(null)} className="text-xs bg-white border text-neutral-700 font-medium px-3 py-1.5 rounded-lg hover:bg-neutral-50 transition-colors">Cancel</button>
                      </div>
                    ) : (
                      <button onClick={() => startEdit(u)} className="text-xs bg-white border font-medium px-3 py-1.5 rounded-lg hover:bg-neutral-50 transition-colors">Edit</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
