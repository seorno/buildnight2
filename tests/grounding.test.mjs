import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareEvidence, evidencePrompt, resolveEvidenceAnswer, evidenceFallback } from '../grounding.mjs';

const pages = [
  {filename:'HRM/Lecture 2.pptx',kind:'slide',locator:'3',text:'A second lecture discusses employee wellbeing.'},
  {filename:'HRM/Lecture 1.pptx',kind:'slide',locator:'1',text:'Motivation is affected by job design and autonomy.'},
  {filename:'HRM/lecture1/transcript.txt',kind:'lines',locator:'1-40',text:'The manager should consider worker expectations.'},
  {filename:'HRM/reading.pdf',kind:'page',locator:'7',text:'Financial rewards are only one determinant of behaviour.'}
];

test('lecture 1 is prioritized when the user asks to learn lecture 1',()=>{
  const cards=prepareEvidence(pages,'Teach me everything in lecture 1',{maxCards:1});
  assert.equal(cards.length,1);
  assert.equal(cards[0].filename,'HRM/Lecture 1.pptx');
});

test('source IDs resolve to exact text and true PPTX slide references',()=>{
  const cards=prepareEvidence(pages,'autonomy');
  const id=cards.find(c=>c.filename==='HRM/Lecture 1.pptx').id;
  const result=resolveEvidenceAnswer('Autonomy is discussed. ['+id+']',cards);
  assert.equal(result.ok,true);
  assert.match(result.answer,/“Motivation is affected by job design and autonomy\.” \(HRM\/Lecture 1\.pptx, slide 1\)/);
  assert.doesNotMatch(result.answer,/\[E\d+\]/);
});

test('rejects invented source IDs rather than fabricating a citation',()=>{
  const cards=prepareEvidence(pages,'motivation');
  assert.equal(resolveEvidenceAnswer('Unsupported. [E999]',cards).ok,false);
  const fallback=evidenceFallback(cards);
  assert.match(fallback,/could not be verified/i);
  assert.doesNotMatch(fallback,/Unsupported/);
});

test('uses only a bounded, source-only excerpt selection for large libraries',()=>{
  const many=Array.from({length:250},(_,i)=>({filename:'Notes/file'+i+'.txt',kind:'lines',locator:'1-40',text:'Repeated discussion of workplace motivation '.repeat(18)}));
  const cards=prepareEvidence(many,'workplace motivation');
  assert.ok(cards.length<=80);
  assert.ok(cards.reduce((n,c)=>n+c.text.length,0)<=48_000);
  const prompt=evidencePrompt('Answer source only.',cards,'What about motivation?');
  assert.match(prompt,/\[E1\]/);
  assert.match(prompt,/Do not invoke tools/);
  assert.match(prompt,/USER:\nWhat about motivation/);
});

test('unsupported answer does not invent any source quotations',()=>{
  assert.deepEqual(resolveEvidenceAnswer('Not in my sources.',[]),{ok:true,answer:'Not in my sources.'});
});
