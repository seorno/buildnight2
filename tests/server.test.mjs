import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAppServer } from '../server.mjs';

async function fixture(t, runner = async () => '"Evidence is essential." (paper.pdf, p. 1)') {
  const dir = await mkdtemp(path.join(tmpdir(), 'research-partner-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  await mkdir(path.join(dir,'sources','text'), {recursive:true});
  await mkdir(path.join(dir,'prompts'), {recursive:true});
  await mkdir(path.join(dir,'assets'), {recursive:true});
  await writeFile(path.join(dir,'sources','text','paper.pdf.txt'), '=== paper.pdf | page 1 ===\nEvidence is essential.');
  await writeFile(path.join(dir,'prompts','ask.txt'), 'Source-locked assistant.');
  await writeFile(path.join(dir,'prompts','debate.txt'), 'Critical opponent.');
  await writeFile(path.join(dir,'index.html'), '<h1>Home</h1>');
  await writeFile(path.join(dir,'research.html'), '<h1>Research</h1>');
  const server = createAppServer({root:dir, runner});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

const post = (url, body) => fetch(`${url}/api/ask`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(body) });

test('answers a supported ask request and returns verified evidence', async t => {
  const url = await fixture(t);
  const response = await post(url, {mode:'ask',question:'Is evidence essential?'});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {answer:'"Evidence is essential." (paper.pdf, p. 1)'});
});

test('debate mode uses debate instruction', async t => {
  let seen = '';
  const url = await fixture(t, async prompt => {seen=prompt;return '"Evidence is essential." (paper.pdf, p. 1)';});
  const response = await post(url, {mode:'debate',question:'Evidence does not matter.'});
  assert.equal(response.status, 200);
  assert.match(seen, /Critical opponent/);
});

test('rejects invalid modes without reading arbitrary prompt paths', async t => {
  const url = await fixture(t);
  const response = await post(url, {mode:'../../secrets',question:'hello'});
  assert.equal(response.status, 400);
});

test('rejects blank questions', async t => {
  const url = await fixture(t);
  assert.equal((await post(url,{mode:'ask',question:'   '})).status,400);
});

test('rejects fabricated model evidence instead of displaying it', async t => {
  const url = await fixture(t, async () => '"Invented conclusion." (paper.pdf, p. 1)');
  const response = await post(url, {mode:'ask',question:'Is there proof?'});
  assert.equal(response.status,502);
  assert.match((await response.json()).error, /verification/i);
});

test('never serves private sources, prompts, or arbitrary files', async t => {
  const url = await fixture(t);
  for(const route of ['/sources/text/paper.pdf.txt','/prompts/ask.txt','/package.json','/../server.mjs']) {
    const response = await fetch(url+route);
    assert.equal(response.status,404,route);
  }
});

test('returns source library status and serves public HTML', async t => {
  const url = await fixture(t);
  const status = await (await fetch(`${url}/api/status`)).json();
  assert.deepEqual({ documents:status.documents, pages:status.pages }, {documents:1,pages:1});
  const response = await fetch(`${url}/research.html`);
  assert.equal(response.status,200);
  assert.match(await response.text(),/Research/);
});

test('unsupported answer allowed without invented citations', async t => {
  const url=await fixture(t, async ()=>'Not in my sources.');
  const response=await post(url,{mode:'ask',question:'Best pizza in Bath?'});
  assert.deepEqual(await response.json(),{answer:'Not in my sources.'});
});
