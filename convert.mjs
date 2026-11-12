import { readFile, readdir, mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Extract each page separately, preserving page attribution in the output. */
export async function convertPdfs({ root = path.dirname(fileURLToPath(import.meta.url)), loadPdf, logger = console.log } = {}) {
  const sourceDir = path.join(root, 'sources');
  const textDir = path.join(sourceDir, 'text');
  await mkdir(textDir, { recursive: true });
  const names = (await readdir(sourceDir)).filter(name => /\.pdf$/i.test(name)).sort();
  const outputs = new Set(names.map(name => `${name}.txt`));
  for (const old of await readdir(textDir)) {
    if (old.endsWith('.txt') && !outputs.has(old)) await unlink(path.join(textDir, old));
  }
  if (names.length && !loadPdf) {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    loadPdf = async bytes => getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, disableFontFace: true }).promise;
  }
  let totalPages = 0;
  for (const name of names) {
    const pdf = await loadPdf(await readFile(path.join(sourceDir, name)));
    let words = 0;
    const pages = [];
    try {
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        const page = await pdf.getPage(pageNumber);
        const { items } = await page.getTextContent();
        const text = items.map(item => `${item.str ?? ''}${item.hasEOL ? '\n' : ' '}`).join('').replace(/[ \t]+\n/g, '\n').trim();
        words += (text.match(/\S+/g) ?? []).length;
        pages.push(`=== ${name} | page ${pageNumber} ===\n${text}`);
      }
    } finally {
      await pdf.destroy?.();
    }
    await writeFile(path.join(textDir, `${name}.txt`), `${pages.join('\n\n')}\n`, 'utf8');
    totalPages += pdf.numPages;
    logger(`${name}: ${pdf.numPages} pages, ${words} words`);
    if (words < Math.max(25, pdf.numPages * 8)) logger(`Warning: ${name} has almost no extractable text (probably a scan).`);
  }
  logger('Done.');
  return { files: names.length, pages: totalPages };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  convertPdfs().catch(error => { console.error(error.message); process.exitCode = 1; });
}
