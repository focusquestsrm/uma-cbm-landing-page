'use strict';

const crypto = require('crypto');
const { classifyLeadHoopResponse } = require('./leadhoop-response');
const graduationYears = require('../../../src/js/graduation-years');
const {
  currentCampaignMonth,
  getAvailabilityStore,
  readProgram,
  updateProgram
} = require('./program-availability');

const FIELD_ALLOWLIST = new Set([
  'lead[firstname]', 'lead[lastname]', 'lead[email]', 'lead[phone1]',
  'lead[service_trusted_form]', 'lead[service_leadid]', 'lead_consent[tcpa_consent]',
  'lead_education[program_id]', 'lead_education[grad_year]', 'lead_education[education_level_id]',
  'lead_address[address]', 'lead_address[city]', 'lead_address[state]', 'lead_address[zip]',
  'subid2', 'subid3', 'subid4', 'meta_event_id',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'campaign_id'
]);
const META_ATTRIBUTION_FIELDS = new Set(['subid2', 'subid3', 'subid4']);
const GRADUATION_YEAR_FIELD = 'lead_education[grad_year]';
const SERVER_FIELDS = new Set([
  'lead[media_type]', 'lead[test]', 'lead[ip]', 'lead[signup_url]', 'campaign_code',
  'lead_education[campus_id]', 'lead_education[start_date]', 'lead_background[internet_pc]'
]);
const RESPONSE_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff'
};
const DUPLICATE_WINDOW_MS = 2 * 60 * 1000;
const recentSubmissions = new Map();

let PROGRAMS = new Set();
let PROGRAM_CONFIGURATION_VALID = false;
try {
  const programData = require('../../../src/data/uma-kayla-programs.json');
  const ids = new Set();
  const orders = new Set();
  if (!Array.isArray(programData) || programData.length === 0) throw new Error('invalid');
  programData.forEach(function (program) {
    const id = String(program && program.program_id || '');
    if (!/^\d+$/.test(id) || !String(program.program_name || '').trim() || typeof program.active !== 'boolean' ||
        !Number.isInteger(program.display_order) || program.display_order < 1 || ids.has(id) || orders.has(program.display_order)) {
      throw new Error('invalid');
    }
    ids.add(id);
    orders.add(program.display_order);
    if (program.active) PROGRAMS.add(id);
  });
  PROGRAM_CONFIGURATION_VALID = PROGRAMS.size > 0;
} catch (error) {
  PROGRAMS = new Set();
}

function key(parts) {
  return parts.join('_');
}

function setting(parts) {
  return process.env[key(parts)];
}

function clean(value, limit) {
  return String(value || '').trim().slice(0, limit);
}

function reply(statusCode, body) {
  return { statusCode, headers: RESPONSE_HEADERS, body: JSON.stringify(body) };
}

function secureUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' ? parsed.toString() : '';
  } catch (error) {
    return '';
  }
}

function readConfiguration() {
  const booleans = {
    submission: setting(['LEAD', 'SUBMISSION', 'ENABLED']) || setting(['LEAD', 'SUBMISSION_ENABLED']),
    validation: setting(['LEAD', 'TEST', 'MODE']) || setting(['LEAD', 'TEST', 'FLAG']) || setting(['LEAD', 'TEST_FLAG']),
    campaign: setting(['LEADHOOP', 'CAMPAIGN', 'ENABLED'])
  };
  if (Object.values(booleans).some(function (value) { return value !== 'true' && value !== 'false'; })) return null;

  const originsValue = setting(['ALLOWED', 'ORIGINS']);
  const origins = String(originsValue || '').split(',').map(function (value) {
    try { return new URL(value.trim()).origin; } catch (error) { return ''; }
  }).filter(Boolean);

  let fixedFields;
  try {
    fixedFields = JSON.parse(setting(['LEADHOOP', 'FIXED', 'FIELDS']));
    if (!fixedFields || Array.isArray(fixedFields) || typeof fixedFields !== 'object') return null;
    if (Object.keys(fixedFields).some(function (name) { return SERVER_FIELDS.has(name); })) return null;
  } catch (error) {
    return null;
  }

  const config = {
    submissionEnabled: booleans.submission === 'true',
    validationFlag: booleans.validation === 'true',
    campaignEnabled: booleans.campaign === 'true',
    origins,
    endpoint: secureUrl(setting(['LEADHOOP', 'ENDPOINT'])),
    authorization: clean(setting(['LEADHOOP', 'AUTHORIZATION']), 1000),
    campaignCode: clean(setting(['LEADHOOP', 'CAMPAIGN', 'CODE']), 500),
    campusId: clean(setting(['LEADHOOP', 'CAMPUS', 'ID']), 100),
    signupUrl: clean(setting(['LEAD', 'SIGNUP', 'URL']), 500),
    fixedFields,
    acceptedRedirect: secureUrl(setting(['ACCEPTED', 'LEAD', 'REDIRECT', 'URL'])),
    failedRedirect: secureUrl(setting(['FAILED', 'LEAD', 'REDIRECT', 'URL']))
  };

  if (!PROGRAM_CONFIGURATION_VALID || config.origins.length === 0 || !config.endpoint || !config.authorization ||
      !config.campaignCode || !config.campusId || !config.signupUrl || !config.acceptedRedirect ||
      !config.failedRedirect) return null;
  return config;
}

function clientAddress(event) {
  const forwarded = event.headers && (event.headers['x-forwarded-for'] || event.headers['X-Forwarded-For']);
  return clean(forwarded ? forwarded.split(',')[0] : '', 64);
}

