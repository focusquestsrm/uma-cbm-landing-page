'use strict';

const fs = require('fs');
const baseUrl = String(process.argv[2] || 'http://127.0.0.1:8888').replace(/\/$/, '');
const expectedPrograms = ['227753', '227755', '227756', '227754'];
const widths = [390, 768, 1366, 1440];
const port = 9223;
let sequence = 0;
const pending = new Map();
const browserIssues = [];
const functionRequests = [];

async function connect() {
  const created = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(baseUrl + '/')}`, { method: 'PUT' }).then(function (response) { return response.json(); });
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
    if (message.method === 'Network.requestWillBeSent' && message.params.request.url.includes('/.netlify/functions/submit-lead')) {
      functionRequests.push(message.params.request.url);
    }
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

async function navigate(client, url) {
  await command(client, 'Page.navigate', { url });
  await waitFor(client, `document.readyState === 'complete'`, `Page did not load: ${url}`);
}

function assert(value, message) {
  if (!value) throw new Error(message);
}

(async function () {
  const client = await connect();
  await command(client, 'Page.enable');
  await command(client, 'Runtime.enable');
  await command(client, 'Log.enable');
  await command(client, 'Network.enable');
  const results = [];

  for (const width of widths) {
    await command(client, 'Emulation.setDeviceMetricsOverride', { width, height: width < 800 ? 1200 : 1000, deviceScaleFactor: 1, mobile: width < 600 });
    const programs = [];
    for (let index = 0; index < expectedPrograms.length; index += 1) {
      const expectedProgram = expectedPrograms[index];
      await navigate(client, baseUrl + '/');
      await waitFor(client, `document.querySelectorAll('[data-program-id]').length === 4`, 'Program cards did not load');
      await evaluate(client, `document.querySelectorAll('[data-program-id]')[${index}].click(); true`);
      await waitFor(client, `document.getElementById('lead_education_program_id').value === '${expectedProgram}'`, 'Card selection did not reach the form');
      const afterCard = await evaluate(client, `({
        path: location.pathname,
        sectionCount: document.querySelectorAll('main > section').length,
        visibleSections: Array.from(document.querySelectorAll('main > section')).filter(function (section) { const style = getComputedStyle(section); return style.display !== 'none' && style.visibility !== 'hidden'; }).length,
        selected: document.getElementById('lead_education_program_id').value,
        stored: sessionStorage.getItem('umaProgramId'),
        step: document.querySelector('.form-step.is-visible').dataset.step,
        overflow: document.documentElement.scrollWidth > innerWidth,
        intermediateTypes: Array.from(document.querySelectorAll('[data-next-step], [data-back-step]')).map(function (button) { return button.type; })
      })`);
      assert(afterCard.path === '/', `Card ${expectedProgram} navigated away at ${width}px`);
      assert(afterCard.sectionCount === 4 && afterCard.visibleSections === 4, `Card ${expectedProgram} hid landing content at ${width}px`);
      assert(afterCard.selected === expectedProgram && afterCard.stored === expectedProgram, `Card ${expectedProgram} lost form state at ${width}px`);
      assert(afterCard.step === '1' && !afterCard.overflow, `Card ${expectedProgram} produced invalid layout state at ${width}px`);
      assert(afterCard.intermediateTypes.every(function (type) { return type === 'button'; }), 'An intermediate navigation control can submit the form');

      await evaluate(client, `document.querySelector('[data-next-step="2"]').click(); true`);
      await waitFor(client, `document.querySelector('.form-step.is-visible').dataset.step === '2'`, `Program ${expectedProgram} did not advance to step 2`);
      await evaluate(client, `(() => {
        const set = function (id, value) { const node = document.getElementById(id); node.value = value; node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true })); };
        set('lead_education_grad_year', '2023');
        set('lead_education_education_level_id', '2332');
        set('lead_address_address_visible', '123 Main Street');
        set('lead_address_city', 'Tampa');
        set('lead_address_state', 'FL');
        set('lead_address_zip', '33601');
        document.querySelector('[data-next-step="3"]').click();
        return true;
      })()`);
      await waitFor(client, `document.querySelector('.form-step.is-visible').dataset.step === '3'`, `Program ${expectedProgram} did not advance to step 3`);
      const finalState = await evaluate(client, `(() => {
        const set = function (id, value) { const node = document.getElementById(id); node.value = value; node.dispatchEvent(new Event('input', { bubbles: true })); };
        set('lead_firstname', 'Browser');
        set('lead_lastname', 'Review');
        set('lead_email', 'browser.review@example.invalid');
        set('lead_phone1', '2125550100');
        document.getElementById('tcpa-check').checked = true;
        const body = new URLSearchParams(new FormData(document.getElementById('leadform')));
        return {
          path: location.pathname,
          sectionCount: document.querySelectorAll('main > section').length,
          visibleSections: Array.from(document.querySelectorAll('main > section')).filter(function (section) { const style = getComputedStyle(section); return style.display !== 'none' && style.visibility !== 'hidden'; }).length,
          step: document.querySelector('.form-step.is-visible').dataset.step,
          selected: body.get('lead_education[program_id]'),
          submitType: document.getElementById('submitButton').type,
          overflow: document.documentElement.scrollWidth > innerWidth
        };
      })()`);
      assert(finalState.path === '/' && finalState.sectionCount === 4 && finalState.visibleSections === 4, `Form steps removed landing content for ${expectedProgram} at ${width}px`);
      assert(finalState.step === '3' && finalState.selected === expectedProgram, `Submission state lost program ${expectedProgram} at ${width}px`);
      assert(finalState.submitType === 'submit' && !finalState.overflow, `Final form controls or layout are invalid at ${width}px`);
      programs.push({ id: expectedProgram, afterCard, finalState });
    }

    await navigate(client, baseUrl + '/programs/connect/form-update-health.html');
    await waitFor(client, `document.querySelectorAll('#lead_education_program_id option').length === 5`, 'Direct form route did not hydrate');
    await command(client, 'Page.reload');
    await waitFor(client, `document.readyState === 'complete' && document.querySelectorAll('#lead_education_program_id option').length === 5`, 'Direct form refresh failed');
    const direct = await evaluate(client, `({ path: location.pathname, step: document.querySelector('.form-step.is-visible').dataset.step, overflow: document.documentElement.scrollWidth > innerWidth })`);
    assert(direct.path.endsWith('/programs/connect/form-update-health.html') && direct.step === '1' && !direct.overflow, `Direct form route failed at ${width}px`);

    await navigate(client, baseUrl + '/');
    await waitFor(client, `document.querySelectorAll('[data-program-id]').length === 4`, 'Landing refresh did not hydrate');
    await navigate(client, baseUrl + '/programs/connect/form-update-health.html');
    const history = await command(client, 'Page.getNavigationHistory');
    const landingEntry = history.entries.slice().reverse().find(function (entry) { return new URL(entry.url).pathname === '/'; });
    const formEntry = history.entries.slice().reverse().find(function (entry) { return new URL(entry.url).pathname.endsWith('/programs/connect/form-update-health.html'); });
    assert(landingEntry && formEntry, `History entries were unavailable at ${width}px`);
    await command(client, 'Page.navigateToHistoryEntry', { entryId: landingEntry.id });
    await waitFor(client, `location.pathname === '/' && document.querySelectorAll('main > section').length === 4`, 'Browser Back state was incomplete');
    await command(client, 'Page.navigateToHistoryEntry', { entryId: formEntry.id });
    await waitFor(client, `location.pathname.endsWith('form-update-health.html') && document.querySelector('.form-step.is-visible')`, 'Browser Forward state was incomplete');

    await navigate(client, baseUrl + '/');
    await waitFor(client, `document.querySelectorAll('[data-program-id]').length === 4`, 'Final landing load failed');
    await new Promise(function (resolve) { setTimeout(resolve, 5000); });
    const compliance = await evaluate(client, `({
      trustedForm: Boolean(document.getElementById('xxTrustedFormCertUrl_0').value),
      jornaya: Boolean(document.getElementById('leadid_token').value),
      sectionCount: document.querySelectorAll('main > section').length,
      overflow: document.documentElement.scrollWidth > innerWidth
    })`);
    assert(compliance.trustedForm && compliance.jornaya, `Compliance tokens did not populate at ${width}px`);
    assert(compliance.sectionCount === 4 && !compliance.overflow, `Landing content or layout failed at ${width}px`);
    if (width === 390 || width === 1440) {
      const screenshot = await command(client, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.writeFileSync(`.artifacts/interaction-${width}.png`, Buffer.from(screenshot.data, 'base64'));
    }
    results.push({ width, programs, direct, compliance });
  }

  await command(client, 'Emulation.setScriptExecutionDisabled', { value: true });
  await navigate(client, baseUrl + '/');
  const noScriptState = await evaluate(client, `({
    sectionCount: document.querySelectorAll('main > section').length,
    visibleSections: Array.from(document.querySelectorAll('main > section')).filter(function (section) { const style = getComputedStyle(section); return style.display !== 'none' && style.visibility !== 'hidden'; }).length,
    hasForm: Boolean(document.getElementById('leadform')),
    hasFooter: Boolean(document.querySelector('.site-footer')),
    overflow: document.documentElement.scrollWidth > innerWidth
  })`);
  await command(client, 'Emulation.setScriptExecutionDisabled', { value: false });
  assert(noScriptState.sectionCount === 4 && noScriptState.visibleSections === 4 && noScriptState.hasForm && noScriptState.hasFooter && !noScriptState.overflow,
    'Landing content did not remain visible with JavaScript disabled');

  assert(functionRequests.length === 0, 'A LeadHoop submission route was called during browser verification');
  assert(browserIssues.length === 0, `Browser issues detected: ${Array.from(new Set(browserIssues)).join('; ')}`);
  console.log(JSON.stringify({ baseUrl, widths: results.map(function (result) { return { width: result.width, programIds: result.programs.map(function (program) { return program.id; }), direct: result.direct, compliance: result.compliance }; }), noScriptState, functionRequests: functionRequests.length, browserIssues: [] }, null, 2));
  client.socket.close();
})().catch(function (error) {
  console.error(error);
  process.exit(1);
});
