// Who may open and edit the BD control section (queue E4). Unlike Medical
// contracts there is no per-person switch: every Approved Manager or Admin
// sees it, and the same people may edit. Mirrors the `bdControl` block in
// firestore.rules — keep the two in step.
import type { AppUser } from '../types';

type Who = Pick<AppUser, 'role' | 'status'> | null | undefined;

export const canViewBdControl = (u: Who) =>
  !!u && u.status === 'Approved' && (u.role === 'Manager' || u.role === 'Admin');

export const canEditBdControl = canViewBdControl;
