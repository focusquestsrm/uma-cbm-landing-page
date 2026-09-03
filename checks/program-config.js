'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { validateCsv } = require('../scripts/build-programs');

const root = path.join(__dirname, '..');
const csv = fs.readFileSync(path.join(root, 'src/data/uma-kayla-programs.csv'), 'utf8');
const programs = validateCsv(csv);
const expected = [
  { program_id: '227753', program_name: 'A.A.S. – Health and Human Services', active: true, display_order: 1 },
  { program_id: '227754', program_name: 'A.A.S. – Healthcare Management', active: true, display_order: 2 },
  { program_id: '227755', program_name: 'A.A.S. – Medical Administrative Assistant', active: true, display_order: 3 },
  { program_id: '227756', program_name: 'A.A.S. – Medical Billing and Coding', active: true, display_order: 4 }
];
assert.deepStrictEqual(programs, expected);

const header = 'program_id,program_name,active,display_order\n';
const invalidCases = [
  '',
  header + ',Healthcare Management,true,1\n',
  header + '227754,Healthcare Management,true,1\n227754,Other Program,true,2\n',
  header + '227754,,true,1\n',
  header + '227754,Healthcare Management,yes,1\n',
  header + '227754,Healthcare Management,true,1\n227755,Medical Administrative Assistant,true,1\n'
];
invalidCases.forEach(function (value) {
  assert.throws(function () { validateCsv(value); });
});

const withInactive = validateCsv(
  header +
  '227754,"Healthcare Management",false,2\n' +
  '227753,"Health and Human Services",true,1\n'
);
assert.deepStrictEqual(
  withInactive.filter(function (program) { return program.active; }).map(function (program) { return program.program_id; }),
  ['227753']
);

(async function () {
  const source = fs.readFileSync(path.join(root, 'src/js/program-availability.js'), 'utf8');
  const document = {
    createElement: function (tagName) {
      return { tagName, className: '', setAttribute: function () {}, appendChild: function () {}, replaceChildren: function () {}, append: function () {} };
    }
  };
  const context = vm.createContext({
    window: {},
    document,
    fetch: async function () {
      throw new Error('simulated fetch failure');
    },
    console,
    URLSearchParams,
    Event: function () {}
  });
  context.window = context;
  vm.runInContext(source, context);
  const programs = await context.window.UMA_PROGRAM_AVAILABILITY.loadPrograms();
  assert.strictEqual(programs.length, 4, 'Program fallback must load a complete static catalog when the API is unavailable');
  assert.strictEqual(programs.map(function (program) { return String(program.program_id); }).join(','), '227753,227754,227755,227756');
})().then(function () {
  console.log('Program configuration checks passed.');
}).catch(function (error) {
  console.error(error);
  process.exit(1);
});
