'use strict';

const fs = require('fs');
const path = require('path');

const EXPECTED_HEADERS = ['program_id', 'program_name', 'active', 'display_order'];

function parseCsvLine(line) {
  const values = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      values.push(value);
      value = '';
    } else {
      value += character;
    }
  }
  if (quoted) throw new Error('Program CSV contains an unterminated quoted value.');
  values.push(value);
  return values;
}

function validateCsv(source) {
  const lines = String(source || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter(function (line) {
    return line.trim() !== '';
  });
  if (lines.length < 2) throw new Error('Program CSV must contain a header and at least one program.');

  const headers = parseCsvLine(lines[0]).map(function (value) { return value.trim(); });
  if (headers.length !== EXPECTED_HEADERS.length || headers.some(function (value, index) { return value !== EXPECTED_HEADERS[index]; })) {
    throw new Error('Program CSV headers are invalid.');
  }

  const ids = new Set();
  const orders = new Set();
  const programs = lines.slice(1).map(function (line, rowIndex) {
    const values = parseCsvLine(line);
    if (values.length !== EXPECTED_HEADERS.length) throw new Error(`Program CSV row ${rowIndex + 2} has the wrong number of columns.`);
    const id = values[0].trim();
    const name = values[1].trim();
    const activeValue = values[2].trim().toLowerCase();
    const orderValue = values[3].trim();

    if (!/^\d+$/.test(id)) throw new Error(`Program CSV row ${rowIndex + 2} has a missing or invalid ID.`);
    if (ids.has(id)) throw new Error(`Program CSV contains duplicate program ID ${id}.`);
    if (!name) throw new Error(`Program CSV row ${rowIndex + 2} has a blank program name.`);
    if (activeValue !== 'true' && activeValue !== 'false') throw new Error(`Program CSV row ${rowIndex + 2} has an invalid active value.`);
    if (!/^\d+$/.test(orderValue) || Number(orderValue) < 1) throw new Error(`Program CSV row ${rowIndex + 2} has an invalid display order.`);
    const displayOrder = Number(orderValue);
    if (orders.has(displayOrder)) throw new Error(`Program CSV contains duplicate display order ${displayOrder}.`);

    ids.add(id);
    orders.add(displayOrder);
    return { program_id: id, program_name: name, active: activeValue === 'true', display_order: displayOrder };
  });

  if (!programs.some(function (program) { return program.active; })) throw new Error('Program CSV must contain at least one active program.');
  return programs.sort(function (left, right) { return left.display_order - right.display_order; });
}

function build(inputPath, outputPath) {
  if (!fs.existsSync(inputPath)) throw new Error('Program CSV is missing.');
  const programs = validateCsv(fs.readFileSync(inputPath, 'utf8'));
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(programs, null, 2) + '\n');
  return programs;
}

if (require.main === module) {
  const root = path.join(__dirname, '..');
  const programs = build(
    path.join(root, 'src', 'data', 'uma-kayla-programs.csv'),
    path.join(root, 'src', 'data', 'uma-kayla-programs.json')
  );
  console.log(`Validated ${programs.length} UMA program records.`);
}

module.exports = { parseCsvLine, validateCsv, build };
