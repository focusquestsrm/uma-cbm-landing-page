import handlerModule from './_shared/get-program-availability-handler.js';
import { toEvent, toResponse } from './_shared/modern-wrapper.mjs';

export default async function (request) {
  return toResponse(await handlerModule.handler(toEvent(request, '')));
}
