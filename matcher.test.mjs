import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { detectSkills } from './matcher.mjs';

const vocabulary = JSON.parse(await readFile(new URL('./vocabulary.json', import.meta.url), 'utf8'));

test('matches aliases case insensitively and deduplicates within a posting', () => {
  assert.deepEqual(detectSkills('Python, PYTHON and Amazon Web Services (AWS).', vocabulary), ['python', 'aws']);
});

test('does not match substrings or identifiers, including Unicode letters', () => {
  assert.deepEqual(detectSkills('JavaScript javascripted java_foo éjava python3 postgresSQLish', vocabulary), ['javascript']);
});

test('handles punctuation in skill names and neighboring terms', () => {
  assert.deepEqual(detectSkills('C++, C#, React.js; Node.js, SQL.', vocabulary), ['csharp', 'cpp', 'sql', 'react', 'nodejs']);
  assert.deepEqual(detectSkills('C++17 C#developer', vocabulary), []);
});

test('avoids ambiguous bare Go and recognizes the explicit alias', () => {
  assert.deepEqual(detectSkills('Go to work. Experience with Golang.', vocabulary), ['go']);
  assert.deepEqual(detectSkills('Go to work.', vocabulary), []);
});

test('normalizes Unicode and rejects bad inputs', () => {
  assert.deepEqual(detectSkills('Ｐｙｔｈｏｎ', vocabulary), ['python']);
  assert.throws(() => detectSkills(null, vocabulary), TypeError);
});

test('vocabulary IDs and normalized aliases are unique and nonempty', () => {
  const ids = new Set();
  const aliases = new Set();
  for (const skill of vocabulary.skills) {
    assert.ok(skill.id && skill.label && skill.aliases.length);
    assert.ok(!ids.has(skill.id)); ids.add(skill.id);
    for (const alias of skill.aliases) {
      const key = alias.normalize('NFKC').toLocaleLowerCase('en-US');
      assert.ok(key && !aliases.has(key)); aliases.add(key);
    }
  }
});
