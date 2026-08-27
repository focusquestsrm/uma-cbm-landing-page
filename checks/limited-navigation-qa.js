'use strict';

const fs = require('fs');
const baseUrl = String(process.argv[2] || 'http://127.0.0.1:8888').replace(/\/$/, '');
const widths = [390, 768, 1366, 1440];
const programs = [
  { program_id: '227753', program_name: 'Healthcare and Human Services', active: true, display_order: 1 },
  { program_id: '227755', program_name: 'Medical Administrative Assistant', active: true, display_order: 2 },
  { program_id: '227756', program_name: 'Medical Billing and Coding', active: true, display_order: 3 },
  { program_id: '227754', program_name: 'Healthcare Management', active: true, display_order: 4 }
];
let sequence = 0;
const pending = new Map();
const submissionRequests = [];

async function connect() {
  const created = await fetch(`http://127.0.0.1:9223/json/new?${encodeURIComponent(baseUrl + '/')}`, { method: 'PUT' }).then(function (response) { return response.json(); });
  const socket = new WebSocket(created.webSocketDebuggerUrl);
  await new Promise(function (resolve, reject) {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  socket.addEventListener('message', function (event) {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const result = pending.get(message.id);
      pending.delete(message.id);
      return message.error ? result.reject(new Error(message.error.message)) : result.resolve(message.result);
    }
    if (message.method === 'Fetch.requestPaused') {
      const request = message.params.request;
      if (request.url.includes('/.netlify/functions/get-program-availability')) {
        command({ socket }, 'Fetch.fulfillRequest', {
          requestId: message.params.requestId,
          responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
          body: Buffer.from(JSON.stringify({ programs })).toString('base64')
        }).catch(function () {});
      } else {
        command({ socket }, 'Fetch.continueRequest', { requestId: message.params.requestId }).catch(function () {});
      }
    }
    if (message.method === 'Network.requestWillBeSent' && message.params.request.url.includes('/.netlify/functions/submit-lead')) {
      submissionRequests.push(message.params.request.url);
    }
  });
  return { socket };
}

function command(client, method, params) {
  sequence += 1;
  return new Promise(function (resolve, reject) {
    pending.set(sequence, { resolve, reject });
    client.socket.send(JSON.stringify({ id: sequence, method, params: params || {} }));
  });
}

async function evaluate(client, expression) {
  const result = await command(client, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

async function waitFor(client, expression, message) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await evaluate(client, expression)) return;
    await new Promise(function (resolve) { setTimeout(resolve, 100); });
  }
  throw new Error(message);
}

function assert(value, message) { if (!value) throw new Error(message); }

(async function () {
  const client = await connect();
  await command(client, 'Page.enable');
  await command(client, 'Runtime.enable');
  await command(client, 'Network.enable');
  await command(client, 'Fetch.enable', { patterns: [{ urlPattern: '*/.netlify/functions/get-program-availability*' }] });
  const results = [];
  for (const width of widths) {
    await command(client, 'Emulation.setDeviceMetricsOverride', { width, height: width < 800 ? 1100 : 900, deviceScaleFactor: 1, mobile: width < 600 });
    await command(client, 'Page.navigate', { url: baseUrl + '/' });
    await waitFor(client, `document.readyState === 'complete' && document.querySelectorAll('[data-program-id]').length === 4`, `Programs did not load at ${width}px`);
    const before = await evaluate(client, `({ sections: document.querySelectorAll('main > section').length, overflow: document.documentElement.scrollWidth > innerWidth })`);
    await evaluate(client, `document.querySelector('[data-program-id="227753"]').click(); true`);
    await waitFor(client, `document.getElementById('lead_education_program_id').value === '227753'`, 'Program selection was not retained');
    await evaluate(client, `document.querySelector('[data-next-step="2"]').click(); true`);
    await waitFor(client, `document.querySelector('.form-step.is-visible').dataset.step === '2'`, 'Form did not advance');
    const after = await evaluate(client, `({
      selected: document.getElementById('lead_education_program_id').value,
      stored: sessionStorage.getItem('umaProgramId'),
      sections: document.querySelectorAll('main > section').length,
      visibleSections: Array.from(document.querySelectorAll('main > section')).filter(function (node) { return getComputedStyle(node).display !== 'none'; }).length,
      overflow: document.documentElement.scrollWidth > innerWidth,
      nextTypes: Array.from(document.querySelectorAll('[data-next-step]')).map(function (node) { return node.type; })
    })`);
    assert(before.sections === 4 && !before.overflow, `Initial layout changed at ${width}px`);
    assert(after.selected === '227753' && after.stored === '227753', `Program state changed at ${width}px`);
    assert(after.sections === 4 && after.visibleSections === 4 && !after.overflow, `Landing content changed at ${width}px`);
    assert(after.nextTypes.every(function (type) { return type === 'button'; }), 'An intermediate control can submit');
    if (width === 390 || width === 1440) {
      const image = await command(client, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.mkdirSync('.artifacts', { recursive: true });
      fs.writeFileSync(`.artifacts/limited-${width}.png`, Buffer.from(image.data, 'base64'));
    }
    results.push({ width, programId: after.selected, step: 2, sections: after.sections, overflow: after.overflow });
  }
  assert(submissionRequests.length === 0, 'The lead-submission endpoint was called');
  console.log(JSON.stringify({ results, submissionRequests: 0 }, null, 2));
  client.socket.close();
})().catch(function (error) { console.error(error); process.exit(1); });
