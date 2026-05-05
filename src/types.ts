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

export interface Task {
  id: string;
  taskName: string;
  status: 'In Progress' | 'Done' | 'Pending';
  description: string;
  statusUpdate: string;
  assignee?: string;
  requiredAction?: string;
  notes?: TaskNote[];
  previewImage?: string;
  userId: string;
  teamId: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

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

