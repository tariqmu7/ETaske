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
  fcmToken?: string;
}

// ─── Correspondences (incoming) ───────────────────────────────────────────────

export type CorrespondingStatus = 'Unread' | 'Reviewing' | 'Assigned' | 'Closed';

export type CorrespondingCategory = string;

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
  actions?: string;
  // Attachments
  attachedFile?: string;
  attachedFileName?: string;
  serialNumber?: string;
  filePaths?: string[];         // New: list of local/share folder paths
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
  // Privacy: when true the task is visible/editable ONLY to its owner
  // (assignedToId) — not managers, not admin. Absent/false = public (shared
  // org board). Enforced in firestore.rules + src/lib/taskVisibility.ts.
  isPrivate?: boolean;
  // Assignments
  assignedTo?: string;        // employee displayName (primary owner)
  assignedToId?: string;      // employee uid (primary owner)
  assignedBy?: string;        // manager displayName
  assignedById?: string;      // manager uid
  // Collaboration: additional users the task is shared with / related to.
  // The primary owner stays `assignedToId`; collaborators can read & edit the
  // task (and its private variant). `collaborators` is a denormalized snapshot
  // of display names for rendering; `collaboratorIds` is the source of truth and
  // is what firestore.rules + taskVisibility.ts key off.
  collaboratorIds?: string[];
  collaborators?: string[];
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
  correspondingSerialNumber?: string;
  // Attachments
  attachedFile?: string;
  attachedFileName?: string;
  serialNumber?: string;
  filePaths?: string[];         // New: list of local/share folder paths
  // Meta
  userId: string;
  teamId: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─── Projects ─────────────────────────────────────────────────────────────────

export type ProjectStatus = 'Active' | 'On Hold' | 'Completed' | 'Cancelled';

export const PROJECT_STATUS_OPTIONS: ProjectStatus[] = ['Active', 'On Hold', 'Completed', 'Cancelled'];

// Currencies used across project contracts, subcontracts and financials.
// Free text is still accepted, but these power the quick-pick selects.
export const CURRENCY_OPTIONS: string[] = ['EGP', 'USD', 'EUR', 'GBP', 'SAR', 'AED'];

