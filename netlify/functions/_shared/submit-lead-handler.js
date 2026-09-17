'use strict';

const { classifyLeadHoopResponse } = require('./leadhoop-response');
const graduationYears = require('../../../src/js/graduation-years');
const {
  completeSubmission,
  getSubmissionStore,
  reserveSubmission,
  responseForDuplicate,
  validSubmissionId
} = require('./submission-idempotency');
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
  'subid2', 'subid3', 'subid4', 'meta_event_id', 'submission_id',
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
const LEADHOOP_TIMEOUT_MS = 25 * 1000;
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

function setting(parts, aliases) {
  const keys = [key(parts)];
  if (Array.isArray(aliases)) {
    aliases.forEach(function (alias) {
      keys.push(key(alias));
    });
  }
  for (const environmentKey of keys) {
    if (environmentKey in process.env) return process.env[environmentKey];
  }
  return undefined;
}

function clean(value, limit) {
  return String(value || '').trim().slice(0, limit);
}

function reply(statusCode, body) {
  return { statusCode, headers: RESPONSE_HEADERS, body: JSON.stringify(body) };
}

function unavailableResponse(code) {
  return reply(503, { outcome: 'unavailable', retryable: true, diagnosticCode: code });
}

function logUnavailable(code) {
  console.info(JSON.stringify({ event: 'submit_lead_unavailable', diagnosticCode: code }));
}

function logConfigValidation(issues) {
  console.info(JSON.stringify({ event: 'read_configuration_failed', issues }));
}

function secureUrl(value) {
  try {
    const parsed = new URL(value);
    const isLeadHoopPostEndpoint = parsed.hostname === 'back2learn-post.leadhoop.com' && parsed.pathname === '/incoming/leads';
    if (parsed.protocol === 'https:' || (parsed.protocol === 'http:' && isLeadHoopPostEndpoint)) {
      return parsed.toString();
    }
    return '';
  } catch (error) {
    return '';
  }
}

