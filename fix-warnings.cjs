const fs = require('fs');

let code = fs.readFileSync('src/OverviewDashboard.tsx', 'utf8');

// Add translation function at the top
if (!code.includes('const t = (s: string) => s;')) {
    code = code.replace("import { globalSearch", "const t = (s: string) => s;\nimport { globalSearch");
}

// 1. priorityColor
code = code.replace(
`const priorityColor: Record<string, string> = {
  Urgent: '#dc2626', High: '#ea580c', Medium: '#d97706', Low: '#16a34a'
};`,
`const priorityColor = new Map<string, string>([
  ['Urgent', '#dc2626'], ['High', '#ea580c'], ['Medium', '#d97706'], ['Low', '#16a34a']
]);`);

code = code.replace(/priorityColor\[(.*?)\]/g, "priorityColor.get($1)");

// 2. CATEGORY_COLORS
code = code.replace(
`const CATEGORY_COLORS: Record<string, { bg: string; text: string; border: string; icon: React.ReactNode }> = {
  Project:  { bg: 'rgba(59,130,246,0.18)',  text: '#3b82f6', border: 'rgba(59,130,246,0.35)',  icon: <Server className="w-4 h-4" /> },
  Internal: { bg: 'rgba(139,92,246,0.18)',  text: '#8b5cf6', border: 'rgba(139,92,246,0.35)',  icon: <Layers className="w-4 h-4" /> },
  External: { bg: 'rgba(34,197,94,0.18)',   text: '#22c55e', border: 'rgba(34,197,94,0.35)',   icon: <Globe className="w-4 h-4" /> },
};`,
`const CATEGORY_COLORS = new Map<string, { bg: string; text: string; border: string; icon: React.ReactNode }>([
  ['Project',  { bg: 'rgba(59,130,246,0.18)',  text: '#3b82f6', border: 'rgba(59,130,246,0.35)',  icon: <Server className="w-4 h-4" /> }],
  ['Internal', { bg: 'rgba(139,92,246,0.18)',  text: '#8b5cf6', border: 'rgba(139,92,246,0.35)',  icon: <Layers className="w-4 h-4" /> }],
  ['External', { bg: 'rgba(34,197,94,0.18)',   text: '#22c55e', border: 'rgba(34,197,94,0.35)',   icon: <Globe className="w-4 h-4" /> }],
]);`);

code = code.replace(/CATEGORY_COLORS\[(.*?)\]\?/g, "CATEGORY_COLORS.get($1)?");
code = code.replace(/CATEGORY_COLORS\[(.*?)\] \|\|/g, "CATEGORY_COLORS.get($1) ||");

// 3. stats map
code = code.replace(
`    const stats: Record<string, { total: number; tasks: number; overdue: number }> = {
      Project: { total: 0, tasks: 0, overdue: 0 },
      Internal: { total: 0, tasks: 0, overdue: 0 },
      External: { total: 0, tasks: 0, overdue: 0 }
    };`,
`    const stats = new Map<string, { total: number; tasks: number; overdue: number }>([
      ['Project', { total: 0, tasks: 0, overdue: 0 }],
      ['Internal', { total: 0, tasks: 0, overdue: 0 }],
      ['External', { total: 0, tasks: 0, overdue: 0 }]
    ]);`);

