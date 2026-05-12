import { Timestamp } from 'firebase/firestore';

// ─── Users ───────────────────────────────────────────────────────────────────

export type UserRole = 'Admin' | 'Manager' | 'Employee';
export type UserStatus = 'Pending' | 'Approved' | 'Rejected';

export interface AppUser {
  id: string;
  displayName: string;
  email: string;
  photoURL: string;
  status: UserStatus;
  role: UserRole;
  teamId?: string;
  department?: string;
  phoneNumber?: string;
  userColor?: string;
  lastSeen?: Timestamp;
}

// ─── Correspondences (incoming) ───────────────────────────────────────────────

export type CorrespondingStatus = 'Unread' | 'Reviewing' | 'Assigned' | 'Closed';

export type CorrespondingCategory = 'Project' | 'Internal' | 'External';

export interface Corresponding {
  id: string;
  // Core fields
  subject: string;
  body: string;
  sentFrom: string;
  department: string;
  subCategory?: string;
  category: CorrespondingCategory;
  priority: TaskPriority;
  dateReceived: string;
  deadline?: string;
  // Attachments
  attachedFile?: string;
  attachedFileName?: string;
  serialNumber?: string;
  // Workflow
  status: CorrespondingStatus;
  assignedTo?: string;          // employee displayName
  assignedToId?: string;        // employee uid
  assignedAt?: Timestamp;
  convertedToTaskId?: string;   // ref to resulting task
  // Meta
  notes?: string;               // manager notes on review
  userId: string;               // who entered this corresponding
  teamId: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─── Milestones ───────────────────────────────────────────────────────────────

export type MilestoneStatus = 'Planned' | 'In Progress' | 'Done' | 'Blocked';

export interface Milestone {
  id: string;
  taskId: string;
  title: string;
  description?: string;
  status: MilestoneStatus;
  targetDate?: string;
  completedAt?: Timestamp;
  addedBy: string;              // displayName
  addedById: string;            // uid
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─── Tasks ────────────────────────────────────────────────────────────────────

export type TaskStatus = 'Pending' | 'In Progress' | 'Done' | 'Archived';
export type TaskPriority = 'Low' | 'Medium' | 'High' | 'Urgent';

export const PRIORITY_OPTIONS: TaskPriority[] = ['Low', 'Medium', 'High', 'Urgent'];

export interface TaskNote {
  id: string;
  text: string;
  isCompleted: boolean;
  addedBy?: string;
  addedAt?: string;
}

export interface Task {
  id: string;
  // Core
  taskName: string;
  description: string;
  priority: TaskPriority;
  status: TaskStatus;
  category?: CorrespondingCategory;
  subCategory?: string;
  department?: string;
  // Assignments
  assignedTo?: string;        // employee displayName
  assignedToId?: string;      // employee uid
  assignedBy?: string;        // manager displayName
  assignedById?: string;      // manager uid
  // Dates
  dueDate?: string;
  archivedAt?: Timestamp;
  // Progress
  statusUpdate?: string;
  notes?: TaskNote[];
  milestoneCount?: number;    // denormalized count
  completedMilestones?: number;
  // Traceability (link back to original corresponding)
  correspondingId?: string;
  correspondingSubject?: string;
  // Attachments
  attachedFile?: string;
  attachedFileName?: string;
  serialNumber?: string;
  // Meta
  userId: string;
  teamId: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─── Notifications (in-app) ───────────────────────────────────────────────────

export type NotificationType =
  | 'new_corresponding'
  | 'corresponding_assigned'
  | 'task_assigned'
  | 'milestone_added'
  | 'task_done'
  | 'task_overdue';

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  forUserId: string;
  forRole?: UserRole;
  read: boolean;
  link?: string;              // e.g. '#tasks'
  relatedId?: string;         // correspondingId or taskId
  createdAt: Timestamp;
}

// ─── Select Options ───────────────────────────────────────────────────────────

export const STATUS_OPTIONS: TaskStatus[] = ['Pending', 'In Progress', 'Done', 'Archived'];

export const ACTION_OPTIONS = [
  'None',
  'Needs Approval',
  'Please Review',
  'Follow Up',
  'Action Required',
  'Development',
  'Testing',
  'Deployment',
];

export const STATUS_UPDATE_OPTIONS = [
  'Not Started',
  'On Track',
  'At Risk',
  'Blocked',
  'Waiting on Third Party',
  'Completed',
  'Will Update Next Week',
];

export const DEPARTMENT_OPTIONS = [
  'Legal Department',
  'Finance Department',
  'PR',
  'IT',
  'Technical Office',
  'Technical Support',
  'CEO Office',
  'Medical Department',
];

export const PROJECT_OPTIONS = [
  'AMOC', 'APC', 'APRC', 'AGIBA', 'ANOPC', 'ASPPC', 'ALEX FERT', 'ASORC', 'CORC',
  'ELAB', 'SADAT BERTH', 'ENPPI', 'ETHYDCO', 'FLEET ENERGY', 'GASCO', 'KHALDA',
  'MIDOR', 'MIDTAP', 'NPC', 'OSOCO', 'PETROBEL', 'PETROGAS', 'PETRONEFERTITI',
  'RED SEA', 'PPC', 'SOPC', 'WEPCO', 'SUCO'
];

export const MILESTONE_STATUS_OPTIONS: MilestoneStatus[] = ['Planned', 'In Progress', 'Done', 'Blocked'];

export const CATEGORY_OPTIONS: CorrespondingCategory[] = ['Project', 'Internal', 'External'];

// ─── Legacy compat ─────────────────────────────────────────────────────────────

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
  };
}
