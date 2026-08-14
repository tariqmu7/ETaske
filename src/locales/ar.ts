import type en from './en';

/**
 * Arabic (Modern Standard, Egyptian business register) UI strings.
 *
 * Typed as `Record<keyof typeof en, string>` so the type-check fails the moment
 * a key is added to `en.ts` and not translated here — that is the only guard
 * there is, since a missing i18next key silently falls back to English.
 *
 * Trailing spaces in a few values are deliberate: those strings are rendered
 * next to a sibling element (a required-field asterisk, a name) and the source
 * English carries the same trailing space.
 */
const ar: Record<keyof typeof en, string> = {
  // ── Language switcher ──
  "Language": "اللغة",
  "English": "English",
  "Arabic": "العربية",

  // ── Filters / list controls ──
  "All Statuses": "كل الحالات",
  "All Departments": "كل الإدارات",
  "All Employees": "كل الموظفين",
  "Tag:": "وسم: ",
  "Clear Date": "مسح التاريخ",
  "Clear All Filters": "مسح كل عوامل التصفية",

  // ── Badges ──
  "OVERDUE": "متأخرة",
  "DUE SOON": "قرب الموعد",

  // ── Empty states ──
  "No correspondences found": "لا توجد مراسلات",
  "No items match your filters": "لا توجد عناصر مطابقة لعوامل التصفية، أو لم يُسجَّل شيء بعد.",
  "No tasks found": "لا توجد مهام",
  "No tasks match your current filters.": "لا توجد مهام مطابقة لعوامل التصفية الحالية.",
  "No milestones yet": "لا توجد مراحل بعد. أضف مرحلة لتتبع التقدم.",
  "No folder paths added.": "لم تتم إضافة أي مسارات.",
  "No attachment": "لا يوجد مرفق",
  "No content provided.": "لا يوجد محتوى.",

  // ── Field labels ──
  "From:": "من: ",
  "By": "بواسطة ",
  "Next": "التالي ",
  "Subject": "الموضوع",
  "Body / Description": "المحتوى / الوصف",
  "Sent From": "الجهة المرسِلة",
  "Category": "الفئة",
  "Priority": "الأولوية",
  "Classification": "بيانات التصنيف",
  "Department": "الإدارة",
  "Sub-Category / Project": "الفئة الفرعية / المشروع",
  "Actions": "الإجراءات",
  "Workflow": "سير العمل",
  "Date Received": "تاريخ الاستلام",
  "Deadline": "الموعد النهائي",
  "Status": "الحالة",
  "Assignee": "المسؤول",
  "Files": "الملفات ",
  "Dates": "التواريخ",
  "Assignment": "الإسناد",
  "Task Name": "اسم المهمة ",
  "Description": "الوصف ",
  "When": "التوقيت ",
  "Due Date": "تاريخ التسليم ",
  "Who": "المسؤولية",

  // ── Files & attachments ──
  "Shared Folder Paths (Computer/Local)": "مسارات المجلدات المشتركة (الجهاز / محلي)",
  "Shared Folder Paths (Computer Paths)": "مسارات المجلدات المشتركة (مسارات الجهاز)",
  "Shared Folder Paths": "مسارات المجلدات المشتركة",
  "Shared Folders / Links": "المجلدات المشتركة / الروابط",
  "Attachment": "المرفق",
  "Click to view or download": "اضغط للعرض أو التنزيل",
  "Click to open in new tab": "اضغط للفتح في تبويب جديد",
  "Open / Copy": "فتح / نسخ",
  "Uploading to Drive...": "جارٍ الرفع إلى Drive…",
  "Drop file or click to upload": "أفلت الملف أو اضغط للرفع",
  "Uploads to Google Drive": "يتم الرفع إلى Google Drive",

  // ── Tasks ──
  "Tasks": "المهام",
  "Track your assigned tasks": "تابع المهام المسندة إليك، ونظّم عملك، وأضف مراحل لإظهار التقدم.",
  "New Task": "مهمة جديدة",
  "Edit Task": "تعديل المهمة",
  "Fill in the details below": "أدخل التفاصيل بالأسفل",
  "Update the due date?": "تحديث تاريخ التسليم؟",
  "New due date": "تاريخ تسليم جديد",
  "Keep current due date": "الإبقاء على التاريخ الحالي",

  // ── Correspondences ──
  "Correspondence Body": "نص المراسلة",
  "Manager Notes / Internal Comments": "ملاحظات المدير / تعليقات داخلية",
  "Delete Corresponding?": "حذف المراسلة؟",

  // ── Buttons ──
  "Close": "إغلاق",
  "Cancel": "إلغاء",
  "Delete": "حذف",
  "Save Changes": "حفظ التغييرات",
};

export default ar;
