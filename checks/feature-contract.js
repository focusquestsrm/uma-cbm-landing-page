'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const metaSource = fs.readFileSync(path.join(root, 'src/js/meta-pixel.js'), 'utf8');
const placesSource = fs.readFileSync(path.join(root, 'src/js/google-places.js'), 'utf8');
const formSource = fs.readFileSync(path.join(root, 'src/js/function2.js'), 'utf8');
const graduationYears = require('../src/js/graduation-years');
const pages = ['src/index.html', 'src/programs/connect/form-update-health.html'].map(function (file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
});
const disclosure = 'By clicking the Request Info button below, I am providing my eSIGN signature and express written consent for Ultimate Medical Academy (UMA), Back2Learn, and parties calling on its behalf, to call or text me at the number provided above for purposes relating to educational opportunities with UMA, including through the use of automatic telephone dialing technology. I am authorized to consent to receive these communications at the phone number provided. I understand that I am consenting to receive calls and text messages regardless of whether the number provided is on any do not call list, either now or in the future. I acknowledge that my consent is not required to enroll, and I may revoke my consent at any time. I acknowledge that all calls may be recorded.';

function makeDocument(fields) {
  const appended = [];
  return {
    appended,
    head: { appendChild: function (node) { appended.push(node); } },
    createElement: function (tag) {
      return { tagName: tag, addEventListener: function (type, listener) { this['on' + type] = listener; } };
    },
    getElementById: function (id) { return fields && fields[id] || null; }
  };
}

function browserContext(document) {
  const context = { document, Event: function (type) { this.type = type; }, console };
  context.window = context;
  return vm.createContext(context);
}

const metaDocument = makeDocument();
const metaContext = browserContext(metaDocument);
vm.runInContext(metaSource, metaContext);
vm.runInContext(metaSource, metaContext);
assert.strictEqual(metaContext.UMA_META.isEnabled, false);
assert.strictEqual(metaContext.UMA_META.fireLead('event-123'), false);
assert.strictEqual(typeof metaContext.fbq, 'undefined');
assert.strictEqual(metaDocument.appended.filter(function (node) { return /fbevents\.js/.test(node.src); }).length, 0);
assert(/result\.outcome === 'accepted'[\s\S]*UMA_META\.fireLead/.test(formSource));

assert.strictEqual(graduationYears.MINIMUM_YEAR, 1996);
assert.strictEqual(graduationYears.MAXIMUM_YEAR, 2023);
[
  ['1995', false],
  ['1996', true],
  ['2023', true],
  ['2024', false],
  ['', false],
  ['2023.0', false],
  ['2022.5', false],
  ['not-a-year', false]
].forEach(function (scenario) {
  assert.strictEqual(graduationYears.isValid(scenario[0]), scenario[1], `Unexpected validation for ${scenario[0]}`);
});
assert(/if \(!validateStepTwo\(\)\)[\s\S]*updateStep\(2\)/.test(formSource), 'Final submit must revalidate graduation year');

function storage() {
  const values = new Map();
  return {
    getItem: function (key) { return values.has(key) ? values.get(key) : null; },
    setItem: function (key, value) { values.set(key, String(value)); },
    removeItem: function (key) { values.delete(key); }
  };
}

function runAttribution(cookie, search) {
  const attributionFields = {
    subid2: field(), subid3: field(), subid4: field(), meta_event_id: field(),
    lead_education_program_id: Object.assign(field(), { disabled: false, addEventListener: function () {}, focus: function () {} })
  };
  const leadForm = {
    addEventListener: function () {},
    querySelectorAll: function () { return []; },
    querySelector: function () { return null; }
  };
  const document = {
    title: 'Attribution test',
    getElementById: function (id) { return id === 'leadform' ? leadForm : attributionFields[id] || null; }
  };
  let cookieJar = cookie;
  Object.defineProperty(document, 'cookie', {
    get: function () { return cookieJar; },
    set: function (value) { cookieJar = cookieJar ? cookieJar + '; ' + value.split(';')[0] : value.split(';')[0]; }
  });
  const location = { search, pathname: '/', hash: '' };
  const context = vm.createContext({
    document,
    location,
    history: { replaceState: function () { location.search = ''; } },
    sessionStorage: storage(),
    localStorage: storage(),
    URLSearchParams,
    CustomEvent: function () {},
    crypto: { randomUUID: function () { return 'event-id'; } },
    UMA_PROGRAM_AVAILABILITY: { loadPrograms: async function () { return []; }, populateSelect: function () {} },
    console,
    setTimeout
  });
  context.window = context;
  context.window.location = location;
  context.window.history = context.history;
  context.window.crypto = context.crypto;
  vm.runInContext(formSource, context);
  return { fields: attributionFields, cookie: cookieJar, location };
}

