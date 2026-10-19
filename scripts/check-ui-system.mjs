import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const walk = path => readdirSync(path, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(join(path, entry.name)) : [join(path, entry.name)]);
const files = walk('src').filter(path => /\.tsx?$/.test(path) && !path.includes('/ui/') && !path.includes('/prototypes/') && !/\.test\./.test(path));
const failures = [];
// Legacy token names predate the --rux-* namespace. Keep them out so styles and
// components cannot drift back into two parallel naming schemes.
const legacyTokens = [
  'sidebar', 'surface', 'surface-muted', 'surface-selected', 'border', 'border-strong',
  'text', 'muted', 'subtle', 'green', 'red', 'orange', 'blue',
  'radius-sm', 'radius-md', 'radius-lg', 'ui-small', 'ui-caption',
  'toolbar-height', 'pane-toolbar-height', 'composer-button-size',
  'conversation-width', 'composer-elevation', 'signature-muted',
];
for (const path of walk('src').filter(file => file.endsWith('.css'))) {
  const text = readFileSync(path, 'utf8');
  for (const token of legacyTokens) {
    if (new RegExp(`var\\(--${token}\\)|^\\s*--${token}\\s*:`, 'm').test(text)) failures.push(`${path}: use the --rux-* namespace instead of --${token}`);
  }
}
for (const path of files) {
  const text = readFileSync(path, 'utf8');
  if (/from ["'](?:@phosphor-icons\/react|radix-ui)["']/.test(text)) failures.push(`${path}: import library primitives only through src/ui`);
  if (path.endsWith(".tsx") && /<(?:button|input|select|textarea)\b/.test(text)) failures.push(`${path}: use Rux UI controls instead of local native control implementations`);
  if (/document\.addEventListener\(["'](?:pointerdown|focusin)["']/.test(text)) failures.push(`${path}: popup dismissal belongs in src/ui`);
  if (/data-tooltip=/.test(text)) failures.push(`${path}: use Rux Tooltip or IconButton`);
  const iconImports = [...text.matchAll(/import\s*\{([^}]+)\}\s*from\s*["'][^"']*ui\/icons["']/g)].flatMap(match => match[1].split(',').map(name => name.trim().split(' as ').at(-1)).filter(name => name && !name.startsWith('type ')));
  for (const name of [...iconImports, 'AppIcon', 'Icon', 'SelectedToolIcon', 'PermissionModeIcon']) {
    for (const match of text.matchAll(new RegExp(`<${name}\\b[\\s\\S]*?/>`, 'g'))) if (/size=\{\d+\}|\bweight=/.test(match[0])) failures.push(`${path}: use semantic icon sizes and variants for ${name}`);
  }
}
if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
else console.log(`Rux UI boundaries verified across ${files.length} modules`);
