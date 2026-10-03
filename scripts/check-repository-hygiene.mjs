import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

function tracked(pathspec) {
  return execFileSync('git', ['ls-files', '-z', '--', pathspec], { encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
}

const forbiddenTracked = [
  ...tracked('audit-evidence/**'),
  ...tracked('docs/audit/**'),
  ...tracked('dist/**'),
  ...tracked('node_modules/**'),
];
if (forbiddenTracked.length > 0) {
  console.error(`Repository hygiene failed; generated or audit files are tracked:\n${forbiddenTracked.join('\n')}`);
  process.exit(1);
}

const gitignore = readFileSync('.gitignore', 'utf8');
if (!/(^|\n)\/audit-evidence\/(?:\n|$)/.test(gitignore)) {
  console.error('Repository hygiene failed: /audit-evidence/ is not ignored');
  process.exit(1);
}

console.log(JSON.stringify({
  trackedForbiddenFiles: 0,
  auditEvidenceIgnored: true,
}));
