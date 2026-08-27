import handlerModule from './_shared/submit-lead-handler.js';
import { toEvent, toResponse } from './_shared/modern-wrapper.mjs';

export default async function (request) {
  const body = request.method === 'POST' ? await request.text() : '';
  return toResponse(await handlerModule.handler(toEvent(request, body)));
}
