import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { convertPdfs } from '../convert.mjs';
import { parsePages, verifyAnswer } from '../evidence.mjs';

/** Minimal OOXML PowerPoint, deliberately with slide2 first in presentation order. */
async function makePresentation() {
  const zip = new JSZip();
  zip.file('ppt/presentation.xml', `<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldIdLst><p:sldId id="256" r:id="rId8"/><p:sldId id="257" r:id="rId7"/></p:sldIdLst></p:presentation>`);
  zip.file('ppt/_rels/presentation.xml.rels', `<Relationships><Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/><Relationship Id="rId8" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/></Relationships>`);
  zip.file('ppt/slides/slide1.xml', `<p:sld><p:sp><p:txBody><a:p><a:r><a:t>Final slide conclusion.</a:t></a:r></a:p></p:txBody></p:sp></p:sld>`);
  zip.file('ppt/slides/slide2.xml', `<p:sld><p:sp><p:txBody><a:p><a:r><a:t>First slide &amp; analysis.</a:t></a:r></a:p></p:txBody></p:sp></p:sld>`);
  zip.file('ppt/slides/_rels/slide2.xml.rels', `<Relationships><Relationship Id="rId99" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide9.xml"/></Relationships>`);
  zip.file('ppt/notesSlides/notesSlide9.xml', `<p:notes><p:sp><p:txBody><a:p><a:r><a:t>Speaker explanation in notes.</a:t></a:r></a:p></p:txBody></p:sp></p:notes>`);
  return zip.generateAsync({type:'nodebuffer'});
}

test('real PPTX conversion honors presentation slide order, XML entities and speaker notes', async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'research-pptx-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(path.join(root,'sources','HRM'),{recursive:true});
  await writeFile(path.join(root,'sources','HRM','seminar.pptx'),await makePresentation());
  const stats=await convertPdfs({root,logger:()=>{}});
  assert.equal(stats.slides,2);
  const content=await readFile(path.join(root,'sources','text','HRM','seminar.pptx.txt'),'utf8');
  const slides=parsePages([{name:'HRM/seminar.pptx.txt',content}]);
  assert.equal(slides.length,2);
  assert.match(slides[0].text,/First slide & analysis\./);
  assert.match(slides[0].text,/Speaker explanation in notes\./);
  assert.match(slides[1].text,/Final slide conclusion\./);
  assert.equal(verifyAnswer('"Speaker explanation in notes." (HRM/seminar.pptx, slide 1)',slides).ok,true);
  assert.equal(verifyAnswer('"Final slide conclusion." (HRM/seminar.pptx, slide 1)',slides).ok,false);
});
