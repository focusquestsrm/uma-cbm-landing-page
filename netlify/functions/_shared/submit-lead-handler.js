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
    submission: setting(['LEAD', 'SUBMISSION', 'ENABLED']),
    validation: setting(['LEAD', 'TEST', 'FLAG']),
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
  if (!config || !hasAllowedOrigin(event, config.origins) || (event.body || '').length > 100000 ||
      !config.submissionEnabled || (!config.validationFlag && !config.campaignEnabled)) {
    return reply(503, { outcome: 'unavailable', retryable: true });
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
    return reply(503, { outcome: 'unavailable', retryable: true });
  }

  let submissionStore;
  let reservation;
  try {
    submissionStore = getSubmissionStore();
    reservation = await reserveSubmission(submissionStore, submissionId, functionRequestId);
  } catch (error) {
    console.error(JSON.stringify({ event: 'idempotency_reservation', submissionId, functionRequestId, completed: false }));
    return reply(503, { outcome: 'unavailable', retryable: true });
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
    const vendorResponse = await fetch(config.endpoint + '?' + payload.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: config.authorization },
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
