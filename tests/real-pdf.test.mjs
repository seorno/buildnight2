import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { convertPdfs } from '../convert.mjs';

/** Create a minimal valid PDF so the real pdfjs-dist path gets exercised in CI. */
function makePdf(text) {
  const content = `BT /F1 12 Tf 40 100 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [i, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i+1} 0 obj\n${object}\nendobj\n`;
  }
  const start = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10,'0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(pdf,'latin1');
}

test('real pdfjs-dist reads a genuine PDF and preserves source page attribution', async t => {
  const root = await mkdtemp(path.join(tmpdir(),'real-pdfjs-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(path.join(root,'sources'));
  await writeFile(path.join(root,'sources','sample.pdf'),makePdf('Evidence supports careful thinking.'));
  const stats = await convertPdfs({root,logger:()=>{}});
  assert.equal(stats.files,1);
  assert.equal(stats.pages,1);
  const result = await readFile(path.join(root,'sources','text','sample.pdf.txt'),'utf8');
  assert.match(result,/=== sample\.pdf \| page 1 ===/);
  assert.match(result,/Evidence supports careful thinking\./);
});
