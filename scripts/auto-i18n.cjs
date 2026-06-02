const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'src');

function processFile(filePath) {
    if (!filePath.endsWith('.tsx') && !filePath.endsWith('.ts')) return;
    
    let content = fs.readFileSync(filePath, 'utf8');
    let original = content;

    // 1. Add import if not present
    if (content.includes('t(') || content.match(/>[^<{}]*[a-zA-Z]+[^<{}]*<\//)) {
        if (!content.includes("useTranslation")) {
            content = content.replace(
                /import React([^;]*);/,
                "import React$1;\nimport { useTranslation } from 'react-i18next';"
            );
        }
        
        // 2. Add useTranslation hook inside the default export component
        if (!content.includes("const { t } = useTranslation();")) {
            content = content.replace(
                /export default function ([A-Za-z0-9_]+)\(([^)]*)\) \{/,
                "export default function $1($2) {\n  const { t } = useTranslation();"
            );
        }
    }

    // 3. Replace JSX Text > text <
    // We only want to replace if there is at least one letter, and no forbidden characters.
    const jsxTextRegex = />([^<{}]+)</g;
    content = content.replace(jsxTextRegex, (match, p1) => {
        const trimmed = p1.trim();
        if (trimmed.length > 0 && /[a-zA-Z]/.test(trimmed)) {
            // Escape single quotes for the translation key
            const escaped = trimmed.replace(/'/g, "\\'");
            // Preserve surrounding whitespace
            const leading = p1.substring(0, p1.indexOf(trimmed));
            const trailing = p1.substring(p1.indexOf(trimmed) + trimmed.length);
            
            // Check if it's already translated or just variable interpolation
            if (trimmed.startsWith('{') || trimmed.includes('t(')) {
                 return match;
            }
            
            return `>${leading}{t('${escaped}')}${trailing}<`;
        }
        return match;
    });

    // 4. Replace string literal attributes like placeholder="Something"
    // Be careful not to replace className or type
    const placeholderRegex = /placeholder="([^"]*[a-zA-Z]+[^"]*)"/g;
    content = content.replace(placeholderRegex, (match, p1) => {
        if (p1.startsWith('{') || p1.includes('t(')) return match;
        const escaped = p1.replace(/'/g, "\\'");
        return `placeholder={t('${escaped}')}`;
    });

    const titleRegex = /title="([^"]*[a-zA-Z]+[^"]*)"/g;
    content = content.replace(titleRegex, (match, p1) => {
        if (p1.startsWith('{') || p1.includes('t(')) return match;
        const escaped = p1.replace(/'/g, "\\'");
        return `title={t('${escaped}')}`;
    });

    if (content !== original) {
        console.log(`Updated ${path.basename(filePath)}`);
        fs.writeFileSync(filePath, content, 'utf8');
    }
}

function walkDir(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            walkDir(fullPath);
        } else {
            processFile(fullPath);
        }
    }
}

walkDir(srcDir);
console.log("Auto i18n complete.");
