import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePages, verifyAnswer, assemblePrompt } from '../evidence.mjs';

const files = [{ name: 'smith-2021.pdf.txt', content: '=== smith-2021.pdf | page 1 ===\nIntroductory methods.\n=== smith-2021.pdf | page 2 ===\nThe experiment improved response time by 12 percent.\n=== smith-2021.pdf | page 3 ===\nProductivity was not measured.\n' }];

test('parses text with original PDF name and accurate page markers', () => {
  const pages = parsePages(files);
  assert.equal(pages.length, 3);
  assert.deepEqual({filename: pages[1].filename, page: pages[1].page}, {filename: 'smith-2021.pdf', page: 2});
});

test('accepts an exact quote with a matching PDF and page', () => {
  const answer = 'The study measured latency.\n"The experiment improved response time by 12 percent." (smith-2021.pdf, p. 2)';
  assert.equal(verifyAnswer(answer, parsePages(files)).ok, true);
});

test('rejects an invented quote, even with plausible citation', () => {
  const answer = '"The experiment doubled performance." (smith-2021.pdf, p. 2)';
  assert.equal(verifyAnswer(answer, parsePages(files)).ok, false);
});

test('rejects a genuine quote cited to the wrong page', () => {
  const answer = '"The experiment improved response time by 12 percent." (smith-2021.pdf, p. 3)';
  assert.equal(verifyAnswer(answer, parsePages(files)).ok, false);
});

test('rejects unsupported uncited answers', () => {
  assert.equal(verifyAnswer('Clearly yes.', parsePages(files)).ok, false);
});

test('allows the canonical unsupported answer', () => {
  assert.equal(verifyAnswer('Not in my sources.', []).ok, true);
});

test('creates a source-only prompt with evidence instructions', () => {
  const prompt = assemblePrompt('Answer using sources.', files, 'Does this help?');
  assert.match(prompt, /SOURCES:\n=== smith-2021\.pdf/);
  assert.match(prompt, /USER:\nDoes this help\?/);
  assert.match(prompt, /untrusted reference material/i);
});
