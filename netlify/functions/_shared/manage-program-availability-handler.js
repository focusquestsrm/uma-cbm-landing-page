'use strict'; // Shared handler for the modern function entry point.

const crypto = require('crypto');
const {
  APPROVED_BY_ID,
  CAMPAIGN,
  currentCampaignMonth,
  getAvailabilityStore,
  readProgram,
  updateProgram
} = require('./program-availability');

const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff'
};

function reply(statusCode, body) {
  return { statusCode, headers: HEADERS, body: JSON.stringify(body) };
}

function authorized(event) {
  const expected = String(process.env.PROGRAM_AVAILABILITY_ADMIN_SECRET || '');
  const suppliedHeader = String(event.headers && (event.headers.authorization || event.headers.Authorization) || '');
  const supplied = suppliedHeader.startsWith('Bearer ') ? suppliedHeader.slice(7) : '';
  if (!expected || !supplied) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return Object.assign(reply(405, { outcome: 'unavailable' }), { headers: Object.assign({ Allow: 'POST' }, HEADERS) });
  if (!authorized(event)) return reply(401, { outcome: 'unauthorized' });

  let request;
  try { request = JSON.parse(event.body || '{}'); } catch (error) { return reply(400, { outcome: 'invalid' }); }
  const action = String(request.action || '');
  const campaign = String(request.campaign || '');
  const programId = String(request.programId || '');
  if (campaign !== CAMPAIGN || !APPROVED_BY_ID.has(programId)) return reply(400, { outcome: 'invalid' });

  try {
    const store = getAvailabilityStore();
    if (action === 'get') {
      const record = await readProgram(store, programId);
      return reply(200, { outcome: 'ok', program: record });
    }
    if (action !== 'set') return reply(400, { outcome: 'invalid' });
    const status = String(request.status || '');
    const settings = { updatedBy: 'authorized_admin' };
    if (status === 'capped') {
      settings.reasonCategory = request.reasonCategory === 'monthly_campaign_cap' ? 'monthly_campaign_cap' : 'monthly_offer_cap';
      settings.effectiveMonth = currentCampaignMonth();
    } else if (status === 'inactive') {
      settings.reasonCategory = 'program_inactive';
    } else if (status !== 'available') {
      return reply(400, { outcome: 'invalid' });
    }
    const result = await updateProgram(store, programId, status, settings);
    if (result.changed) {
      console.info(JSON.stringify({
        event: 'program_status_update',
        programId,
        oldStatus: result.oldRecord.status,
        newStatus: result.record.status,
        timestamp: result.record.updatedAt,
        updateSource: result.record.updatedBy
      }));
    }
    return reply(200, { outcome: 'ok', program: result.record, changed: result.changed });
  } catch (error) {
    console.error(JSON.stringify({ event: 'program_management', completed: false }));
    return reply(503, { outcome: 'unavailable' });
  }
};
