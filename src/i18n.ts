import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

const resources = {
  en: {
    translation: {
      "All Statuses": "All Statuses",
      "All Departments": "All Departments",
      "OVERDUE": "OVERDUE",
      "DUE SOON": "DUE SOON",
      "No correspondences found": "No correspondences found",
      "No items match your filters": "No items match your filters, or nothing has been logged yet.",
      "From:": "From: ",
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
      "Shared Folder Paths (Computer/Local)": "Shared Folder Paths (Computer/Local)",
      "No folder paths added.": "No folder paths added.",
      "Attachment": "Attachment",
      "Click to view or download": "Click to view or download",
      "No attachment": "No attachment",
      "Manager Notes / Internal Comments": "Manager Notes / Internal Comments",
      "Close": "Close",
      "Cancel": "Cancel",
      "Delete Corresponding?": "Delete Corresponding?",
      "Delete": "Delete",
      "Correspondence Body": "Correspondence Body",
      "No content provided.": "No content provided.",
      "Dates": "Dates",
      "Assignment": "Assignment",
      "Shared Folders / Links": "Shared Folders / Links",
      "Click to open in new tab": "Click to open in new tab",
      "Tasks": "Tasks",
      "Track your assigned tasks": "Track your assigned tasks, organize your work, and add milestones to show progress.",
      "Clear Date": "Clear Date",
      "All Employees": "All Employees",
      "Tag:": "Tag: ",
      "New Task": "New Task",
      "Fill in the details below": "Fill in the details below",
      "Task Name": "Task Name ",
      "Description": "Description ",
      "When": "When ",
      "Due Date": "Due Date ",
      "Who": "Who",
      "Uploading to Drive...": "Uploading to Drive…",
      "Drop file or click to upload": "Drop file or click to upload",
      "Uploads to Google Drive": "Uploads to Google Drive",
      "Shared Folder Paths (Computer Paths)": "Shared Folder Paths (Computer Paths)",
      "Shared Folder Paths": "Shared Folder Paths",
      "Open / Copy": "Open / Copy",
      "No milestones yet": "No milestones yet. Add one to track progress.",
      "By": "By ",
      "Next": "Next ",
      "No tasks found": "No tasks found",
      "No tasks match your current filters.": "No tasks match your current filters.",
      "Clear All Filters": "Clear All Filters",
      "Edit Task": "Edit Task",
      "Save Changes": "Save Changes",
      "Update the due date?": "Update the due date?",
      "New due date": "New due date",
      "Keep current due date": "Keep current due date"
    }
  }
};

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: "en",
    fallbackLng: "en",
    interpolation: {
      escapeValue: false 
    }
  });

export default i18n;
