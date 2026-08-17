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
  // Telegram notifications (t.me/E_TASK_bot). Set once the user links their
  // account via the Connect Telegram flow (src/lib/telegram.ts): the bot reports
  // their chat id through the Apps Script webhook and the client stores it here.
  telegramChatId?: string;
}

// ─── Cross-record links ───────────────────────────────────────────────────────

// A task or a correspondence may be attached to an Opportunity and/or a Project.
// The id is the source of truth; the serial/name beside it is a DENORMALIZED
// LABEL so a list can render "OP000012 · Zohr tie-in" without reading the other
// collection (the same rule the opportunity/project mirrors already follow).
// A stale label is acceptable — it is never compared, filtered or aggregated on;
// only the id is. Written through `src/lib/recordLinks.ts`, never by hand.
export interface RecordLinks {
  opportunityId?: string;
  opportunitySerial?: string;   // OP000012
  opportunityTitle?: string;
  projectId?: string;
  projectName?: string;
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
  // Cross-record links (opportunity / project) — see RecordLinks above
  opportunityId?: string;
  opportunitySerial?: string;
  opportunityTitle?: string;
  projectId?: string;
  projectName?: string;
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
  // Cross-record links (opportunity / project) — see RecordLinks above.
  // NOTE: `subCategory` still carries the free-text PROJECT_OPTIONS string the
  // task form has always shown; `projectId` is the real projects/{id} ref and
  // the two are independent on purpose.
  opportunityId?: string;
  opportunitySerial?: string;
  opportunityTitle?: string;
  projectId?: string;
  projectName?: string;
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

// ─── Opportunities (tenders / bids pipeline) ─────────────────────────────────

// The pipeline is linear up to 'Under Evaluation', then splits into the three
// closed outcomes. Anything in CLOSED_OPPORTUNITY_STAGES is out of the pipeline
// and is what the win-rate / loss-analysis views are computed from.
export type OpportunityStage =
  | 'Identified'
  | 'Prequalification'
  | 'Bid Preparation'
  | 'Submitted'
  | 'Under Evaluation'
  | 'Won'
  | 'Lost'
  | 'No Bid'
  | 'Cancelled';

export const OPPORTUNITY_STAGE_OPTIONS: OpportunityStage[] = [
  'Identified', 'Prequalification', 'Bid Preparation', 'Submitted',
  'Under Evaluation', 'Won', 'Lost', 'No Bid', 'Cancelled',
];

export const OPEN_OPPORTUNITY_STAGES: OpportunityStage[] = [
  'Identified', 'Prequalification', 'Bid Preparation', 'Submitted', 'Under Evaluation',
];

export const CLOSED_OPPORTUNITY_STAGES: OpportunityStage[] = ['Won', 'Lost', 'No Bid', 'Cancelled'];

export const isOpportunityOpen = (stage?: OpportunityStage) =>
  !!stage && OPEN_OPPORTUNITY_STAGES.includes(stage);

export type OpportunitySource = 'Public Tender' | 'Limited Tender' | 'Direct Order' | 'Framework' | 'Referral' | 'Other';

export const OPPORTUNITY_SOURCE_OPTIONS: OpportunitySource[] = [
  'Public Tender', 'Limited Tender', 'Direct Order', 'Framework', 'Referral', 'Other',
];

export interface Opportunity {
  id: string;
  serialNumber?: string;          // OP000001
  title: string;
  client?: string;                // e.g. EGPC, AGIBA
  sector?: string;                // e.g. Refining, Petrochemical, Terminals
  location?: string;
  tenderNumber?: string;          // client's tender / RFQ reference
  source?: OpportunitySource;
  scope?: string;                 // short scope description
  stage: OpportunityStage;
  probability?: number;           // 0–100, manual judgement (weighted pipeline)
  estimatedValue?: number | string;
  currency?: string;              // from CURRENCY_OPTIONS
  // Dates (ISO yyyy-mm-dd strings, same convention as Project)
  announcedDate?: string;
  submissionDeadline?: string;
  submittedDate?: string;
  decisionDate?: string;          // award / rejection date
  // Ownership — bid owner plus optional co-owners (mirrors Task collaborators)
  ownerId?: string;
  ownerName?: string;
  collaboratorIds?: string[];
  // Outcome (set when the stage becomes closed; full detail lives in
  // opportunityFeedback — see OpportunityFeedback)
  awardedTo?: string;             // winning competitor, when lost
  awardedValue?: number | string;
  // Follow-up summary (mirror of the latest opportunityFollowUps entry)
  lastFollowUpText?: string;
  lastFollowUpAt?: Timestamp;
  nextActionDate?: string;
  userId: string;
  teamId?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// Structured loss/win reasons — kept as a fixed list so the analysis view can
// aggregate them. Free text goes in OpportunityFeedback.notes.
export const OPPORTUNITY_REASON_OPTIONS: string[] = [
  'Price too high',
  'Technical evaluation',
  'Missing qualification / prequal',
  'Delivery / schedule',
  'Local content',
  'Client relationship',
  'Incomplete or late submission',
  'Commercial terms',
  'Competitor incumbency',
  'Scope mismatch',
  'Other',
];

export interface OpportunityFollowUp {
  id: string;
  opportunityId: string;
  text: string;
  stage?: OpportunityStage;       // stage snapshot at time of the follow-up
  nextActionDate?: string;
  authorId: string;
  authorName: string;
  authorColor?: string;
  createdAt: Timestamp;
}

export type OpportunityMilestoneStatus = MilestoneStatus;

export interface OpportunityMilestone {
  id: string;
  opportunityId: string;
  title: string;
  status: OpportunityMilestoneStatus;
  dueDate?: string;
  completedDate?: string;
  notes?: string;
  addedById: string;
  addedByName?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface OpportunityFeedback {
  id: string;
  opportunityId: string;
  outcome: Extract<OpportunityStage, 'Won' | 'Lost' | 'No Bid' | 'Cancelled'>;
  reasons: string[];              // from OPPORTUNITY_REASON_OPTIONS
  primaryReason?: string;
  competitorName?: string;
  ourPrice?: number | string;
  winningPrice?: number | string;
  priceGapPercent?: number;       // (ours - winner) / winner * 100
  clientFeedback?: string;        // what the client told us
  lessonsLearned?: string;
  notes?: string;
  authorId: string;
  authorName: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
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
  | 'task_overdue'
  | 'corresponding_overdue'
  // Bid submission deadline approaching / passed. The 'opportunit' stem is what
  // refTypeForNotification keys the deep link on — keep it in any new type here.
  | 'opportunity_deadline';

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
