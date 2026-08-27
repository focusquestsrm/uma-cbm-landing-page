'use strict';

const INACTIVE_CODES = new Set(['program_inactive', 'inactive_program', 'program_inactivated', 'program_unavailable']);
const OFFER_CAP_CODES = new Set(['monthly_offer_cap', 'program_monthly_offer_cap']);
const CAMPAIGN_CAP_CODES = new Set(['monthly_campaign_cap', 'program_monthly_campaign_cap']);

function normalize(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function collectByKey(value, matcher, output, depth) {
  if (depth > 6 || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach(function (entry) { collectByKey(entry, matcher, output, depth + 1); });
    return;
  }
  if (typeof value !== 'object') return;
  Object.entries(value).forEach(function (entry) {
    if (matcher.test(entry[0])) collectScalarValues(entry[1], output, depth + 1);
    collectByKey(entry[1], matcher, output, depth + 1);
  });
}

function collectScalarValues(value, output, depth) {
  if (depth > 6 || value === null || value === undefined) return;
  if (typeof value === 'string' || typeof value === 'number') {
    output.push(String(value));
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(function (entry) { collectScalarValues(entry, output, depth + 1); });
  }
}

function classifyLeadHoopResponse(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result) || typeof result.status !== 'string') {
    return { technicalFailure: true, accepted: false, status: null, reasonCategory: null };
  }
  const status = normalize(result.status);
  if (status === 'success') return { technicalFailure: false, accepted: true, status: null, reasonCategory: null };

  const codes = [];
  collectByKey(result, /(?:^|_)(?:code|reason_code|error_code)$/i, codes, 0);
  const normalizedCodes = codes.map(normalize);
  if (normalizedCodes.some(function (code) { return INACTIVE_CODES.has(code); })) {
    return { technicalFailure: false, accepted: false, status: 'inactive', reasonCategory: 'program_inactive' };
  }
  if (normalizedCodes.some(function (code) { return CAMPAIGN_CAP_CODES.has(code); })) {
    return { technicalFailure: false, accepted: false, status: 'capped', reasonCategory: 'monthly_campaign_cap' };
  }
  if (normalizedCodes.some(function (code) { return OFFER_CAP_CODES.has(code); })) {
    return { technicalFailure: false, accepted: false, status: 'capped', reasonCategory: 'monthly_offer_cap' };
  }

  const reasons = [];
  collectByKey(result, /^(?:reason|reasons|message|messages|error|errors|base)$/i, reasons, 0);
  const normalizedReasons = reasons.map(function (reason) { return normalize(reason).replace(/_/g, ' '); });
  if (normalizedReasons.some(function (reason) { return /\bprogram (?:is )?(?:inactive|inactivated|unavailable)\b/.test(reason); })) {
    return { technicalFailure: false, accepted: false, status: 'inactive', reasonCategory: 'program_inactive' };
  }
  if (normalizedReasons.some(function (reason) { return /\breached the monthly campaign cap for program\b/.test(reason); })) {
    return { technicalFailure: false, accepted: false, status: 'capped', reasonCategory: 'monthly_campaign_cap' };
  }
  if (normalizedReasons.some(function (reason) { return /\breached the monthly offer cap for program\b/.test(reason); })) {
    return { technicalFailure: false, accepted: false, status: 'capped', reasonCategory: 'monthly_offer_cap' };
  }
  return { technicalFailure: false, accepted: false, status: null, reasonCategory: null };
}

module.exports = { classifyLeadHoopResponse };