function hasAllowedOrigin(event, allowedOrigins) {
  const requestHost = clean(event.headers && (event.headers.host || event.headers.Host), 255);
  const requestOrigin = clean(event.headers && (event.headers.origin || event.headers.Origin), 500);
  if (!requestHost || !requestOrigin) return false;
  try {
    const origin = new URL(requestOrigin);
    return origin.host === requestHost && allowedOrigins.includes(origin.origin);
  } catch (error) {
    return false;
  }
}

function makePayload(event, config) {
  const inbound = new URLSearchParams(event.body || '');
  const outbound = new URLSearchParams();
  for (const [name, value] of inbound.entries()) {
    if (FIELD_ALLOWLIST.has(name)) outbound.set(name, clean(value, 500));
  }
  const programId = outbound.get('lead_education[program_id]');
  if (!PROGRAMS.has(programId) || !graduationYears.isValid(outbound.get(GRADUATION_YEAR_FIELD))) return null;

  Object.entries(config.fixedFields).forEach(function (entry) {
    if (!META_ATTRIBUTION_FIELDS.has(entry[0]) && entry[0] !== GRADUATION_YEAR_FIELD) outbound.set(entry[0], clean(entry[1], 500));
  });
  outbound.set('lead[media_type]', 'noncallcenter');
  outbound.set('lead[test]', config.validationFlag ? 'true' : 'false');
  outbound.set('lead[ip]', clientAddress(event));
  outbound.set('lead[signup_url]', config.signupUrl);
  outbound.set('campaign_code', config.campaignCode);
  outbound.set('lead_education[campus_id]', config.campusId);
  outbound.set('lead_education[start_date]', 'Immediately');
  outbound.set('lead_background[internet_pc]', 'Y');
  return outbound;
}

function submissionFingerprint(payload) {
  const fields = [
    'lead[firstname]', 'lead[lastname]', 'lead[email]', 'lead[phone1]',
    'lead_address[zip]', 'lead_education[program_id]'
  ];
  const normalized = fields.map(function (name) {
    return String(payload.get(name) || '').trim().toLowerCase();
  }).join('\u001f');
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

function reserveSubmission(payload) {
  const now = Date.now();
  for (const entry of recentSubmissions.entries()) {
    if (now - entry[1] > DUPLICATE_WINDOW_MS) recentSubmissions.delete(entry[0]);
  }
  const fingerprint = submissionFingerprint(payload);
  if (recentSubmissions.has(fingerprint)) return '';
  recentSubmissions.set(fingerprint, now);
  return fingerprint;
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: Object.assign({ Allow: 'POST' }, RESPONSE_HEADERS), body: JSON.stringify({ outcome: 'unavailable' }) };
  }

  const config = readConfiguration();
  if (!config || !hasAllowedOrigin(event, config.origins) || (event.body || '').length > 100000 ||
      !config.submissionEnabled || (!config.validationFlag && !config.campaignEnabled)) {
    return reply(503, { outcome: 'unavailable' });
  }

  const payload = makePayload(event, config);
  if (!payload) return reply(400, { outcome: 'unavailable' });

  let availabilityStore;
  try {
    availabilityStore = getAvailabilityStore();
    const availability = await readProgram(availabilityStore, payload.get('lead_education[program_id]'));
    if (availability.status !== 'available') return reply(200, { outcome: 'failed', location: config.failedRedirect });
  } catch (error) {
    console.error(JSON.stringify({ event: 'program_availability_read', completed: false }));
    return reply(503, { outcome: 'unavailable' });
  }

  const fingerprint = reserveSubmission(payload);
  if (!fingerprint) return reply(409, { outcome: 'unavailable' });

  console.info(JSON.stringify({
    event: 'compliance_presence',
    trustedForm: Boolean(payload.get('lead[service_trusted_form]')),
    leadId: Boolean(payload.get('lead[service_leadid]'))
  }));

  const controller = new AbortController();
  const timeout = setTimeout(function () { controller.abort(); }, 12000);
  try {
    const vendorResponse = await fetch(config.endpoint + '?' + payload.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: config.authorization },
      signal: controller.signal
    });
    if (!vendorResponse.ok) {
      recentSubmissions.delete(fingerprint);
      return reply(502, { outcome: 'unavailable' });
    }

    const vendorResult = await vendorResponse.json();
    const classification = classifyLeadHoopResponse(vendorResult);
    if (classification.technicalFailure) {
      recentSubmissions.delete(fingerprint);
      return reply(502, { outcome: 'unavailable' });
    }
    if (classification.accepted) return reply(200, { outcome: 'accepted', location: config.acceptedRedirect });
    if (classification.status) {
      const settings = {
        updatedBy: 'leadhoop_response',
        reasonCategory: classification.reasonCategory
      };
      if (classification.status === 'capped') settings.effectiveMonth = currentCampaignMonth();
      const statusUpdate = await updateProgram(
        availabilityStore,
        payload.get('lead_education[program_id]'),
        classification.status,
        settings
      );
      if (statusUpdate.changed) {
        console.info(JSON.stringify({
          event: 'program_status_update',
          programId: statusUpdate.record.programId,
          oldStatus: statusUpdate.oldRecord.status,
          newStatus: statusUpdate.record.status,
          timestamp: statusUpdate.record.updatedAt,
          updateSource: statusUpdate.record.updatedBy
        }));
      }
    }
    return reply(200, { outcome: 'failed', location: config.failedRedirect });
  } catch (error) {
    recentSubmissions.delete(fingerprint);
    console.error(JSON.stringify({ event: 'submission_error', completed: false }));
    return reply(502, { outcome: 'unavailable' });
  } finally {
    clearTimeout(timeout);
  }
};