function readConfiguration() {
  const issues = [];
  const booleans = {
    submission: setting(['LEAD', 'SUBMISSION', 'ENABLED']),
    validation: setting(['LEAD', 'TEST', 'FLAG'], [['LEAD', 'TEST', 'MODE']]),
    campaign: setting(['LEADHOOP', 'CAMPAIGN', 'ENABLED'], [['LEADHOOP', 'CAMPAIGN', 'ACTIVE']])
  };
  if (booleans.submission !== 'true' && booleans.submission !== 'false') {
    issues.push({ setting: 'LEAD_SUBMISSION_ENABLED', reason: booleans.submission == null ? 'missing' : 'invalid_boolean' });
  }
  if (booleans.validation !== 'true' && booleans.validation !== 'false') {
    issues.push({ setting: 'LEAD_TEST_FLAG', reason: booleans.validation == null ? 'missing' : 'invalid_boolean' });
  }
  if (booleans.campaign !== 'true' && booleans.campaign !== 'false') {
    issues.push({ setting: 'LEADHOOP_CAMPAIGN_ENABLED', reason: booleans.campaign == null ? 'missing' : 'invalid_boolean' });
  }

  const originsValue = setting(['ALLOWED', 'ORIGINS']);
  const origins = String(originsValue || '').split(',').map(function (value) {
    try { return new URL(value.trim()).origin; } catch (error) { return ''; }
  }).filter(Boolean);
  if (!originsValue || origins.length === 0) {
    issues.push({ setting: 'ALLOWED_ORIGINS', reason: !originsValue ? 'missing' : 'empty_or_invalid' });
  }

  let fixedFields;
  try {
    fixedFields = JSON.parse(setting(['LEADHOOP', 'FIXED', 'FIELDS']));
    if (!fixedFields || Array.isArray(fixedFields) || typeof fixedFields !== 'object') {
      issues.push({ setting: 'LEADHOOP_FIXED_FIELDS', reason: 'invalid_json' });
    }
    if (fixedFields && Object.keys(fixedFields).some(function (name) { return SERVER_FIELDS.has(name); })) {
      issues.push({ setting: 'LEADHOOP_FIXED_FIELDS', reason: 'reserved_field' });
    }
  } catch (error) {
    issues.push({ setting: 'LEADHOOP_FIXED_FIELDS', reason: 'invalid_json' });
  }

  const endpointValue = setting(['LEADHOOP', 'ENDPOINT'], [['LEADHOOP', 'POST', 'URL']]);
  const endpoint = secureUrl(endpointValue);
  if (!endpoint) {
    issues.push({ setting: 'LEADHOOP_ENDPOINT', reason: endpointValue ? 'invalid_url' : 'missing' });
  }

  const campaignCode = clean(setting(['LEADHOOP', 'CAMPAIGN', 'CODE']), 500);
  if (!campaignCode) {
    issues.push({ setting: 'LEADHOOP_CAMPAIGN_CODE', reason: 'missing' });
  }

  const campusId = clean(setting(['LEADHOOP', 'CAMPUS', 'ID']), 100);
  if (!campusId) {
    issues.push({ setting: 'LEADHOOP_CAMPUS_ID', reason: 'missing' });
  }

  const signupUrl = clean(setting(['LEAD', 'SIGNUP', 'URL']), 500);
  if (!signupUrl) {
    issues.push({ setting: 'LEAD_SIGNUP_URL', reason: 'missing' });
  }

  const acceptedRedirect = secureUrl(setting(['ACCEPTED', 'LEAD', 'REDIRECT', 'URL'], [['ACCEPTED', 'REDIRECT', 'URL']])) || secureUrl(setting(['ACCEPTED', 'REDIRECT', 'URL']));
  if (!acceptedRedirect) {
    issues.push({ setting: 'ACCEPTED_LEAD_REDIRECT_URL', reason: 'missing_or_invalid_url' });
  }

  const failedRedirect = secureUrl(setting(['FAILED', 'LEAD', 'REDIRECT', 'URL'], [['FAILED', 'REDIRECT', 'URL']])) || secureUrl(setting(['FAILED', 'REDIRECT', 'URL']));
  if (!failedRedirect) {
    issues.push({ setting: 'FAILED_LEAD_REDIRECT_URL', reason: 'missing_or_invalid_url' });
  }

  if (!PROGRAM_CONFIGURATION_VALID) {
    issues.push({ setting: 'PROGRAM_CONFIGURATION', reason: 'invalid_program_data' });
  }

  const config = {
    submissionEnabled: booleans.submission === 'true',
    validationFlag: booleans.validation === 'true',
    campaignEnabled: booleans.campaign === 'true',
    origins,
    endpoint,
    campaignCode,
    campusId,
    signupUrl,
    fixedFields,
    acceptedRedirect,
    failedRedirect
  };

  if (issues.length > 0) {
    logConfigValidation(issues);
    return null;
  }

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
  outbound.set('lead_consent[tcpa_consent]', 'Y');
  outbound.set('lead_background[internet_pc]', 'Y');
  return outbound;
}

function requestIdentifier(event) {
  return clean(event.headers && (event.headers['x-nf-request-id'] || event.headers['X-Nf-Request-Id']), 100);
}

