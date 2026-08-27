'use strict'; // Shared handler for the modern function entry point.

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

exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: Object.assign({ Allow: 'GET' }, HEADERS), body: JSON.stringify({ outcome: 'unavailable' }) };
  }
  try {
    const records = await readAllPrograms(getAvailabilityStore());
    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ programs: publicAvailablePrograms(records) }) };
  } catch (error) {
    console.error(JSON.stringify({ event: 'program_availability_read', completed: false }));
    return { statusCode: 503, headers: HEADERS, body: JSON.stringify({ outcome: 'unavailable', programs: [] }) };
  }
};
