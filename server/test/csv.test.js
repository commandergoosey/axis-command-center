'use strict';

/*
 * Tests for lib/csv.js — parseCSV + toCSV.
 *
 * No DB required. The module is pure string manipulation.
 *
 * parseCSV covers:
 *   - empty string returns []
 *   - header-only (no data rows) returns []
 *   - basic row → object with correct keys and values
 *   - extra whitespace trimmed from headers
 *   - blank lines skipped
 *   - quoted fields with commas inside ("London, UK")
 *   - escaped double-quotes inside quoted field ("" → ")
 *   - \r\n line endings normalised
 *   - \r line endings normalised
 *
 * toCSV covers:
 *   - first line is the header row (comma-separated)
 *   - subsequent lines are data rows
 *   - uses CRLF (\r\n) line endings
 *   - values containing commas are quoted
 *   - values containing double-quotes are escaped
 *   - null/undefined values become empty string
 *   - round-trip: parseCSV(toCSV(headers, rows)) reproduces the original rows
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { parseCSV, toCSV } = require('../lib/csv');

// ─────────────────────────────────────────────────────────────────
describe('parseCSV', () => {
  it('empty string returns []', () => {
    assert.deepEqual(parseCSV(''), []);
  });

  it('whitespace-only string returns []', () => {
    assert.deepEqual(parseCSV('   \n  '), []);
  });

  it('header row only (no data rows) returns []', () => {
    assert.deepEqual(parseCSV('name,age,city'), []);
  });

  it('single data row returns one object with correct keys and values', () => {
    const result = parseCSV('name,age\nAlice,30');
    assert.deepEqual(result, [{ name: 'Alice', age: '30' }]);
  });

  it('multiple data rows return multiple objects', () => {
    const result = parseCSV('name,age\nAlice,30\nBob,25');
    assert.equal(result.length, 2);
    assert.deepEqual(result[0], { name: 'Alice', age: '30' });
    assert.deepEqual(result[1], { name: 'Bob',   age: '25'  });
  });

  it('extra whitespace trimmed from header names', () => {
    const result = parseCSV(' name , age \nAlice,30');
    assert.ok('name' in result[0], 'header "name" should be trimmed');
    assert.ok('age'  in result[0], 'header "age" should be trimmed');
  });

  it('blank lines between data rows are skipped', () => {
    const result = parseCSV('name,age\n\nAlice,30\n\nBob,25\n');
    assert.equal(result.length, 2);
  });

  it('quoted field containing a comma is treated as one cell', () => {
    const result = parseCSV('city,country\n"London, UK",GB');
    assert.deepEqual(result, [{ city: 'London, UK', country: 'GB' }]);
  });

  it('escaped double-quote inside quoted field ("" → ")', () => {
    const result = parseCSV('quote,val\n"say ""hello""",42');
    assert.deepEqual(result, [{ quote: 'say "hello"', val: '42' }]);
  });

  it('\\r\\n line endings are normalised', () => {
    const result = parseCSV('name,age\r\nAlice,30\r\nBob,25');
    assert.equal(result.length, 2);
    assert.equal(result[0].name, 'Alice');
    assert.equal(result[1].name, 'Bob');
  });

  it('\\r-only line endings are normalised', () => {
    const result = parseCSV('name,age\rAlice,30\rBob,25');
    assert.equal(result.length, 2);
    assert.equal(result[0].name, 'Alice');
    assert.equal(result[1].name, 'Bob');
  });

  it('missing trailing cells default to empty string', () => {
    const result = parseCSV('a,b,c\n1,2');
    assert.equal(result[0].c, '');
  });
});

// ─────────────────────────────────────────────────────────────────
describe('toCSV', () => {
  it('first line is the header row comma-separated', () => {
    const csv = toCSV(['name', 'age'], []);
    const lines = csv.split('\r\n');
    assert.equal(lines[0], 'name,age');
  });

  it('subsequent lines are data rows', () => {
    const csv = toCSV(['name', 'age'], [{ name: 'Alice', age: '30' }]);
    const lines = csv.split('\r\n');
    assert.equal(lines.length, 2);
    assert.equal(lines[1], 'Alice,30');
  });

  it('uses CRLF (\\r\\n) line endings', () => {
    const csv = toCSV(['a', 'b'], [{ a: '1', b: '2' }]);
    assert.ok(csv.includes('\r\n'), 'should contain CRLF');
    assert.equal(csv, 'a,b\r\n1,2');
  });

  it('values containing commas are quoted', () => {
    const csv = toCSV(['city'], [{ city: 'London, UK' }]);
    const lines = csv.split('\r\n');
    assert.equal(lines[1], '"London, UK"');
  });

  it('values containing double-quotes are escaped', () => {
    const csv = toCSV(['phrase'], [{ phrase: 'say "hello"' }]);
    const lines = csv.split('\r\n');
    assert.equal(lines[1], '"say ""hello"""');
  });

  it('null values become empty string', () => {
    const csv = toCSV(['a', 'b'], [{ a: null, b: 'x' }]);
    const lines = csv.split('\r\n');
    assert.equal(lines[1], ',x');
  });

  it('undefined values become empty string', () => {
    const csv = toCSV(['a', 'b'], [{ b: 'y' }]);   // a is undefined
    const lines = csv.split('\r\n');
    assert.equal(lines[1], ',y');
  });

  it('header-only (empty rows array) produces one line with no trailing CRLF', () => {
    const csv = toCSV(['name', 'age'], []);
    assert.equal(csv, 'name,age');
  });

  it('round-trip: parseCSV(toCSV(headers, rows)) reproduces original rows', () => {
    const headers = ['name', 'city', 'notes'];
    const rows = [
      { name: 'Alice',   city: 'London, UK',  notes: 'say "hi"'    },
      { name: 'Bob',     city: 'Accra',        notes: ''             },
      { name: 'Charlie', city: 'New York',     notes: 'a,b,c'       },
    ];
    const csv     = toCSV(headers, rows);
    const parsed  = parseCSV(csv);
    assert.deepEqual(parsed, rows);
  });
});