export interface Project {
  id: string;
  serialNumber?: string;        // PR000001
  name: string;
  code?: string;                // contract number, e.g. 4600002981
  client?: string;              // e.g. AGIBA
  operator?: string;            // e.g. EPROM
  description?: string;
  location?: string;
  status: ProjectStatus;
  // Tracking summary (mirror of the latest projectUpdates entry)
  currentStatus?: string;
  lastUpdateText?: string;
  lastUpdateAt?: Timestamp;
  // Meta dates
  issueDate?: string;
  rev?: string;
  startDate?: string;
  endDate?: string;
  // Ownership
  userId: string;
  teamId?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// Contract tree node. `parentId` null => top-level item.
export type ProjectContractType =
  | 'contract'
  | 'work_authorization'
  | 'agreement'
  | 'amendment'
  | 'sub_contract';

export const PROJECT_CONTRACT_TYPE_OPTIONS: { value: ProjectContractType; label: string }[] = [
  { value: 'contract', label: 'Contract' },
  { value: 'work_authorization', label: 'Work Authorization' },
  { value: 'agreement', label: 'Agreement' },
  { value: 'amendment', label: 'Amendment' },
  { value: 'sub_contract', label: 'Sub-Contract' },
];

export interface ProjectContractItem {
  id: string;
  projectId: string;
  parentId: string | null;
  type: ProjectContractType;
  contractNumber?: string;
  subject?: string;
  companyName?: string;
  department?: string;          // requesting department
  srDate?: string;
  srValue?: number | string;
  contractValue?: number | string;
  currency?: string;
  loaDate?: string;
  startDate?: string;
  endDate?: string;
  status?: string;
  logStatus?: string;
  contractingMethod?: string;   // e.g. أمر مباشر / ممارسة
  amendmentNumber?: string;     // رقم الملحق
  valueAfterIncrease?: number | string;
  remarks?: string;
  inCharge?: string;
  userId: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface ProjectSubcontract {
  id: string;
  projectId: string;
  name: string;                 // subcontractor / supplier name
  typeOfService?: string;
  soOrContract?: string;        // SO / contract reference number
  reference?: string;           // folder reference
  startDate?: string;
  expiryDate?: string;
  price?: number | string;
  currency?: string;
  status?: string;
  currentStatus?: string;
  remarks?: string;
  userId: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type ProjectFinancialType = 'invoice' | 'income' | 'expense' | 'budget';

export const PROJECT_FINANCIAL_TYPE_OPTIONS: ProjectFinancialType[] = ['invoice', 'income', 'expense', 'budget'];

export interface ProjectFinancialRecord {
  id: string;
  projectId: string;
  type: ProjectFinancialType;
  title: string;
  amount?: number | string;
  currency?: string;
  date?: string;
  relatedContractId?: string;
  status?: string;
  notes?: string;
  userId: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface ProjectUpdate {
  id: string;
  projectId: string;
  status?: string;              // project status snapshot at time of update
  text: string;
  authorId: string;
  authorName: string;
  authorColor?: string;
  createdAt: Timestamp;
}

// ─── Notifications (in-app) ───────────────────────────────────────────────────

export type NotificationType =
  | 'new_corresponding'
  | 'corresponding_assigned'
  | 'correspondence_added'
  | 'correspondence_updated'
  | 'task_assigned'
  | 'task_updated'
  | 'task_status_updated'
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

export interface ChatMessage {
  id: string;
  senderId: string;
  receiverId: string;
  text: string;
  createdAt: Timestamp;
  participants: string[]; // [uid1, uid2] sorted
  read: boolean;
  readAt?: Timestamp;     // when the receiver opened/saw it
  // Optional reference to a Task / Correspondence shared in the chat so the
  // recipient can jump straight to it (see src/lib/deepLink.ts).
  refType?: 'task' | 'corresponding';
  refId?: string;
  refLabel?: string;      // taskName / subject snapshot for display
  refSerial?: string;     // serial number snapshot (e.g. TK000001 / CR000001)
}

// ─── Announcements (department broadcast) ─────────────────────────────────────

export interface Announcement {
  id: string;
  text: string;
  department: string;        // scope: every Approved user with this department
  recipientIds?: string[];   // if set & non-empty: only these uids (+author) see it; else dept-wide
  authorId: string;
  authorName: string;
  authorPhotoURL?: string;
  authorColor?: string;
  readBy: string[];          // uids that have seen it (small dept teams)
  createdAt: Timestamp;
}

// ─── Select Options ───────────────────────────────────────────────────────────

export const STATUS_OPTIONS: TaskStatus[] = ['Pending', 'In Progress', 'Done', 'Archived'];

export const ACTION_OPTIONS = ['None', 'For info', 'SR for approval', 'Action needed'];

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
  'None',
  'Legal Department',
  'Finance Department',
  'PR',
  'IT',
  'Technical Office',
  'Technical Support',
  'CEO Office',
  'Medical Department',
  'Other...'
];

export const PROJECT_OPTIONS = [
  'None',
  'AMOC', 'APC', 'APRC', 'AGIBA', 'ANOPC', 'ASPPC', 'ALEX FERT', 'ASORC', 'CORC',
  'ELAB', 'SADAT BERTH', 'ENPPI', 'ETHYDCO', 'FLEET ENERGY', 'GASCO', 'KHALDA',
  'MIDOR', 'MIDTAP', 'NPC', 'OSOCO', 'PETROBEL', 'PETROGAS', 'PETRONEFERTITI',
  'RED SEA', 'PPC', 'SOPC', 'WEPCO', 'SUCO',
  'Other...'
];

export const MILESTONE_STATUS_OPTIONS: MilestoneStatus[] = ['Planned', 'In Progress', 'Done', 'Blocked'];

export const CATEGORY_OPTIONS: CorrespondingCategory[] = ['Project', 'Internal', 'External', 'Other...'];

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
