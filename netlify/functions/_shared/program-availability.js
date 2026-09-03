'use strict';

const programData = require('../../../src/data/uma-kayla-programs.json');

const CAMPAIGN = 'uma-health';
const STORE_NAME = 'uma-program-availability';
const STATUSES = new Set(['available', 'capped', 'inactive']);
const UPDATE_SOURCES = new Set(['initialization', 'leadhoop_response', 'monthly_reset', 'authorized_admin']);

function validateApprovedPrograms(value) {
  if (!Array.isArray(value) || value.length === 0) throw new Error('Invalid approved program configuration');
  const ids = new Set();
  const orders = new Set();
  return value.map(function (program) {
    const normalized = {
      programId: String(program && program.program_id || ''),
      programName: String(program && program.program_name || '').trim(),
      active: program && program.active,
      displayOrder: program && program.display_order
    };
    if (!/^\d+$/.test(normalized.programId) || !normalized.programName || typeof normalized.active !== 'boolean' ||
        !Number.isInteger(normalized.displayOrder) || normalized.displayOrder < 1 || ids.has(normalized.programId) ||
        orders.has(normalized.displayOrder)) throw new Error('Invalid approved program configuration');
    ids.add(normalized.programId);
    orders.add(normalized.displayOrder);
    return Object.freeze(normalized);
  }).sort(function (left, right) { return left.displayOrder - right.displayOrder; });
}

const APPROVED_PROGRAMS = Object.freeze(validateApprovedPrograms(programData));
const APPROVED_BY_ID = new Map(APPROVED_PROGRAMS.map(function (program) { return [program.programId, program]; }));

let storeFactory = function () { throw new Error('Blob store runtime is not configured'); };
let testStoreFactoryInstalled = false;

function getAvailabilityStore() {
  return storeFactory();
}

function setStoreFactoryForTests(factory) {
  testStoreFactoryInstalled = Boolean(factory);
  storeFactory = factory || function () { throw new Error('Blob store runtime is not configured'); };
}

function configureNetlifyStore(getStore) {
  if (testStoreFactoryInstalled) return;
  if (typeof getStore !== 'function') throw new Error('Invalid Blob store runtime');
  storeFactory = function () { return getStore({ name: STORE_NAME, consistency: 'strong' }); };
}

function programKey(programId) {
  const normalized = String(programId || '');
  if (!APPROVED_BY_ID.has(normalized)) throw new Error('Unknown program');
  return `${CAMPAIGN}:${normalized}`;
}

function currentCampaignMonth(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit'
  }).formatToParts(date || new Date());
  const year = parts.find(function (part) { return part.type === 'year'; }).value;
  const month = parts.find(function (part) { return part.type === 'month'; }).value;
  return `${year}-${month}`;
}

function initialRecord(program, now) {
  return {
    campaign: CAMPAIGN,
    programId: program.programId,
    programName: program.programName,
    status: 'available',
    reasonCategory: null,
    effectiveMonth: null,
    updatedAt: (now || new Date()).toISOString(),
    updatedBy: 'initialization'
  };
}

