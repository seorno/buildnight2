import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { convertPdfs } from '../convert.mjs';
import { parsePages, verifyAnswer } from '../evidence.mjs';
import { createAppServer } from '../server.mjs';

async function makeRoot(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'research-mixed-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root,'sources','HRM','transcripts'), { recursive: true });
  return root;
}

test('nested PDFs, PPTX and TXT get distinct, attributable segments', async t => {
  const root = await makeRoot(t);
  await mkdir(path.join(root,'sources','Strategy'), {recursive:true});
  await writeFile(path.join(root,'sources','HRM','lecture.pdf'), 'mock');
  await writeFile(path.join(root,'sources','HRM','lecture.pptx'), 'mock');
  await writeFile(path.join(root,'sources','Strategy','lecture.pptx'), 'mock');
  await writeFile(path.join(root,'sources','HRM','transcripts','week 1.txt'), 'People differ in how they work.\nSecond line mentions motivation.\n');
  const logs=[];
  const stats=await convertPdfs({root, logger:s=>logs.push(s),
    loadPdf: async () => ({numPages:1,getPage:async()=>({getTextContent:async()=>({items:[{str:'HRM lecture PDF conclusion',hasEOL:false}]})}),destroy:async()=>{}}),
    loadPresentation: async (_bytes, name) => [{text:`Slide argument from ${name}`, notes:'Speaker notes expand this claim.'}, {text:'Another slide in the deck',notes:''}]
  });
  assert.deepEqual({files:stats.files,pages:stats.pages,slides:stats.slides,sections:stats.sections}, {files:4,pages:1,slides:4,sections:1});
  const out=path.join(root,'sources','text');
  const pdf=await readFile(path.join(out,'HRM','lecture.pdf.txt'),'utf8');
  const ppt=await readFile(path.join(out,'HRM','lecture.pptx.txt'),'utf8');
  const txt=await readFile(path.join(out,'HRM','transcripts','week 1.txt.txt'),'utf8');
  assert.match(pdf,/=== HRM\/lecture\.pdf \| page 1 ===/);
  assert.match(ppt,/=== HRM\/lecture\.pptx \| slide 1 ===/);
  assert.match(ppt,/Speaker notes expand this claim/);
  assert.match(txt,/=== HRM\/transcripts\/week 1\.txt \| lines 1-2 ===/);
  const files = [
    { name:'HRM/lecture.pdf.txt',content:pdf },
    { name:'HRM/lecture.pptx.txt',content:ppt },
    { name:'HRM/transcripts/week 1.txt.txt',content:txt }
  ];
  const segments=parsePages(files);
  assert.equal(segments.length,4);
  assert.equal(verifyAnswer('"HRM lecture PDF conclusion" (HRM/lecture.pdf, p. 1)',segments).ok,true);
  assert.equal(verifyAnswer('"Speaker notes expand this claim." (HRM/lecture.pptx, slide 1)',segments).ok,true);
  assert.equal(verifyAnswer('"People differ in how they work." (HRM/transcripts/week 1.txt, lines 1-2)',segments).ok,true);
  assert.equal(verifyAnswer('"People differ in how they work." (HRM/transcripts/week 1.txt, lines 3-5)',segments).ok,false);
});

test('transcript longer than forty lines gets verifiable line ranges',async t=>{
  const root=await makeRoot(t);
  await writeFile(path.join(root,'sources','HRM','transcripts','long.txt'),Array.from({length:81},(_,i)=>`Line ${i+1} content`).join('\n'));
  await convertPdfs({root,logger:()=>{}});
  const content=await readFile(path.join(root,'sources','text','HRM','transcripts','long.txt.txt'),'utf8');
  assert.match(content,/=== HRM\/transcripts\/long\.txt \| lines 41-80 ===/);
  assert.match(content,/=== HRM\/transcripts\/long\.txt \| lines 81-81 ===/);
  assert.equal(parsePages([{name:'HRM/transcripts/long.txt.txt',content}]).length,3);
});

test('deleting a nested input prunes its generated output without affecting remaining sources',async t=>{
  const root=await makeRoot(t);
  const source=path.join(root,'sources','HRM','transcripts','old.txt');
  await writeFile(source,'A transcript.');
  await convertPdfs({root,logger:()=>{}});
  await unlink(source);
  await convertPdfs({root,logger:()=>{}});
  assert.deepEqual(await readdir(path.join(root,'sources','text','HRM','transcripts')),[]);
});

test('API scans nested generated sections and refuses to serve them publicly',async t=>{
  const root=await makeRoot(t);
  await writeFile(path.join(root,'sources','HRM','transcripts','notes.txt'),'The organisation values autonomy.');
  await convertPdfs({root,logger:()=>{}});
  await mkdir(path.join(root,'prompts'));
  await writeFile(path.join(root,'prompts','ask.txt'),'Answer using sources.');
  const server=createAppServer({root,runner:async()=> '"The organisation values autonomy." (HRM/transcripts/notes.txt, lines 1-1)'});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url=`http://127.0.0.1:${server.address().port}`;
  const status=await (await fetch(`${url}/api/status`)).json();
  assert.deepEqual({documents:status.documents,pages:status.pages,ready:status.ready},{documents:1,pages:1,ready:true});
  const result=await fetch(`${url}/api/ask`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({mode:'ask',question:'What does it value?'})});
  assert.equal(result.status,200);
  assert.match((await result.json()).answer,/lines 1-1/);
  assert.equal((await fetch(`${url}/sources/text/HRM/transcripts/notes.txt.txt`)).status,404);
});
