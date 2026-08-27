'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const findings = [];
const patterns = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{20,}\b/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Netlify token', /\b(?:nfp|nfpat)_[A-Za-z0-9_-]{20,}\b/i],
  ['basic-auth URL', /https?:\/\/[^\s/:]+:[^\s/@]+@/],
  ['assigned secret', /\b(?:authorization|api[_-]?key|access[_-]?token|password|admin[_-]?secret)\b\s*[:=]\s*["']([^"']{8,})["']/i],
  ['environment secret', /\b(?:AUTHORIZATION|API_KEY|ACCESS_TOKEN|PASSWORD|ADMIN_SECRET)=([^\s#]{8,})/]
];
const safeValue = /^(?:REPLACE|PLACEHOLDER|unit-test|mock|fake|example|protected|clean\(|setting\(|config\.|<|\$\{|process\.env)/i;

function inspect(line, location) {
  patterns.forEach(function (entry) {
    const match = line.match(entry[1]);
    if (!match) return;
    if ((entry[0] === 'assigned secret' || entry[0] === 'environment secret') && safeValue.test(match[1] || '')) return;
    findings.push({ category: entry[0], location });
  });
}

const history = execFileSync('git', ['log', '--all', '-p', '--no-ext-diff', '--no-textconv', '--format=commit:%H'], {
  cwd: root, encoding: 'utf8', maxBuffer: 100 * 1024 * 1024
});
let commit = '';
let file = '';
history.split(/\r?\n/).forEach(function (line) {
  if (line.startsWith('commit:')) commit = line.slice(7, 19);
  else if (line.startsWith('+++ b/')) file = line.slice(6);
  else if ((line.startsWith('+') || line.startsWith('-')) && !line.startsWith('+++') && !line.startsWith('---')) {
    inspect(line.slice(1), `${commit}:${file}`);
  }
});

function walk(directory) {
  fs.readdirSync(directory, { withFileTypes: true }).forEach(function (entry) {
    if (['.git', 'node_modules', 'source-original', '.artifacts'].includes(entry.name)) return;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(full);
    const content = fs.readFileSync(full);
    if (content.includes(0)) return;
    content.toString('utf8').split(/\r?\n/).forEach(function (line) {
      inspect(line, `working-tree:${path.relative(root, full).replace(/\\/g, '/')}`);
    });
  });
}
walk(root);

const unique = Array.from(new Map(findings.map(function (finding) {
  return [`${finding.category}:${finding.location}`, finding];
})).values());
if (unique.length) {
  unique.forEach(function (finding) { console.error(`Potential ${finding.category} at ${finding.location} (value masked)`); });
  process.exit(1);
}
console.log('Reachable Git history and working-tree secret scan passed (values never printed).');
