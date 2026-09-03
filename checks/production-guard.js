'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const publicFiles = [
  'src/index.html',
  'src/programs/connect/form-update-health.html',
  'src/css/styles.css',
  'src/js/function2.js',
  'src/js/program-availability.js',
  'src/js/graduation-years.js',
  'src/js/google-places.js',
  'src/js/meta-pixel.js',
  'src/js/runtime-config.js'
];
const publicSource = publicFiles.map(function (file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}).join('\n');
const functionSource = fs.readFileSync(path.join(root, 'netlify/functions/_shared/submit-lead-handler.js'), 'utf8');
const protectedNames = [
  ['LEAD', 'SUBMISSION', 'ENABLED'],
  ['LEAD', 'TEST', 'FLAG'],
  ['LEADHOOP', 'CAMPAIGN', 'ENABLED']
].map(function (parts) { return parts.join('_'); });
const htmlSource = publicFiles.filter(function (file) { return file.endsWith('.html'); }).map(function (file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
});
const jornayaCampaignId = '0acacf7c-5b02-c01b-61cd-3ded286da6ec';
const allowedBack2LearnFooter = /href="https:\/\/www\.back2learn\.com\/"[^>]*class="footer-brand"/i.test(publicSource);

const checks = [
  ['visitor language', !/\b(?:testing|demo|staging|preview|sandbox|development|qa)\b/i.test(publicSource)],
  ['browser mode control', !/lead\[test\]|submissionEnabled|validationFlag/i.test(publicSource)],
  ['direct vendor submission', !/back2learn-post\.leadhoop\.com/i.test(publicSource)],
  ['same-site submission', /\/\.netlify\/functions\/submit-lead/.test(publicSource)],
  ['same-site availability', /\/\.netlify\/functions\/get-program-availability/.test(publicSource)],
  ['Fallon availability removed', !/b2l-program-availability\.edu-matcher\.com/i.test(publicSource + functionSource)],
  ['indexing enabled', !/noindex|nofollow/i.test(publicSource)],
  ['no production domain references', !/uma\.back2learn\.com|back2learn-uma\.netlify\.app/i.test(publicSource) && (!/back2learn\.com/i.test(publicSource) || allowedBack2LearnFooter)],
  ['public metadata uses relative URLs', !/property="og:url" content="https?:\/\//i.test(publicSource) && !/rel="canonical" href="https?:\/\//i.test(publicSource)],
  ['TrustedForm session script', /api\.trustedform\.com\/trustedform\.js/.test(publicSource)],
  ['Back2Learn Jornaya campaign', htmlSource.every(function (source) {
    return source.includes(`https://create.lidstatic.com/campaign/${jornayaCampaignId}.js?snippet_version=2`);
  })],
  ['one Jornaya campaign script per page', htmlSource.every(function (source) {
    return (source.match(/id="LeadiDscript_campaign"|s\.id = 'LeadiDscript_campaign'/g) || []).length === 1 &&
      (source.match(/create\.lidstatic\.com\/campaign\//g) || []).length === 1;
  })],
  ['Meta pixel disabled until configured', !/3178962768924361|fbq\(\s*'init'\s*,\s*['"][0-9]{10,}['"]/.test(publicSource)],
  ['Meta Lead gated by accepted outcome', /result\.outcome === 'accepted'[\s\S]*UMA_META\.fireLead/.test(publicSource)],
  ['Google key not hardcoded', !/AIza[0-9A-Za-z_-]{20,}/.test(publicSource)],
  ['Google Places restricted to US', /componentRestrictions:\s*\{\s*country:\s*'us'\s*\}/.test(publicSource)],
  ['separate redirect configuration', /acceptedRedirect[\s\S]*failedRedirect/.test(functionSource)],
  ['server classification', /outbound\.set\('lead\[test\]'/.test(functionSource)],
  ['client duplicate lock', /submissionInProgress/.test(publicSource)],
  ['server duplicate window', /reserveSubmission/.test(functionSource)],
  ['protected environment names', protectedNames.every(function (name) { return !functionSource.includes(name); })],
  ['routing value absent from browser', !/campaign_code|lead_education\[campus_id\]|trkhoop\.com\/redirects\//.test(publicSource)]
];

const failed = checks.filter(function (entry) { return !entry[1]; });
if (failed.length) {
  failed.forEach(function (entry) { console.error('FAILED:', entry[0]); });
  process.exit(1);
}

console.log('Production guard passed.');
