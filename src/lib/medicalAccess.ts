// Who may open the Medical contracts section (queue M2). Granted per person
// by an admin on the Users screen, separate from the role: a Manager does NOT
// get it by being a Manager. Mirrors the `medicalContracts` block in
// firestore.rules — keep the two in step.
import type { AppUser, MedicalAccess } from '../types';

export const MEDICAL_ACCESS_LEVELS: MedicalAccess[] = ['none', 'view', 'edit'];

export function medicalAccessOf(u: Pick<AppUser, 'role' | 'status' | 'medicalContractsAccess'> | null | undefined): MedicalAccess {
  if (!u || u.status !== 'Approved') return 'none';
  if (u.role === 'Admin') return 'edit';
  const a = u.medicalContractsAccess;
  return a === 'view' || a === 'edit' ? a : 'none';
}

export const canViewMedical = (u: Parameters<typeof medicalAccessOf>[0]) => medicalAccessOf(u) !== 'none';
export const canEditMedical = (u: Parameters<typeof medicalAccessOf>[0]) => medicalAccessOf(u) === 'edit';