code = code.replace(/if \(stats\[cat\]\) \{/g, "if (stats.has(cat)) {");
code = code.replace(/stats\[cat\]\.total\+\+;/g, "stats.get(cat)!.total++;");
code = code.replace(/stats\[cat\]\.overdue\+\+;/g, "stats.get(cat)!.overdue++;");
code = code.replace(/if \(c && stats\[c\.category\]\) stats\[c\.category\]\.tasks\+\+;/g, "if (c && stats.has(c.category)) stats.get(c.category)!.tasks++;");

// Also replace the categoryStats loop usage
code = code.replace(/const s = categoryStats\[cat\];/g, "const s = categoryStats.get(cat);");

// 4. Wrap literals in t()
const literalReplacements = [
  ['<strong>From:</strong>', '<strong>{t("From:")}</strong>'],
  ['Milestones: {done}', '{t("Milestones:")} {done}'],
  ['<h1 className="ov-title" style={{ fontSize: 28, fontWeight: 800, color: \'var(--text-primary)\', letterSpacing: \'-0.02em\' }}>Dashboard Overview</h1>', '<h1 className="ov-title" style={{ fontSize: 28, fontWeight: 800, color: \'var(--text-primary)\', letterSpacing: \'-0.02em\' }}>{t("Dashboard Overview")}</h1>'],
  ['<p className="ov-subtitle" style={{ color: \'var(--text-muted)\', fontSize: 14 }}>Real-time stats and task monitoring.</p>', '<p className="ov-subtitle" style={{ color: \'var(--text-muted)\', fontSize: 14 }}>{t("Real-time stats and task monitoring.")}</p>'],
  ['<h2 style={{ fontSize: 16, fontWeight: 800, color: \'var(--text-primary)\', margin: 0 }}>Due Soon (Within 48h)</h2>', '<h2 style={{ fontSize: 16, fontWeight: 800, color: \'var(--text-primary)\', margin: 0 }}>{t("Due Soon (Within 48h)")}</h2>'],
  ['<p style={{ fontSize: 12, color: \'var(--text-muted)\', margin: 0 }}>Items that require immediate attention.</p>', '<p style={{ fontSize: 12, color: \'var(--text-muted)\', margin: 0 }}>{t("Items that require immediate attention.")}</p>'],
  ['Due: {item.deadline || item.dueDate}', '{t("Due:")} {item.deadline || item.dueDate}'],
  ['<h2 style={{ fontSize: 18, fontWeight: 800, color: \'var(--text-primary)\', margin: 0 }}>Team Performance KPIs</h2>', '<h2 style={{ fontSize: 18, fontWeight: 800, color: \'var(--text-primary)\', margin: 0 }}>{t("Team Performance KPIs")}</h2>'],
  ['<p style={{ fontSize: 13, color: \'var(--text-muted)\', margin: 0 }}>Workload and completion stats for active members.</p>', '<p style={{ fontSize: 13, color: \'var(--text-muted)\', margin: 0 }}>{t("Workload and completion stats for active members.")}</p>'],
  ['<th style={{ padding: \'12px 24px\', color: \'var(--text-secondary)\', fontWeight: 700 }}>Employee</th>', '<th style={{ padding: \'12px 24px\', color: \'var(--text-secondary)\', fontWeight: 700 }}>{t("Employee")}</th>'],
  ['<th style={{ padding: \'12px 16px\', color: \'var(--text-secondary)\', fontWeight: 700 }}>Active Corrs</th>', '<th style={{ padding: \'12px 16px\', color: \'var(--text-secondary)\', fontWeight: 700 }}>{t("Active Corrs")}</th>'],
  ['<th style={{ padding: \'12px 16px\', color: \'var(--text-secondary)\', fontWeight: 700 }}>Total Tasks</th>', '<th style={{ padding: \'12px 16px\', color: \'var(--text-secondary)\', fontWeight: 700 }}>{t("Total Tasks")}</th>'],
  ['<th style={{ padding: \'12px 16px\', color: \'var(--text-secondary)\', fontWeight: 700 }}>Completed</th>', '<th style={{ padding: \'12px 16px\', color: \'var(--text-secondary)\', fontWeight: 700 }}>{t("Completed")}</th>'],
  ['<th style={{ padding: \'12px 16px\', color: \'var(--text-secondary)\', fontWeight: 700 }}>In Progress</th>', '<th style={{ padding: \'12px 16px\', color: \'var(--text-secondary)\', fontWeight: 700 }}>{t("In Progress")}</th>'],
  ['<th style={{ padding: \'12px 16px\', color: \'var(--text-secondary)\', fontWeight: 700 }}>Overdue</th>', '<th style={{ padding: \'12px 16px\', color: \'var(--text-secondary)\', fontWeight: 700 }}>{t("Overdue")}</th>'],
  ['<th style={{ padding: \'12px 24px\', color: \'var(--text-secondary)\', fontWeight: 700, width: 200 }}>Completion Rate</th>', '<th style={{ padding: \'12px 24px\', color: \'var(--text-secondary)\', fontWeight: 700, width: 200 }}>{t("Completion Rate")}</th>'],
  ['<span style={{ fontSize: 13, color: catStyle.text, opacity: 0.8, fontWeight: 600 }}>Category</span>', '<span style={{ fontSize: 13, color: catStyle.text, opacity: 0.8, fontWeight: 600 }}>{t("Category")}</span>'],
  ['<span style={{ color: \'#dc2626\', fontSize: 14, fontWeight: 700 }}>Overdue Correspondences</span>', '<span style={{ color: \'#dc2626\', fontSize: 14, fontWeight: 700 }}>{t("Overdue Correspondences")}</span>'],
  ['<p style={{ fontWeight: 600 }}>No data matches your criteria.</p>', '<p style={{ fontWeight: 600 }}>{t("No data matches your criteria.")}</p>'],
  ['No description provided.</span>', '{t("No description provided.")}</span>'],
  ['<span style={{ display: \'block\', fontSize: 11, fontWeight: 700, color: \'var(--text-muted)\', textTransform: \'uppercase\', marginBottom: 4 }}>Assigned To</span>', '<span style={{ display: \'block\', fontSize: 11, fontWeight: 700, color: \'var(--text-muted)\', textTransform: \'uppercase\', marginBottom: 4 }}>{t("Assigned To")}</span>'],
  ['<span style={{ display: \'block\', fontSize: 11, fontWeight: 700, color: \'var(--text-muted)\', textTransform: \'uppercase\', marginBottom: 4 }}>Assigned By</span>', '<span style={{ display: \'block\', fontSize: 11, fontWeight: 700, color: \'var(--text-muted)\', textTransform: \'uppercase\', marginBottom: 4 }}>{t("Assigned By")}</span>'],
  ['<span style={{ display: \'block\', fontSize: 11, fontWeight: 700, color: \'var(--text-muted)\', textTransform: \'uppercase\', marginBottom: 4 }}>Due Date</span>', '<span style={{ display: \'block\', fontSize: 11, fontWeight: 700, color: \'var(--text-muted)\', textTransform: \'uppercase\', marginBottom: 4 }}>{t("Due Date")}</span>'],
  ['<span style={{ display: \'block\', fontSize: 11, fontWeight: 700, color: \'var(--text-muted)\', textTransform: \'uppercase\', marginBottom: 4 }}>Linked Corresponding</span>', '<span style={{ display: \'block\', fontSize: 11, fontWeight: 700, color: \'var(--text-muted)\', textTransform: \'uppercase\', marginBottom: 4 }}>{t("Linked Corresponding")}</span>'],
  ['<span>Added by {ms.addedBy}</span>', '<span>{t("Added by")} {ms.addedBy}</span>'],
  ['<span>Target: {ms.targetDate}</span>', '<span>{t("Target:")} {ms.targetDate}</span>'],
  ['<h3 style={{ fontSize: 14, fontWeight: 800, color: \'var(--text-primary)\', margin: 0, textTransform: \'uppercase\', letterSpacing: \'0.05em\' }}>Correspondence Body</h3>', '<h3 style={{ fontSize: 14, fontWeight: 800, color: \'var(--text-primary)\', margin: 0, textTransform: \'uppercase\', letterSpacing: \'0.05em\' }}>{t("Correspondence Body")}</h3>'],
  ['No content provided.</span>', '{t("No content provided.")}</span>'],
  ['<span style={{ display: \'block\', fontSize: 11, fontWeight: 700, color: \'var(--text-muted)\', textTransform: \'uppercase\', marginBottom: 8, letterSpacing: \'0.05em\' }}>Sent From</span>', '<span style={{ display: \'block\', fontSize: 11, fontWeight: 700, color: \'var(--text-muted)\', textTransform: \'uppercase\', marginBottom: 8, letterSpacing: \'0.05em\' }}>{t("Sent From")}</span>'],
  ['<span style={{ display: \'block\', fontSize: 11, fontWeight: 700, color: \'var(--text-muted)\', textTransform: \'uppercase\', marginBottom: 8, letterSpacing: \'0.05em\' }}>Dates</span>', '<span style={{ display: \'block\', fontSize: 11, fontWeight: 700, color: \'var(--text-muted)\', textTransform: \'uppercase\', marginBottom: 8, letterSpacing: \'0.05em\' }}>{t("Dates")}</span>'],
  ['<span style={{ display: \'block\', fontSize: 11, fontWeight: 700, color: \'var(--text-muted)\', textTransform: \'uppercase\', marginBottom: 8, letterSpacing: \'0.05em\' }}>Assignment</span>', '<span style={{ display: \'block\', fontSize: 11, fontWeight: 700, color: \'var(--text-muted)\', textTransform: \'uppercase\', marginBottom: 8, letterSpacing: \'0.05em\' }}>{t("Assignment")}</span>'],
  ['<div style={{ fontSize: 11, color: \'var(--text-muted)\' }}>Assigned {formatDate(selectedCorr.assignedAt)}</div>', '<div style={{ fontSize: 11, color: \'var(--text-muted)\' }}>{t("Assigned")} {formatDate(selectedCorr.assignedAt)}</div>'],
  ['<h3 style={{ fontSize: 14, fontWeight: 800, color: \'var(--text-primary)\', margin: 0, textTransform: \'uppercase\', letterSpacing: \'0.05em\' }}>Shared Folders / Links</h3>', '<h3 style={{ fontSize: 14, fontWeight: 800, color: \'var(--text-primary)\', margin: 0, textTransform: \'uppercase\', letterSpacing: \'0.05em\' }}>{t("Shared Folders / Links")}</h3>'],
  ['<h3 style={{ fontSize: 14, fontWeight: 800, color: \'var(--text-primary)\', margin: 0, textTransform: \'uppercase\', letterSpacing: \'0.05em\' }}>Attachment</h3>', '<h3 style={{ fontSize: 14, fontWeight: 800, color: \'var(--text-primary)\', margin: 0, textTransform: \'uppercase\', letterSpacing: \'0.05em\' }}>{t("Attachment")}</h3>'],
  ['<div style={{ fontSize: 11, opacity: 0.8 }}>Click to open in new tab</div>', '<div style={{ fontSize: 11, opacity: 0.8 }}>{t("Click to open in new tab")}</div>'],
  ['<h3 style={{ fontSize: 14, fontWeight: 800, color: \'var(--text-primary)\', margin: 0, textTransform: \'uppercase\', letterSpacing: \'0.05em\' }}>Internal Notes</h3>', '<h3 style={{ fontSize: 14, fontWeight: 800, color: \'var(--text-primary)\', margin: 0, textTransform: \'uppercase\', letterSpacing: \'0.05em\' }}>{t("Internal Notes")}</h3>']
];

literalReplacements.forEach(([find, replace]) => {
  code = code.replace(find, replace);
});

fs.writeFileSync('src/OverviewDashboard.tsx', code);
console.log("Fixes applied.");
