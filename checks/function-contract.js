'use strict';

const assert = require('assert');
const availability = require('../netlify/functions/_shared/program-availability');
const submissionIdempotency = require('../netlify/functions/_shared/submission-idempotency');
const { classifyLeadHoopResponse } = require('../netlify/functions/_shared/leadhoop-response');
const graduationYears = require('../src/js/graduation-years');
const routineLogs = [];
const originalConsoleInfo = console.info;
const originalConsoleError = console.error;
console.info = function () {
  routineLogs.push(Array.from(arguments).join(' '));
  originalConsoleInfo.apply(console, arguments);
};
console.error = function () {
  routineLogs.push(Array.from(arguments).join(' '));
  originalConsoleError.apply(console, arguments);
};

class MemoryStore {
  constructor() {
    this.records = new Map(); this.getOptions = []; this.failReads = false; this.failWrites = false;
  }
  async get(key, options) {
    if (this.failReads) throw new Error('mock read failure');
    this.getOptions.push(options || {});
    return this.records.has(key) ? JSON.parse(JSON.stringify(this.records.get(key))) : null;
  }
  async setJSON(key, value) {
    if (this.failWrites) throw new Error('mock write failure');
    this.records.set(key, JSON.parse(JSON.stringify(value)));
  }
}

function env(parts, value) { process.env[parts.join('_')] = value; }
env(['LEAD', 'SUBMISSION', 'ENABLED'], 'true');
env(['LEAD', 'TEST', 'FLAG'], 'false');
env(['LEADHOOP', 'CAMPAIGN', 'ENABLED'], 'true');
env(['LEADHOOP', 'ENDPOINT'], 'https://vendor.invalid/incoming/leads');
env(['LEADHOOP', 'AUTHORIZATION'], 'protected');
env(['LEADHOOP', 'CAMPAIGN', 'CODE'], 'preserved');
env(['LEADHOOP', 'CAMPUS', 'ID'], 'preserved-campus');
env(['LEAD', 'SIGNUP', 'URL'], 'preserved-source');
env(['ACCEPTED', 'LEAD', 'REDIRECT', 'URL'], 'https://redirect.invalid/accepted');
env(['FAILED', 'LEAD', 'REDIRECT', 'URL'], 'https://redirect.invalid/failed');
env(['LEADHOOP', 'FIXED', 'FIELDS'], '{}');
env(['ALLOWED', 'ORIGINS'], 'https://uma.back2learn.com,https://back2learn-uma.netlify.app');
env(['PROGRAM', 'AVAILABILITY', 'ADMIN', 'SECRET'], 'unit-test-admin-secret');

const store = new MemoryStore();
availability.setStoreFactoryForTests(function () { return store; });
submissionIdempotency.setStoreFactoryForTests(function () { return store; });
const submit = require('../netlify/functions/_shared/submit-lead-handler').handler;
const getPrograms = require('../netlify/functions/_shared/get-program-availability-handler').handler;
const managePrograms = require('../netlify/functions/_shared/manage-program-availability-handler').handler;

let eventSequence = 0;
function leadEvent(programId, overrides) {
  eventSequence += 1;
  const submissionId = 'submission-' + String(eventSequence).padStart(6, '0') + '-' + Math.random().toString(36).slice(2, 12);
  const fields = Object.assign({
    'lead[firstname]': 'Unit', 'lead[lastname]': 'Review',
    'lead[email]': `unit-${eventSequence}@example.invalid`,
    'lead[phone1]': `212555${String(1000 + eventSequence).slice(-4)}`,
    'lead[test]': 'true', 'lead[service_trusted_form]': 'certificate-value',
    'lead[service_leadid]': 'leadid-value',
    'lead_education[program_id]': programId,
    'lead_education[education_level_id]': '2332',
    'lead_education[grad_year]': '2023',
    'lead_address[address]': '123 Main St',
    'lead_address[city]': 'Birmingham',
    'lead_address[state]': 'AL',
    'lead_address[zip]': '35203',
    'lead_consent[tcpa_consent]': 'Y',
    submission_id: submissionId,
    subid2: 'fb.1.1111111111.TESTFBC', subid3: 'fb.1.2222222222.TESTFBP', subid4: 'TEST-FBCLID-3333',
    unexpected: 'must-not-pass'
  }, overrides || {});
  return {
    httpMethod: 'POST',
    headers: { host: 'uma.back2learn.com', origin: 'https://uma.back2learn.com', 'x-forwarded-for': '192.0.2.10' },
    body: new URLSearchParams(fields).toString()
  };
}

