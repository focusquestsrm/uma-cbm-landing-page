'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '../src/js/function2.js'), 'utf8');

function storage() {
  const values = new Map();
  return {
    getItem: function (key) { return values.has(key) ? values.get(key) : null; },
    setItem: function (key, value) { values.set(key, String(value)); },
    removeItem: function (key) { values.delete(key); }
  };
}

function classList() {
  const values = new Set();
  return {
    toggle: function (name, enabled) { enabled ? values.add(name) : values.delete(name); },
    contains: function (name) { return values.has(name); }
  };
}

async function harness(fetchImplementation, overrides, sharedSessionStorage) {
  const fields = {};
  function field(id, name, value) {
    const node = {
      id, name, value: value || '', disabled: false, textContent: '', classList: classList(),
      addEventListener: function () {}, dispatchEvent: function () {}, focus: function () {}
    };
    fields[id] = node;
    return node;
  }
  field('lead_education_program_id', 'lead_education[program_id]', '227753');
  field('lead_education_grad_year', 'lead_education[grad_year]', '2023');
  field('lead_education_education_level_id', 'lead_education[education_level_id]', '2332');
  field('lead_address_address_visible', '', '123 Test Street');
  field('lead_address_address', 'lead_address[address]', '123 Test Street');
  field('lead_address_city', 'lead_address[city]', 'Tampa');
  field('lead_address_state', 'lead_address[state]', 'FL');
  field('lead_address_zip', 'lead_address[zip]', '33601');
  field('lead_firstname', 'lead[firstname]', 'Browser');
  field('lead_lastname', 'lead[lastname]', 'Review');
  field('lead_email', 'lead[email]', 'browser.review@example.invalid');
  field('lead_phone1', 'lead[phone1]', '2125550100');
  field('meta_event_id', 'meta_event_id', 'meta-event-safe');
  field('submission_id', 'submission_id', '');
  field('status-message', '', '');
  const button = field('submitButton', '', '');
  button.textContent = 'Request Info';
  Object.assign(fields, overrides || {});

  const steps = [1, 2, 3, 4].map(function (number) {
    return { dataset: { step: String(number) }, classList: classList() };
  });
  let visibleStep = steps[2];
  const handlers = {};
  const form = {
    dataset: {},
    addEventListener: function (type, listener) { handlers[type] = listener; },
    querySelectorAll: function (selector) { return selector === '.form-step[data-step]' ? steps : []; },
    querySelector: function (selector) {
      if (selector === '.form-step.is-visible') return visibleStep;
      return null;
    },
    reset: function () {},
    scrollIntoView: function () {}
  };
  const document = {
    title: 'Submission test', activeElement: null, cookie: '',
    getElementById: function (id) { return id === 'leadform' ? form : fields[id] || null; }
  };
  function MockFormData() {
    this.entries = Object.values(fields).filter(function (node) { return node.name; }).map(function (node) { return [node.name, node.value]; });
  }
  MockFormData.prototype[Symbol.iterator] = function () { return this.entries[Symbol.iterator](); };
  const assigned = [];
  const context = vm.createContext({
    document,
    location: { search: '', pathname: '/', hash: '', assign: function (value) { assigned.push(value); } },
    history: { replaceState: function () {} },
    sessionStorage: sharedSessionStorage || storage(), localStorage: storage(), URLSearchParams, FormData: MockFormData,
    CustomEvent: function () {}, Event: function () {}, Uint32Array, console,
    crypto: { randomUUID: function () { return '12345678-1234-4123-8123-123456789abc'; } },
    fetch: fetchImplementation,
    setTimeout: function (callback) { callback(); },
    UMA_GRADUATION_YEARS: { isValid: function (value) { return value === '2023'; } },
    UMA_PROGRAM_AVAILABILITY: {
      loadPrograms: async function () { return [{ program_id: '227753' }]; },
      populateSelect: function () {}, renderCards: function () {}
    }
  });
  context.window = context;
  context.window.location = context.location;
  context.window.history = context.history;
  context.window.crypto = context.crypto;
  context.window.dispatchEvent = function () {};
  vm.runInContext(source, context);
  await Promise.resolve();
  visibleStep = steps[2];
  return {
    assigned, button, fields, form,
    submit: function () { return handlers.submit({ preventDefault: function () {} }); }
  };
}

