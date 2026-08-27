'use strict';

const fs = require('fs');

const port = 9223;
let sequence = 0;
const pending = new Map();
const browserIssues = [];

async function connect() {
  const created = await fetch(`http://127.0.0.1:${port}/json/new?http://127.0.0.1:8888/`, { method: 'PUT' }).then(function (response) { return response.json(); });
  const socket = new WebSocket(created.webSocketDebuggerUrl);
  await new Promise(function (resolve, reject) {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  socket.addEventListener('message', function (event) {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const handlers = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) handlers.reject(new Error(message.error.message));
      else handlers.resolve(message.result);
      return;
    }
    if (message.method === 'Runtime.exceptionThrown') browserIssues.push(message.params.exceptionDetails.text);
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') browserIssues.push(message.params.entry.text);
    if (message.method === 'Network.responseReceived' && message.params.response.status >= 400) {
      browserIssues.push(`${message.params.response.status} ${message.params.response.url}`);
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

async function waitForLoad(client) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const state = await command(client, 'Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
    if (state.result.value === 'complete') return;
    await new Promise(function (resolve) { setTimeout(resolve, 100); });
  }
  throw new Error('Page load timed out');
}

async function evaluate(client, expression) {
  const result = await command(client, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

(async function () {
  const client = await connect();
  await command(client, 'Page.enable');
  await command(client, 'Runtime.enable');
  await command(client, 'Log.enable');
  await command(client, 'Network.enable');

  const widths = [390, 768, 1366, 1440];
  const responsive = [];
  for (const width of widths) {
    await command(client, 'Emulation.setDeviceMetricsOverride', { width, height: width < 800 ? 1024 : 900, deviceScaleFactor: 1, mobile: width < 600 });
    await command(client, 'Page.navigate', { url: 'http://127.0.0.1:8888/' });
    await waitForLoad(client);
    await new Promise(function (resolve) { setTimeout(resolve, 300); });
    const metrics = await evaluate(client, `({innerWidth: innerWidth, scrollWidth: document.documentElement.scrollWidth, title: document.title, robots: document.querySelector('meta[name="robots"]')?.content, forbidden: /\\b(test|testing|demo|staging|preview|sandbox|development|qa)\\b/i.test(document.body.innerText), brokenImages: Array.from(document.images).filter(img => img.complete && img.naturalWidth === 0).map(img => img.src), programIds: Array.from(document.querySelectorAll('#lead_education_program_id option')).map(option => option.value).filter(Boolean), programNames: Array.from(document.querySelectorAll('.program-title')).map(node => node.textContent)})`);
    responsive.push({ width, metrics });
    const screenshot = await command(client, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(`.artifacts/uma-${width}.png`, Buffer.from(screenshot.data, 'base64'));
  }

  await evaluate(client, `sessionStorage.setItem('umaProgramId', '227755')`);
  await command(client, 'Emulation.setDeviceMetricsOverride', { width: 390, height: 1200, deviceScaleFactor: 1, mobile: true });
  await command(client, 'Page.navigate', { url: 'http://127.0.0.1:8888/programs/connect/form-update-health.html?utm_source=review' });
  await waitForLoad(client);
  await new Promise(function (resolve) { setTimeout(resolve, 5000); });
  const formState = await evaluate(client, `(() => {
    const set = (id, value) => { const node = document.getElementById(id); node.value = value; node.dispatchEvent(new Event('input', {bubbles:true})); node.dispatchEvent(new Event('change', {bubbles:true})); };
    const selectedProgramFromIndex = document.getElementById('lead_education_program_id').value;
    set('lead_education_program_id', '227754');
    document.querySelector('[data-next-step="2"]').click();
    set('lead_education_grad_year', '2023');
    set('lead_education_education_level_id', '2332');
    set('lead_address_address_visible', '123 Main Street');
    set('lead_address_city', 'Tampa');
    set('lead_address_state', 'FL');
    set('lead_address_zip', '33601');
    document.querySelector('[data-next-step="3"]').click();
    return {
      url: location.href,
      step3Visible: document.querySelector('[data-step="3"]').classList.contains('is-visible'),
      selectedProgramFromIndex,
      selectedProgramForPayload: document.getElementById('lead_education_program_id').value,
      certificatePresent: Boolean(document.getElementById('xxTrustedFormCertUrl_0').value),
      leadIdPresent: Boolean(document.getElementById('leadid_token').value),
      forbidden: /\\b(test|testing|demo|staging|preview|sandbox|development|qa)\\b/i.test(document.body.innerText)
    };
  })()`);

  await command(client, 'Network.setBlockedURLs', { urls: ['*uma-kayla-programs.json'] });
  await command(client, 'Page.navigate', { url: 'http://127.0.0.1:8888/' });
  await waitForLoad(client);
  await new Promise(function (resolve) { setTimeout(resolve, 500); });
  const missingProgramData = await evaluate(client, `({
    selectDisabled: document.getElementById('lead_education_program_id').disabled,
    cardCount: document.querySelectorAll('.program-card').length,
    controlledMessage: document.getElementById('program-load-error').textContent
  })`);
  await command(client, 'Network.setBlockedURLs', { urls: [] });

  console.log(JSON.stringify({ responsive, formState, missingProgramData, browserIssues: Array.from(new Set(browserIssues)) }, null, 2));
  client.socket.close();
})().catch(function (error) {
  console.error(error);
  process.exit(1);
});