function vendorResult(result) {
  return async function (url, init) {
    vendorResult.lastUrl = String(url);
    vendorResult.lastMethod = init && init.method ? String(init.method) : 'GET';
    vendorResult.lastHeaders = init && init.headers ? Object.assign({}, init.headers) : {};
    vendorResult.lastBody = init && init.body ? String(init.body) : '';
    return { ok: true, json: async function () { return result; } };
  };
}

function adminEvent(body, secret) {
  return { httpMethod: 'POST', headers: { authorization: `Bearer ${secret || 'unit-test-admin-secret'}` }, body: JSON.stringify(body) };
}

(async function () {
  const initialized = await availability.readAllPrograms(store, new Date('2026-08-26T12:00:00Z'));
  assert.deepStrictEqual(initialized.map(function (record) { return record.programId; }), ['227753', '227754', '227755', '227756']);
  assert(initialized.every(function (record) { return record.status === 'available' && record.updatedBy === 'initialization'; }));
  assert(store.getOptions.every(function (options) { return options.consistency === 'strong'; }));

  const legacyNameRecord = {
    campaign: 'uma-health',
    programId: '227753',
    programName: 'A.A.S. – Health and Human Services',
    status: 'available',
    reasonCategory: null,
    effectiveMonth: null,
    updatedAt: '2026-08-26T12:00:00Z',
    updatedBy: 'initialization'
  };
  await store.setJSON('uma-health:227753', legacyNameRecord);
  const repaired = await availability.readProgram(store, '227753', new Date('2026-08-26T12:15:00Z'));
  assert.strictEqual(repaired.programName, 'A.A.S. – Health and Human Services');
  assert.strictEqual(availability.publicAvailablePrograms([repaired]).at(0).display_name, 'Health and Human Services');

  global.fetch = vendorResult({ status: 'success' });
  const accepted = await submit(leadEvent('227753'));
  assert.strictEqual(accepted.statusCode, 200);
  assert.deepStrictEqual(JSON.parse(accepted.body), { outcome: 'accepted', location: 'https://redirect.invalid/accepted' });
  assert.strictEqual(vendorResult.lastMethod, 'POST');
  assert.strictEqual(vendorResult.lastHeaders['Content-Type'], 'application/x-www-form-urlencoded; charset=UTF-8');
  const postedPayload = new URLSearchParams(vendorResult.lastBody);
  assert.strictEqual(postedPayload.get('campaign_code'), 'preserved');
  assert.strictEqual(postedPayload.get('lead[firstname]'), 'Unit');
  assert.strictEqual(postedPayload.get('lead[lastname]'), 'Review');
  assert.strictEqual(postedPayload.get('lead[phone1]'), '2125551001');
  assert.strictEqual(postedPayload.get('lead[email]'), 'unit-1@example.invalid');
  assert.strictEqual(postedPayload.get('lead_education[program_id]'), '227753');
  assert.strictEqual(postedPayload.get('lead_education[campus_id]'), 'preserved-campus');
  assert.strictEqual(postedPayload.get('lead_education[grad_year]'), '2023');
  assert.strictEqual(postedPayload.get('lead_background[internet_pc]'), 'Y');
  assert.strictEqual(postedPayload.get('lead_consent[tcpa_consent]'), 'Y');
  assert.strictEqual(postedPayload.get('lead[service_leadid]'), 'leadid-value');
  assert.strictEqual(postedPayload.get('lead[test]'), 'false');
  assert.strictEqual(postedPayload.get('lead[media_type]'), 'noncallcenter');
  assert.strictEqual(postedPayload.get('lead_education[education_level_id]'), '2332');
  assert.strictEqual(postedPayload.get('lead_address[address]'), '123 Main St');
  assert.strictEqual(postedPayload.get('lead_address[city]'), 'Birmingham');
  assert.strictEqual(postedPayload.get('lead_address[state]'), 'AL');
  assert.strictEqual(postedPayload.get('lead_address[zip]'), '35203');
  assert.doesNotMatch(vendorResult.lastBody, /lead%5Btest%5D=true|unexpected=/);
  const attributionPayload = postedPayload;
  assert.strictEqual(attributionPayload.get('subid2'), 'fb.1.1111111111.TESTFBC');
  assert.strictEqual(attributionPayload.get('subid3'), 'fb.1.2222222222.TESTFBP');
  assert.strictEqual(attributionPayload.get('subid4'), 'TEST-FBCLID-3333');

  env(['LEADHOOP', 'FIXED', 'FIELDS'], JSON.stringify({
    subid2: 'must-not-overwrite-fbc', subid3: 'must-not-overwrite-fbp', subid4: 'must-not-overwrite-fbclid',
    'lead_education[grad_year]': '1996'
  }));
  global.fetch = vendorResult({ status: 'success' });
  const protectedAttribution = await submit(leadEvent('227753'));
  assert.strictEqual(protectedAttribution.statusCode, 200);
  const protectedPayload = new URLSearchParams(vendorResult.lastBody);
  assert.strictEqual(protectedPayload.get('subid2'), 'fb.1.1111111111.TESTFBC');
  assert.strictEqual(protectedPayload.get('subid3'), 'fb.1.2222222222.TESTFBP');
  assert.strictEqual(protectedPayload.get('subid4'), 'TEST-FBCLID-3333');
  assert.strictEqual(protectedPayload.get('lead_education[grad_year]'), '2023');
  env(['LEADHOOP', 'FIXED', 'FIELDS'], '{}');

  global.fetch = vendorResult({ status: 'success' });
  const minimumYear = await submit(leadEvent('227753', { 'lead_education[grad_year]': '1996' }));
  assert.strictEqual(minimumYear.statusCode, 200);
  assert.strictEqual(new URLSearchParams(vendorResult.lastBody).get('lead_education[grad_year]'), '1996');

  let blockedVendorCalls = 0;
  global.fetch = async function () { blockedVendorCalls += 1; throw new Error('Invalid graduation year reached vendor'); };
  for (const invalidYear of ['1995', '2024', '', '2023.0', '2022.5', 'not-a-year']) {
    assert.strictEqual((await submit(leadEvent('227753', { 'lead_education[grad_year]': invalidYear }))).statusCode, 400);
  }
  assert.strictEqual(blockedVendorCalls, 0, 'Invalid graduation year reached LeadHoop');

  global.fetch = vendorResult({ status: 'failure', reason: { base: ['Not eligible'] } });
  const generalFailure = await submit(leadEvent('227753'));
  assert.deepStrictEqual(JSON.parse(generalFailure.body), { outcome: 'failed', location: 'https://redirect.invalid/failed' });
  assert.strictEqual((await availability.readProgram(store, '227753')).status, 'available');

  global.fetch = vendorResult({ status: 'failure', reason: { base: ['Reached the monthly offer cap for program.'] } });
  const offerCap = await submit(leadEvent('227754'));
  assert.strictEqual(JSON.parse(offerCap.body).outcome, 'failed');
  let record = await availability.readProgram(store, '227754');
  assert.strictEqual(record.status, 'capped');
  assert.strictEqual(record.reasonCategory, 'monthly_offer_cap');

  global.fetch = vendorResult({ status: 'failure', reason_code: 'monthly_campaign_cap' });
  await submit(leadEvent('227755'));
  record = await availability.readProgram(store, '227755');
  assert.strictEqual(record.status, 'capped');
  assert.strictEqual(record.reasonCategory, 'monthly_campaign_cap');

  global.fetch = vendorResult({ status: 'failure', errors: ['Program is inactivated'] });
  await submit(leadEvent('227756'));
  record = await availability.readProgram(store, '227756');
  assert.strictEqual(record.status, 'inactive');
  assert.strictEqual(record.reasonCategory, 'program_inactive');

  assert.strictEqual(classifyLeadHoopResponse({ status: 'failure', reasons: ['Reached the monthly offer cap for program', 'Program unavailable'] }).status, 'inactive');
  assert.strictEqual(classifyLeadHoopResponse({ status: 'failure' }).status, null);
  assert.strictEqual(classifyLeadHoopResponse({ reason: 'missing status' }).technicalFailure, true);
  const idempotent = await availability.updateProgram(store, '227756', 'inactive', { updatedBy: 'leadhoop_response', reasonCategory: 'program_inactive' });
  assert.strictEqual(idempotent.changed, false);

  const unavailableAttempt = await submit(leadEvent('227756'));
  assert.deepStrictEqual(JSON.parse(unavailableAttempt.body), { outcome: 'failed', location: 'https://redirect.invalid/failed' });
  assert.strictEqual((await submit(leadEvent('999999'))).statusCode, 400);

  await availability.updateProgram(store, '227753', 'available', { updatedBy: 'authorized_admin' });
  global.fetch = vendorResult({ unexpected: true });
  assert.strictEqual((await submit(leadEvent('227753'))).statusCode, 502);
  global.fetch = async function () { throw new Error('mock timeout'); };
  assert.strictEqual((await submit(leadEvent('227753'))).statusCode, 502);

  store.failReads = true;
  assert.strictEqual((await submit(leadEvent('227753'))).statusCode, 503);
  store.failReads = false;
  global.fetch = vendorResult({ status: 'failure', reason: { base: ['Reached the monthly offer cap for program'] } });
  store.failWrites = true;
  assert.strictEqual((await submit(leadEvent('227753'))).statusCode, 502);
  store.failWrites = false;

  await availability.updateProgram(store, '227754', 'capped', {
    updatedBy: 'authorized_admin', reasonCategory: 'monthly_offer_cap', effectiveMonth: '2026-07', now: new Date('2026-07-01T12:00:00Z')
  });
  const restored = await availability.restoreExpiredCaps(store, new Date('2026-08-01T04:30:00Z'));
  assert(restored.includes('227754'));
  assert.strictEqual((await availability.readProgram(store, '227754')).status, 'available');
  assert.strictEqual((await availability.readProgram(store, '227756')).status, 'inactive');
  assert.deepStrictEqual(await availability.restoreExpiredCaps(store, new Date('2026-08-02T04:30:00Z')), []);

  assert.strictEqual((await managePrograms(adminEvent({ action: 'get', campaign: 'uma-health', programId: '227753' }, 'wrong-secret'))).statusCode, 401);
  assert.strictEqual((await managePrograms(adminEvent({ action: 'set', campaign: 'other-campaign', programId: '227753', status: 'inactive' }))).statusCode, 400);
  assert.strictEqual((await managePrograms(adminEvent({ action: 'set', campaign: 'uma-health', programId: '227753', status: 'inactive' }))).statusCode, 200);
  assert.strictEqual((await managePrograms(adminEvent({ action: 'set', campaign: 'uma-health', programId: '227753', status: 'available' }))).statusCode, 200);

  const visitorPrograms = await getPrograms({ httpMethod: 'GET' });
  const visitorBody = JSON.parse(visitorPrograms.body);
  assert.strictEqual(visitorPrograms.statusCode, 200);
  assert.deepStrictEqual(visitorBody.programs.map(function (program) { return program.program_id; }), ['227753', '227754']);
  assert(!JSON.stringify(visitorBody).includes('reasonCategory'));
  store.failReads = true;
  assert.strictEqual((await getPrograms({ httpMethod: 'GET' })).statusCode, 503);
  store.failReads = false;

  for (const program of availability.APPROVED_PROGRAMS) {
    await availability.updateProgram(store, program.programId, 'available', { updatedBy: 'authorized_admin' });
  }
  const visitorEntry = await import('../netlify/functions/get-program-availability.mjs');
  const visitorResponse = await visitorEntry.default(new Request('https://uma.back2learn.com/.netlify/functions/get-program-availability'));
  assert.strictEqual(visitorResponse.status, 200);
  assert.strictEqual((await visitorResponse.json()).programs.length, 4);
  const submitEntry = await import('../netlify/functions/submit-lead.mjs');
  assert.strictEqual((await submitEntry.default(new Request('https://uma.back2learn.com/.netlify/functions/submit-lead'))).status, 405);

  const loggedOutput = routineLogs.join('\n');
  ['TESTFBC', 'TESTFBP', 'TEST-FBCLID-3333', 'unit-', '212555'].forEach(function (sensitiveValue) {
    assert(!loggedOutput.includes(sensitiveValue), `Routine logs exposed ${sensitiveValue}`);
  });

  console.log('Function, availability, response, reset, and management contracts passed.');
})().catch(function (error) { console.error(error); process.exit(1); });
