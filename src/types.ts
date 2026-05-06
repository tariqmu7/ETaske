import { Timestamp } from 'firebase/firestore';

export interface AppUser {
  id: string;
  displayName: string;
  email: string;
  photoURL: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  role: 'Admin' | 'Member';
  teamId?: string;
}

export interface TaskNote {
  id: string;
  text: string;
  isCompleted: boolean;
}

export type TaskPriority = 'Low' | 'Medium' | 'High' | 'Urgent';

export const PRIORITY_OPTIONS: TaskPriority[] = ['Low', 'Medium', 'High', 'Urgent'];

export interface Task {
  id: string;
  taskName: string;
  status: 'In Progress' | 'Done' | 'Pending';
  description: string;
  statusUpdate: string;
  assignedTo?: string;
  waitingOn?: string;
  requiredAction?: string;
  notes?: TaskNote[];
  dueDate?: string;
  priority?: 'Low' | 'Medium' | 'High' | 'Urgent';
  attachedFile?: string;
  attachedFileName?: string;
  serialNumber?: string;
  userId: string;
  teamId: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface FollowUp {
  id: string;
  dateIssued: string;
  subject: string;
  description: string;
  assignedPersonnel: string;
  endDate: string;
  actionRequired: string;
  actionTakenSoFar: string;
  status: 'Pending' | 'Approved' | 'Returned' | 'Closed';
  attachedFile?: string;
  attachedFileName?: string;
  serialNumber?: string;
  userId: string;
  teamId: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export const FOLLOWUP_STATUS_OPTIONS = ['Pending', 'Approved', 'Returned', 'Closed'] as const;

export const ACTION_OPTIONS = [
  'None',
  'Needs Approval',
  'Please Review',
  'Follow Up',
  'Action Required',
  'Development',
  'Testing',
  'Deployment'
];

export const STATUS_UPDATE_OPTIONS = [
  'Not Started',
  'On Track',
  'At Risk',
  'Blocked',
  'Waiting on Third Party',
  'Completed',
  'Will Update Next Week'
];

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