(async function () {
  let release;
  let requests = 0;
  const bodies = [];
  const locked = await harness(async function (url, options) {
    requests += 1;
    bodies.push(options.body);
    await new Promise(function (resolve) { release = resolve; });
    return { ok: true, json: async function () { return { outcome: 'accepted', location: 'https://redirect.invalid/accepted' }; } };
  });
  const oneClick = locked.submit();
  await Promise.resolve();
  assert.strictEqual(locked.button.disabled, true, 'Button was not disabled immediately');
  assert.strictEqual(locked.button.textContent, 'Submitting...');
  assert.strictEqual(locked.fields['status-message'].textContent, '', 'Successful request displayed an error before its response');
  const rapidClick = locked.submit();
  const enterPress = locked.submit();
  const repeatedEvent = locked.submit();
  assert.strictEqual(requests, 1, 'Rapid click, Enter, or repeated submit created another browser request');
  assert.strictEqual(locked.button.disabled, true);
  release();
  await Promise.all([oneClick, rapidClick, enterPress, repeatedEvent]);
  assert.strictEqual(locked.assigned[0], 'https://redirect.invalid/accepted');
  assert.strictEqual(locked.fields['status-message'].textContent, '', 'Successful response displayed the generic error');

  let retryRequests = 0;
  const retryBodies = [];
  const retryable = await harness(async function (url, options) {
    retryRequests += 1;
    retryBodies.push(options.body);
    if (retryRequests === 1) return { ok: false, json: async function () { return { outcome: 'unavailable', retryable: true }; } };
    return { ok: true, json: async function () { return { outcome: 'failed', location: 'https://redirect.invalid/failed' }; } };
  });
  await retryable.submit();
  assert.strictEqual(retryable.button.disabled, false, 'Confirmed recoverable failure permanently locked the form');
  assert.match(retryable.fields['status-message'].textContent, /try again shortly/);
  await retryable.submit();
  assert.strictEqual(retryRequests, 2);
  assert.strictEqual(new URLSearchParams(retryBodies[0]).get('submission_id'), new URLSearchParams(retryBodies[1]).get('submission_id'));
  assert.strictEqual(retryable.assigned[0], 'https://redirect.invalid/failed');

  let ambiguousRequests = 0;
  const pendingSession = storage();
  const ambiguous = await harness(async function () { ambiguousRequests += 1; throw new Error('mock network failure'); }, null, pendingSession);
  await ambiguous.submit();
  await ambiguous.submit();
  assert.strictEqual(ambiguousRequests, 1, 'Ambiguous browser failure allowed an unsafe retry');
  assert.strictEqual(ambiguous.button.disabled, true);
  assert.strictEqual(ambiguous.fields['status-message'].textContent, 'Your request is being processed. Please do not submit it again.');
  assert.doesNotMatch(ambiguous.fields['status-message'].textContent, /try again/i);
  const pendingId = ambiguous.fields.submission_id.value;
  assert.strictEqual(JSON.parse(pendingSession.getItem('umaLeadSubmissionState')).state, 'pending');

  let refreshedRequests = 0;
  const refreshed = await harness(async function () { refreshedRequests += 1; }, null, pendingSession);
  assert.strictEqual(refreshed.button.disabled, true, 'Refresh did not restore the pending lock');
  assert.strictEqual(refreshed.button.textContent, 'Processing...');
  assert.strictEqual(refreshed.fields.submission_id.value, pendingId, 'Refresh generated a new submission ID');
  assert.strictEqual(refreshed.fields['status-message'].textContent, 'Your request is being processed. Please do not submit it again.');
  await refreshed.submit();
  assert.strictEqual(refreshedRequests, 0, 'Revisited pending submission created a browser request');

  let invalidRequests = 0;
  const invalid = await harness(async function () {
    invalidRequests += 1;
    return { ok: true, json: async function () { return { outcome: 'failed', location: 'https://redirect.invalid/failed' }; } };
  }, { lead_firstname: Object.assign({
    id: 'lead_firstname', name: 'lead[firstname]', value: 'X', disabled: false, textContent: '', classList: classList(),
    addEventListener: function () {}, dispatchEvent: function () {}, focus: function () {}
  }) });
  await invalid.submit();
  assert.strictEqual(invalidRequests, 0, 'Invalid browser form reached the submission endpoint');
  assert.strictEqual(invalid.button.disabled, false, 'Validation failure locked the form');
  invalid.fields.lead_firstname.value = 'Corrected';
  await invalid.submit();
  assert.strictEqual(invalidRequests, 1, 'Corrected validation error did not submit exactly once');
  assert.strictEqual(invalid.assigned[0], 'https://redirect.invalid/failed');

  assert.strictEqual(new URLSearchParams(bodies[0]).get('submission_id'), '12345678-1234-4123-8123-123456789abc');
  console.log(JSON.stringify({
    successful: { browserRequests: requests },
    safeRetry: { browserRequests: retryRequests, submissionIds: 1 },
    ambiguous: { browserRequests: ambiguousRequests, buttonDisabled: true },
    refreshedPending: { browserRequests: refreshedRequests, submissionIdPreserved: true },
    correctedValidation: { browserRequests: invalidRequests }
  }));
})().catch(function (error) { console.error(error); process.exit(1); });