const attribution = runAttribution(
  '_fbc=fb.1.1111111111.TESTFBC; _fbp=fb.1.2222222222.TESTFBP',
  '?fbclid=TEST-FBCLID-3333'
);
assert.strictEqual(attribution.fields.subid2.value, 'fb.1.1111111111.TESTFBC');
assert.strictEqual(attribution.fields.subid3.value, 'fb.1.2222222222.TESTFBP');
assert.strictEqual(attribution.fields.subid4.value, 'TEST-FBCLID-3333');
assert.strictEqual(attribution.location.search, '', 'URL cleanup must happen after attribution capture');

const generatedFbc = runAttribution('', '?fbclid=TEST-FBCLID-3333');
assert.match(generatedFbc.fields.subid2.value, /^fb\.1\.\d+\.TEST-FBCLID-3333$/);
assert(generatedFbc.cookie.includes('_fbc='), 'The application must persist its generated _fbc cookie');

function field(value) {
  return { value: value || '', events: [], dispatchEvent: function (event) { this.events.push(event.type); } };
}
const fields = {
  lead_address_address_visible: field('Manual address'),
  lead_address_address: field('Manual address'),
  lead_address_city: field('Manual city'),
  lead_address_state: field('FL'),
  lead_address_zip: field('33601')
};
const placesDocument = makeDocument(fields);
const placesContext = browserContext(placesDocument);
placesContext.UMA_RUNTIME_CONFIG = { googleMapsBrowserKey: '' };
let listener;
let selectedPlace;
let options;
placesContext.google = { maps: { places: { Autocomplete: function (input, suppliedOptions) {
  options = suppliedOptions;
  this.addListener = function (name, callback) { assert.strictEqual(name, 'place_changed'); listener = callback; };
  this.getPlace = function () { return selectedPlace; };
} } } };
vm.runInContext(placesSource, placesContext);
assert.strictEqual(placesDocument.appended.length, 0, 'Missing Google key must preserve manual-only mode');
placesContext.UMA_GOOGLE_PLACES.initializePlaces();
assert.deepStrictEqual(JSON.parse(JSON.stringify(options.componentRestrictions)), { country: 'us' });
selectedPlace = { address_components: [
  { long_name: '123', short_name: '123', types: ['street_number'] },
  { long_name: 'Main Street', short_name: 'Main St', types: ['route'] },
  { long_name: 'Tampa', short_name: 'Tampa', types: ['locality'] },
  { long_name: 'Florida', short_name: 'FL', types: ['administrative_area_level_1'] },
  { long_name: '33602', short_name: '33602', types: ['postal_code'] }
] };
listener();
assert.deepStrictEqual([
  fields.lead_address_address_visible.value, fields.lead_address_address.value,
  fields.lead_address_city.value, fields.lead_address_state.value, fields.lead_address_zip.value
], ['123 Main Street', '123 Main Street', 'Tampa', 'FL', '33602']);
const populated = fields.lead_address_address_visible.value;
selectedPlace = { address_components: [] };
listener();
assert.strictEqual(fields.lead_address_address_visible.value, populated, 'Places failure must not erase manual input');

pages.forEach(function (page) {
  const text = page.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  assert(text.includes(disclosure), 'The exact TCPA disclosure is missing');
  assert(/id="tcpa-check"[^>]*type="checkbox"[^>]*required/.test(page));
  assert(/name="lead_consent\[tcpa_consent\]"[^>]*value="Y"/.test(page));
  assert(/api\.trustedform\.com\/trustedform\.js/.test(page));
  assert(/create\.lidstatic\.com\/campaign\//.test(page));
  assert(/js\/graduation-years\.js/.test(page));
  const graduationSelect = page.match(/<select id="lead_education_grad_year"[\s\S]*?<\/select>/);
  assert(graduationSelect, 'Graduation Year select is missing');
  const displayedYears = Array.from(graduationSelect[0].matchAll(/<option value="(\d{4})">/g), function (match) { return Number(match[1]); });
  assert.deepStrictEqual(displayedYears, Array.from({ length: 28 }, function (_, index) { return 2023 - index; }));
  assert(/name="subid2" id="subid2"/.test(page));
  assert(/name="subid3" id="subid3"/.test(page));
  assert(/name="subid4" id="subid4"/.test(page));
});

console.log('Meta, Google Places fallback, TCPA, and compliance feature contracts passed.');
