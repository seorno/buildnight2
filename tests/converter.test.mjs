import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { convertPdfs } from '../convert.mjs';

test('converter retains real page order and warns for scanned documents', async t => {
  const root = await mkdtemp(path.join(tmpdir(),'research-convert-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(path.join(root,'sources'));
  await writeFile(path.join(root,'sources','test.pdf'), Buffer.from('mock-pdf'));
  const log=[];
  const fakeLoad = async () => ({numPages:2, getPage: async n => ({getTextContent:async ()=>({items:[{str:n===1?'First page claim':'Second page claim',hasEOL:false}]})}),destroy:async()=>{}});
  const result=await convertPdfs({root, loadPdf:fakeLoad, logger:s=>log.push(s)});
  const output=await readFile(path.join(root,'sources','text','test.pdf.txt'),'utf8');
  assert.match(output,/=== test\.pdf \| page 1 ===\nFirst page claim/);
  assert.match(output,/=== test\.pdf \| page 2 ===\nSecond page claim/);
  assert.equal(result.files,1);
  assert.match(log.join('\n'),/Done\./);
  assert.match(log.join('\n'),/probably a scan/i);
});

test('removed PDFs do not leave stale citations in text folder', async t => {
  const root=await mkdtemp(path.join(tmpdir(),'research-convert-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(path.join(root,'sources','text'),{recursive:true});
  await writeFile(path.join(root,'sources','text','removed.pdf.txt'),'old');
  await convertPdfs({root,logger:()=>{}});
  assert.deepEqual(await readdir(path.join(root,'sources','text')),[]);
});
