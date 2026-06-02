const fs = require('fs');

let code = fs.readFileSync('src/OverviewDashboard.tsx', 'utf8');

const kpiMemo = `
  // ─── Employee KPIs ──────────────────────────────────────────────────────────
  const employeeKPIs = useMemo(() => {
    return projectUsers.map(u => {
      const uCorrs = correspondences.filter(c => c.assignedToId === u.id && c.status !== 'Closed');
      const uTasks = tasks.filter(t => t.assignedToId === u.id && t.status !== 'Archived');
      
      const totalTasks = uTasks.length;
      const completedTasks = uTasks.filter(t => t.status === 'Done').length;
      const inProgressTasks = uTasks.filter(t => t.status === 'In Progress').length;
      const overdueTasks = uTasks.filter(t => isOverdue(t.dueDate) && t.status !== 'Done').length;
      
      const rate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
      
      return {
        user: u,
        activeCorrs: uCorrs.length,
        totalTasks,
        completedTasks,
        inProgressTasks,
        overdueTasks,
        completionRate: rate
      };
    }).filter(kpi => kpi.activeCorrs > 0 || kpi.totalTasks > 0)
      .sort((a, b) => b.totalTasks - a.totalTasks);
  }, [projectUsers, correspondences, tasks]);

`;

const kpiJsx = `
      {selectedCategory === null && employeeKPIs.length > 0 && (
        <div style={{ marginTop: 40, marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <div style={{ padding: 10, background: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6' }}>
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>{t("Team Performance KPIs")}</h2>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>{t("Workload and completion stats for active members.")}</p>
            </div>
          </div>
          <div className="card" style={{ overflowX: 'auto', padding: 0 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 14 }}>
              <thead style={{ background: 'var(--surface-3)', borderBottom: '2px solid var(--border)' }}>
                <tr>
                  <th style={{ padding: '12px 24px', color: 'var(--text-secondary)', fontWeight: 700 }}>{t("Employee")}</th>
                  <th style={{ padding: '12px 16px', color: 'var(--text-secondary)', fontWeight: 700 }}>{t("Active Corrs")}</th>
                  <th style={{ padding: '12px 16px', color: 'var(--text-secondary)', fontWeight: 700 }}>{t("Total Tasks")}</th>
                  <th style={{ padding: '12px 16px', color: 'var(--text-secondary)', fontWeight: 700 }}>{t("Completed")}</th>
                  <th style={{ padding: '12px 16px', color: 'var(--text-secondary)', fontWeight: 700 }}>{t("In Progress")}</th>
                  <th style={{ padding: '12px 16px', color: 'var(--text-secondary)', fontWeight: 700 }}>{t("Overdue")}</th>
                  <th style={{ padding: '12px 24px', color: 'var(--text-secondary)', fontWeight: 700, width: 200 }}>{t("Completion Rate")}</th>
                </tr>
              </thead>
              <tbody>
                {employeeKPIs.map((kpi, idx) => (
                  <tr key={kpi.user.id} style={{ borderBottom: '1px solid var(--border)', background: idx % 2 === 0 ? 'var(--surface)' : 'var(--surface-3)' }}>
                    <td style={{ padding: '12px 24px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        {kpi.user.photoURL ? (
                          <img src={kpi.user.photoURL} alt="" style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover' }} />
                        ) : (
                          <div style={{ width: 28, height: 28, borderRadius: '50%', background: kpi.user.userColor || getUserColor(kpi.user.id), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 12 }}>
                            {kpi.user.displayName?.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div>
                          <div style={{ fontWeight: 800, color: 'var(--text-primary)' }}>{kpi.user.displayName}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>{kpi.user.department || 'Staff'}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-secondary)' }}>{kpi.activeCorrs}</td>
                    <td style={{ padding: '12px 16px', fontWeight: 800 }}>{kpi.totalTasks}</td>
                    <td style={{ padding: '12px 16px', color: '#16a34a', fontWeight: 700 }}>{kpi.completedTasks}</td>
                    <td style={{ padding: '12px 16px', color: '#d97706', fontWeight: 700 }}>{kpi.inProgressTasks}</td>
                    <td style={{ padding: '12px 16px', color: kpi.overdueTasks > 0 ? '#dc2626' : 'var(--text-secondary)', fontWeight: kpi.overdueTasks > 0 ? 800 : 600 }}>
                      {kpi.overdueTasks > 0 && <AlertCircle className="inline w-3 h-3 mr-1" />}
                      {kpi.overdueTasks}
                    </td>
                    <td style={{ padding: '12px 24px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ flex: 1, height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ width: \`\${kpi.completionRate}%\`, height: '100%', background: kpi.completionRate === 100 ? '#16a34a' : '#3b82f6', transition: 'width 0.5s' }} />
                        </div>
                        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', minWidth: 32 }}>{kpi.completionRate}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

`;

// Inject memo
const memoTarget = "  // ─── Sub-Category Grouping for Selected Category ───────────────────────";
if (code.includes(memoTarget) && !code.includes("const employeeKPIs")) {
    code = code.replace(memoTarget, kpiMemo + memoTarget);
}

// Inject JSX
const jsxTarget = "{selectedCategory === null ? (";
if (code.includes(jsxTarget) && !code.includes("employeeKPIs.length > 0")) {
    code = code.replace(jsxTarget, kpiJsx + "      " + jsxTarget);
}

// Fix CATEGORY_COLORS.Internal missing .get() because of my script missing it
code = code.replace("CATEGORY_COLORS.Internal", "CATEGORY_COLORS.get('Internal')!");

fs.writeFileSync('src/OverviewDashboard.tsx', code);
console.log("KPIs added successfully.");
