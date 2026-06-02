const fs = require('fs');

function fixPrototypePollution(filePath) {
    let content = fs.readFileSync(filePath, 'utf8');
    
    const target = `  const departmentByUserId = useMemo(() => {
    const map: Record<string, string | undefined> = {};
    projectUsers.forEach(u => { map[u.id] = u.department; });
    return map;
  }, [projectUsers]);`;

    const replacement = `  const departmentByUserId = useMemo(() => {
    const map = new Map<string, string | undefined>();
    projectUsers.forEach(u => { map.set(u.id, u.department); });
    return map;
  }, [projectUsers]);`;

    content = content.replace(target, replacement);
    
    // Also fix the usage of it
    content = content.replace('departmentByUserId[i.userId] ===', 'departmentByUserId.get(i.userId) ===');
    content = content.replace('departmentByUserId[c.userId] ===', 'departmentByUserId.get(c.userId) ===');

    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Fixed ${filePath}`);
}

fixPrototypePollution('src/CorrespondingsDashboard.tsx');
fixPrototypePollution('src/ManagerInbox.tsx');
