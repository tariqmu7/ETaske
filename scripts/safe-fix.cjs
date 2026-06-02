const fs = require('fs');

function replaceSafe(filePath) {
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Normalize to LF for easy replacing
    content = content.replace(/\r\n/g, '\n');

    content = content.replace(
        "const map: Record<string, string | undefined> = {};\n    projectUsers.forEach(u => { map[u.id] = u.department; });",
        "const map = new Map<string, string | undefined>();\n    projectUsers.forEach(u => { map.set(u.id, u.department); });"
    );

    content = content.replace(
        "departmentByUserId[i.userId] ===",
        "departmentByUserId.get(i.userId) ==="
    );
    
    content = content.replace(
        "departmentByUserId[c.userId] ===",
        "departmentByUserId.get(c.userId) ==="
    );

    fs.writeFileSync(filePath, content, 'utf8');
}

replaceSafe('src/CorrespondingsDashboard.tsx');
replaceSafe('src/ManagerInbox.tsx');
console.log('Fixed');
