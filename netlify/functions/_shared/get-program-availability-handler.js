'use strict'; // Shared handler for the modern function entry point.

const staticPrograms = require('../../../src/data/uma-kayla-programs.json');
const {
  getAvailabilityStore,
  publicAvailablePrograms,
  readAllPrograms
} = require('./program-availability');

const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff'
};

function fallbackAvailablePrograms() {
  return (Array.isArray(staticPrograms) ? staticPrograms : []).filter(function (program) {
    return program && program.active === true;
  }).map(function (program) {
    return {
      program_id: String(program.program_id),
      program_name: String(program.program_name),
      active: true,
      display_order: Number(program.display_order)
    };
  }).sort(function (left, right) {
    return Number(left.display_order) - Number(right.display_order);
  });
}

function shouldUseStaticFallback(error) {
  const message = String(error && error.message || '');
  return /Blob store runtime is not configured|Invalid Blob store runtime|Blob store runtime/.test(message);
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: Object.assign({ Allow: 'GET' }, HEADERS), body: JSON.stringify({ outcome: 'unavailable' }) };
  }
  try {
    const records = await readAllPrograms(getAvailabilityStore());
    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ programs: publicAvailablePrograms(records) }) };
  } catch (error) {
    if (shouldUseStaticFallback(error)) {
      const fallbackPrograms = fallbackAvailablePrograms();
      if (fallbackPrograms.length > 0) {
        return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ programs: fallbackPrograms }) };
      }
    }
    console.error(JSON.stringify({ event: 'program_availability_read', completed: false }));
    return { statusCode: 503, headers: HEADERS, body: JSON.stringify({ outcome: 'unavailable', programs: [] }) };
  }
};
