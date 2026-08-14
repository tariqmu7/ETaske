/**
 * English UI strings.
 *
 * The key IS the English source text (i18next `keySeparator: false`), so an
 * untranslated string still renders correctly in English. Keep this file and
 * `ar.ts` in the same order — `npm run lint` cannot tell you a key is missing,
 * the `LOCALE_KEYS` type in `../i18n.ts` can.
 */
const en = {
  // ── Language switcher ──
  "Language": "Language",
  "English": "English",
  "Arabic": "Arabic",

  // ── Filters / list controls ──
  "All Statuses": "All Statuses",
  "All Departments": "All Departments",
  "All Employees": "All Employees",
  "Tag:": "Tag: ",
  "Clear Date": "Clear Date",
  "Clear All Filters": "Clear All Filters",

  // ── Badges ──
  "OVERDUE": "OVERDUE",
  "DUE SOON": "DUE SOON",

  // ── Empty states ──
  "No correspondences found": "No correspondences found",
  "No items match your filters": "No items match your filters, or nothing has been logged yet.",
  "No tasks found": "No tasks found",
  "No tasks match your current filters.": "No tasks match your current filters.",
  "No milestones yet": "No milestones yet. Add one to track progress.",
  "No folder paths added.": "No folder paths added.",
  "No attachment": "No attachment",
  "No content provided.": "No content provided.",

  // ── Field labels ──
  "From:": "From: ",
  "By": "By ",
  "Next": "Next ",
  "Subject": "Subject",
  "Body / Description": "Body / Description",
  "Sent From": "Sent From",
  "Category": "Category",
  "Priority": "Priority",
  "Classification": "Classification",
  "Department": "Department",
  "Sub-Category / Project": "Sub-Category / Project",
  "Actions": "Actions",
  "Workflow": "Workflow",
  "Date Received": "Date Received",
  "Deadline": "Deadline",
  "Status": "Status",
  "Assignee": "Assignee",
  "Files": "Files ",
  "Dates": "Dates",
  "Assignment": "Assignment",
  "Task Name": "Task Name ",
  "Description": "Description ",
  "When": "When ",
  "Due Date": "Due Date ",
  "Who": "Who",

  // ── Files & attachments ──
  "Shared Folder Paths (Computer/Local)": "Shared Folder Paths (Computer/Local)",
  "Shared Folder Paths (Computer Paths)": "Shared Folder Paths (Computer Paths)",
  "Shared Folder Paths": "Shared Folder Paths",
  "Shared Folders / Links": "Shared Folders / Links",
  "Attachment": "Attachment",
  "Click to view or download": "Click to view or download",
  "Click to open in new tab": "Click to open in new tab",
  "Open / Copy": "Open / Copy",
  "Uploading to Drive...": "Uploading to Drive…",
  "Drop file or click to upload": "Drop file or click to upload",
  "Uploads to Google Drive": "Uploads to Google Drive",

  // ── Tasks ──
  "Tasks": "Tasks",
  "Track your assigned tasks": "Track your assigned tasks, organize your work, and add milestones to show progress.",
  "New Task": "New Task",
  "Edit Task": "Edit Task",
  "Fill in the details below": "Fill in the details below",
  "Update the due date?": "Update the due date?",
  "New due date": "New due date",
  "Keep current due date": "Keep current due date",

  // ── Correspondences ──
  "Correspondence Body": "Correspondence Body",
  "Manager Notes / Internal Comments": "Manager Notes / Internal Comments",
  "Delete Corresponding?": "Delete Corresponding?",

  // ── Buttons ──
  "Close": "Close",
  "Cancel": "Cancel",
  "Delete": "Delete",
  "Save Changes": "Save Changes",
} as const;

export default en;