function leadHoopResponseIdentifier(result) {
  const candidates = [
    result && result.lead_id,
    result && result.leadId,
    result && result.id,
    result && result.data && result.data.lead_id,
    result && result.data && result.data.id
  ];
  const value = clean(candidates.find(Boolean), 100);
  return /^[A-Za-z0-9._:-]+$/.test(value) ? value : null;
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: Object.assign({ Allow: 'POST' }, RESPONSE_HEADERS), body: JSON.stringify({ outcome: 'unavailable' }) };
  }

  const config = readConfiguration();
  if (!config) {
    logUnavailable('503_CONFIG_INVALID');
    return unavailableResponse('503_CONFIG_INVALID');
  }
  if (!hasAllowedOrigin(event, config.origins)) {
    logUnavailable('503_ORIGIN_REJECTED');
    return unavailableResponse('503_ORIGIN_REJECTED');
  }
  if ((event.body || '').length > 100000) {
    logUnavailable('503_BODY_TOO_LARGE');
    return unavailableResponse('503_BODY_TOO_LARGE');
  }
  if (!config.submissionEnabled) {
    logUnavailable('503_SUBMISSION_DISABLED');
    return unavailableResponse('503_SUBMISSION_DISABLED');
  }
  if (!config.validationFlag && !config.campaignEnabled) {
    logUnavailable('503_CAMPAIGN_DISABLED');
    return unavailableResponse('503_CAMPAIGN_DISABLED');
  }

  const payload = makePayload(event, config);
  if (!payload) return reply(400, { outcome: 'unavailable', retryable: true });
  const submissionId = new URLSearchParams(event.body || '').get('submission_id');
  if (!validSubmissionId(submissionId)) return reply(400, { outcome: 'unavailable', retryable: true });
  const functionRequestId = requestIdentifier(event);

  let availabilityStore;
  try {
    availabilityStore = getAvailabilityStore();
    const availability = await readProgram(availabilityStore, payload.get('lead_education[program_id]'));
    if (availability.status !== 'available') return reply(200, { outcome: 'failed', location: config.failedRedirect });
  } catch (error) {
    console.error(JSON.stringify({ event: 'program_availability_read', submissionId, functionRequestId, completed: false }));
    return unavailableResponse('503_PROGRAM_AVAILABILITY_READ');
  }

  let submissionStore;
  let reservation;
  try {
    submissionStore = getSubmissionStore();
    reservation = await reserveSubmission(submissionStore, submissionId, functionRequestId);
  } catch (error) {
    console.error(JSON.stringify({ event: 'idempotency_reservation', submissionId, functionRequestId, completed: false }));
    return unavailableResponse('503_IDEMPOTENCY_RESERVATION');
  }
  if (!reservation.owner) {
    const duplicate = responseForDuplicate(reservation.record);
    console.info(JSON.stringify({
      event: 'duplicate_submission', submissionId, functionRequestId,
      priorState: reservation.record && reservation.record.state || 'processing', outboundRequests: 0
    }));
    return reply(duplicate.statusCode, duplicate.body);
  }

  console.info(JSON.stringify({
    event: 'compliance_presence',
    submissionId,
    functionRequestId,
    campaignCode: config.campaignCode,
    trustedForm: Boolean(payload.get('lead[service_trusted_form]')),
    leadId: Boolean(payload.get('lead[service_leadid]'))
  }));

  const controller = new AbortController();
  const timeout = setTimeout(function () { controller.abort(); }, LEADHOOP_TIMEOUT_MS);
  try {
    console.info(JSON.stringify({ event: 'leadhoop_request', submissionId, functionRequestId, campaignCode: config.campaignCode, outboundRequest: 1 }));
    const vendorResponse = await fetch(config.endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
      },
      body: payload.toString(),
      signal: controller.signal
    });
    if (!vendorResponse.ok) {
      const response = { outcome: 'unavailable', retryable: false };
      await completeSubmission(submissionStore, reservation, 'ambiguous', response);
      console.error(JSON.stringify({
        event: 'leadhoop_response', submissionId, functionRequestId, campaignCode: config.campaignCode,
        httpStatus: vendorResponse.status || null, leadHoopResponseId: null, accepted: null, outboundRequests: 1
      }));
      return reply(502, response);
    }

    const vendorResult = await vendorResponse.json();
    const classification = classifyLeadHoopResponse(vendorResult);
    const leadHoopResponseId = leadHoopResponseIdentifier(vendorResult);
    if (classification.technicalFailure) {
      const response = { outcome: 'unavailable', retryable: false };
      await completeSubmission(submissionStore, reservation, 'ambiguous', response);
      console.error(JSON.stringify({
        event: 'leadhoop_response', submissionId, functionRequestId, campaignCode: config.campaignCode,
        httpStatus: vendorResponse.status || null, leadHoopResponseId, accepted: false, outboundRequests: 1
      }));
      return reply(502, response);
    }
    if (classification.accepted) {
      const response = { outcome: 'accepted', location: config.acceptedRedirect };
      await completeSubmission(submissionStore, reservation, 'completed', response);
      console.info(JSON.stringify({
        event: 'leadhoop_response', submissionId, functionRequestId, campaignCode: config.campaignCode,
        httpStatus: vendorResponse.status || null, leadHoopResponseId, accepted: true, outboundRequests: 1
      }));
      return reply(200, response);
    }
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
    const response = { outcome: 'failed', location: config.failedRedirect };
    await completeSubmission(submissionStore, reservation, 'completed', response);
    console.info(JSON.stringify({
      event: 'leadhoop_response', submissionId, functionRequestId, campaignCode: config.campaignCode,
      httpStatus: vendorResponse.status || null, leadHoopResponseId, accepted: false, outboundRequests: 1
    }));
    return reply(200, response);
  } catch (error) {
    const response = { outcome: 'unavailable', retryable: false };
    await completeSubmission(submissionStore, reservation, 'ambiguous', response);
    console.error(JSON.stringify({
      event: 'submission_error', submissionId, functionRequestId, campaignCode: config.campaignCode,
      completed: false, outboundRequests: 1, error: String(error && error.message || error)
    }));
    return reply(502, response);
  } finally {
    clearTimeout(timeout);
  }
};
