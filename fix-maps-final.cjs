const fs = require('fs');
let code = fs.readFileSync('src/OverviewDashboard.tsx', 'utf8');

// 1. priorityColor
code = code.replace(
  /const priorityColor:\s*Record<string,\s*string>\s*=\s*{[\s\S]*?};/,
  `const priorityColor = new Map<string, string>([
  ['Urgent', '#dc2626'], ['High', '#ea580c'], ['Medium', '#d97706'], ['Low', '#16a34a']
]);`
);

// 2. CATEGORY_COLORS
code = code.replace(
  /const CATEGORY_COLORS:\s*Record<string,.*?>\s*=\s*{[\s\S]*?};/,
  `const CATEGORY_COLORS = new Map<string, { bg: string; text: string; border: string; icon: React.ReactNode }>([
  ['Project',  { bg: 'rgba(59,130,246,0.18)',  text: '#3b82f6', border: 'rgba(59,130,246,0.35)',  icon: <Server className="w-4 h-4" /> }],
  ['Internal', { bg: 'rgba(139,92,246,0.18)',  text: '#8b5cf6', border: 'rgba(139,92,246,0.35)',  icon: <Layers className="w-4 h-4" /> }],
  ['External', { bg: 'rgba(34,197,94,0.18)',   text: '#22c55e', border: 'rgba(34,197,94,0.35)',   icon: <Globe className="w-4 h-4" /> }],
]);`
);

// 3. categoryStats.stats
code = code.replace(
  /const stats:\s*Record<string,\s*{.*?}>\s*=\s*{[\s\S]*?Project:[\s\S]*?External:[\s\S]*?};/,
  `const stats = new Map<string, { total: number; tasks: number; overdue: number }>([
      ['Project', { total: 0, tasks: 0, overdue: 0 }],
      ['Internal', { total: 0, tasks: 0, overdue: 0 }],
      ['External', { total: 0, tasks: 0, overdue: 0 }]
    ]);`
);

fs.writeFileSync('src/OverviewDashboard.tsx', code);
console.log('Fixed map declarations.');
