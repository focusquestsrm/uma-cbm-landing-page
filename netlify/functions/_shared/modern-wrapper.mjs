import { getStore } from '@netlify/blobs';
import availabilityModule from './program-availability.js';

availabilityModule.configureNetlifyStore(getStore);

export function toEvent(request, body) {
  const url = new URL(request.url);
  return {
    httpMethod: request.method,
    headers: Object.fromEntries(request.headers.entries()),
    body: body || '',
    path: url.pathname,
    queryStringParameters: Object.fromEntries(url.searchParams.entries())
  };
}

export function toResponse(result) {
  return new Response(result.body || '', {
    status: result.statusCode || 500,
    headers: result.headers || {}
  });
}