function normalizeProgramName(value) {
  return String(value || '').replace(/\bA\.?A\.?S\.?\b/gi, '').replace(/Associate of Applied Science/gi, '').replace(/[–—-]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

function validRecord(record, program) {
  const nameMatches = record && (record.programName === program.programName || normalizeProgramName(record.programName) === normalizeProgramName(program.programName));
  return Boolean(record && record.campaign === CAMPAIGN && record.programId === program.programId &&
    nameMatches && STATUSES.has(record.status) &&
    (record.reasonCategory === null || typeof record.reasonCategory === 'string') &&
    (record.effectiveMonth === null || /^\d{4}-\d{2}$/.test(record.effectiveMonth)) &&
    typeof record.updatedAt === 'string' && UPDATE_SOURCES.has(record.updatedBy));
}

async function readProgram(store, programId, now) {
  const program = APPROVED_BY_ID.get(String(programId || ''));
  if (!program) throw new Error('Unknown program');
  const key = programKey(program.programId);
  const existing = await store.get(key, { type: 'json', consistency: 'strong' });
  if (existing === null) {
    const created = initialRecord(program, now);
    await store.setJSON(key, created);
    return created;
  }
  if (!validRecord(existing, program)) {
    const repaired = initialRecord(program, now);
    await store.setJSON(key, repaired);
    return repaired;
  }
  if (existing.programName !== program.programName) {
    const repaired = Object.assign({}, existing, { programName: program.programName, updatedAt: (now || new Date()).toISOString(), updatedBy: 'initialization' });
    await store.setJSON(key, repaired);
    return repaired;
  }
  return existing;
}

async function readAllPrograms(store, now) {
  const records = [];
  for (const program of APPROVED_PROGRAMS) records.push(await readProgram(store, program.programId, now));
  return records;
}

async function updateProgram(store, programId, status, options) {
  const normalizedStatus = String(status || '');
  const settings = options || {};
  const source = String(settings.updatedBy || '');
  if (!STATUSES.has(normalizedStatus) || !UPDATE_SOURCES.has(source)) throw new Error('Invalid program status update');
  const current = await readProgram(store, programId, settings.now);
  const reasonCategory = normalizedStatus === 'available' ? null : String(settings.reasonCategory || '');
  const effectiveMonth = normalizedStatus === 'capped' ? String(settings.effectiveMonth || '') : null;
  if (normalizedStatus !== 'available' && !reasonCategory) throw new Error('Missing status reason');
  if (normalizedStatus === 'capped' && !/^\d{4}-\d{2}$/.test(effectiveMonth)) throw new Error('Invalid cap month');
  if (current.status === normalizedStatus && current.reasonCategory === reasonCategory && current.effectiveMonth === effectiveMonth) {
    return { oldRecord: current, record: current, changed: false };
  }
  const record = {
    campaign: CAMPAIGN,
    programId: current.programId,
    programName: current.programName,
    status: normalizedStatus,
    reasonCategory,
    effectiveMonth,
    updatedAt: (settings.now || new Date()).toISOString(),
    updatedBy: source
  };
  await store.setJSON(programKey(current.programId), record);
  return { oldRecord: current, record, changed: true };
}

async function restoreExpiredCaps(store, now) {
  const currentMonth = currentCampaignMonth(now);
  const restored = [];
  const records = await readAllPrograms(store, now);
  for (const record of records) {
    if (record.status === 'capped' && record.effectiveMonth && record.effectiveMonth < currentMonth) {
      const result = await updateProgram(store, record.programId, 'available', { updatedBy: 'monthly_reset', now });
      if (result.changed) restored.push(result.record.programId);
    }
  }
  return restored;
}

function publicAvailablePrograms(records) {
  const statusById = new Map(records.map(function (record) { return [record.programId, record.status]; }));
  return APPROVED_PROGRAMS.filter(function (program) {
    return program.active && statusById.get(program.programId) === 'available';
  }).map(function (program) {
    return {
      program_id: program.programId,
      program_name: program.programName,
      display_name: String(program.programName).replace(/\bA\.?A\.?S\.?\b/gi, '').replace(/Associate of Applied Science/gi, '').replace(/[–—-]/g, ' ').replace(/\s+/g, ' ').replace(/^\s*\.\s*/, '').trim(),
      active: true,
      display_order: program.displayOrder
    };
  });
}

module.exports = {
  APPROVED_BY_ID,
  APPROVED_PROGRAMS,
  CAMPAIGN,
  STORE_NAME,
  currentCampaignMonth,
  getAvailabilityStore,
  programKey,
  publicAvailablePrograms,
  readAllPrograms,
  readProgram,
  restoreExpiredCaps,
  configureNetlifyStore,
  setStoreFactoryForTests,
  updateProgram
};
