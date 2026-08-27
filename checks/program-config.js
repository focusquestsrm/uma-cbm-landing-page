'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
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
  '227754,"A.A.S. – Healthcare Management",false,2\n' +
  '227753,"A.A.S. – Health and Human Services",true,1\n'
);
assert.deepStrictEqual(
  withInactive.filter(function (program) { return program.active; }).map(function (program) { return program.program_id; }),
  ['227753']
);

console.log('Program configuration checks passed.');
