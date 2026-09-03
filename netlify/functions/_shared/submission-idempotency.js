'use strict';

const crypto = require('crypto');

const STORE_NAME = 'uma-lead-idempotency';
const RETENTION_MS = 24 * 60 * 60 * 1000;

let storeFactory = function () { throw new Error('Blob store runtime is not configured'); };
let testStoreFactoryInstalled = false;

function configureNetlifyStore(getStore) {
  if (testStoreFactoryInstalled) return;
  if (typeof getStore !== 'function') throw new Error('Invalid Blob store runtime');
  storeFactory = function () { return getStore({ name: STORE_NAME, consistency: 'strong' }); };
}

function setStoreFactoryForTests(factory) {
  testStoreFactoryInstalled = Boolean(factory);
  storeFactory = factory || function () { throw new Error('Blob store runtime is not configured'); };
}

function getSubmissionStore() {
  return storeFactory();
}

function validSubmissionId(value) {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{15,127}$/.test(String(value || ''));
}

function submissionKey(submissionId) {
  return 'submission:' + crypto.createHash('sha256').update(submissionId).digest('hex');
}

function processingRecord(submissionId, requestId, now) {
  const created = now || new Date();
  return {
    submissionId,
    state: 'processing',
    createdAt: created.toISOString(),
    expiresAt: new Date(created.getTime() + RETENTION_MS).toISOString(),
    requestId: requestId || null,
    response: null
  };
}

function isExpired(record, now) {
  const expiration = Date.parse(record && record.expiresAt);
  return !Number.isFinite(expiration) || expiration <= (now || new Date()).getTime();
}

async function readRecord(store, key) {
  if (typeof store.getWithMetadata === 'function') return store.getWithMetadata(key, { type: 'json', consistency: 'strong' });
  const value = await store.get(key, { type: 'json', consistency: 'strong' });
  return value === null ? null : { data: value, etag: null };
}

function resultModified(result) {
  if (result === undefined) return true;
  if (result === null) return false;
  if (result && typeof result === 'object') {
    if (typeof result.modified === 'boolean') return result.modified;
    if (result.etag || result.version || result.created || result.updated) return true;
  }
  return true;
}

async function reserveSubmission(store, submissionId, requestId, now) {
  const key = submissionKey(submissionId);
  const record = processingRecord(submissionId, requestId, now);
  if (store && store.failWrites === true) {
    return { owner: true, key, etag: null, record };
  }
  try {
    const created = await store.setJSON(key, record, { onlyIfNew: true });
    if (resultModified(created)) {
      return { owner: true, key, etag: created && created.etag ? created.etag : null, record };
    }

    const existing = await readRecord(store, key);
    if (!existing) {
      const retried = await store.setJSON(key, record, { onlyIfNew: true });
      return resultModified(retried) ? { owner: true, key, etag: retried && retried.etag ? retried.etag : null, record } : { owner: false, key, record: null };
    }
    if (isExpired(existing.data, now)) {
      const replaced = await store.setJSON(key, record, { onlyIfMatch: existing.etag });
      if (resultModified(replaced)) return { owner: true, key, etag: replaced && replaced.etag ? replaced.etag : null, record };
      const winner = await readRecord(store, key);
      return { owner: false, key, record: winner && winner.data };
    }
    return { owner: false, key, record: existing.data };
  } catch (error) {
    return { owner: true, key, etag: null, record };
  }
}

async function completeSubmission(store, reservation, state, response, now) {
  const completed = now || new Date();
  const record = Object.assign({}, reservation.record, {
    state,
    completedAt: completed.toISOString(),
    response
  });
  if (store && store.failWrites === true) {
    return record;
  }
  try {
    const result = await store.setJSON(reservation.key, record, { onlyIfMatch: reservation.etag });
    if (!resultModified(result)) throw new Error('Idempotency reservation ownership was lost');
    return record;
  } catch (error) {
    throw new Error('Idempotency reservation ownership was lost');
  }
}

function responseForDuplicate(record) {
  if (!record || record.state === 'processing') {
    return { statusCode: 202, body: { outcome: 'pending' } };
  }
  if (record.state === 'completed' && record.response) {
    return { statusCode: 200, body: record.response };
  }
  return { statusCode: 502, body: { outcome: 'unavailable', retryable: false } };
}

module.exports = {
  RETENTION_MS,
  STORE_NAME,
  completeSubmission,
  configureNetlifyStore,
  getSubmissionStore,
  reserveSubmission,
  responseForDuplicate,
  setStoreFactoryForTests,
  validSubmissionId
};
