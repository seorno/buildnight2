import { readFile, readdir, mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const EXTENSIONS = /\.(?:pdf|pptx|txt)$/i;

/** List local files without following symlinks. Exclude the generated text directory. */
async function walk(directory, base = directory, skipText = false) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (skipText && entry.name === 'text' && directory === base) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await walk(absolute, base, skipText));
    else if (entry.isFile()) found.push(path.relative(base, absolute).split(path.sep).join('/'));
  }
  return found.sort((a, b) => a.localeCompare(b, 'en'));
}

function decodeXml(value) {
  return value.replace(/&(#x[\da-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, entity) => {
    const named = {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};
    if (entity in named) return named[entity];
    const n = entity.startsWith('#x') ? Number.parseInt(entity.slice(2),16) : Number(entity.slice(1));
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '';
  });
}

/** Extract visible PowerPoint text from paragraphs, including table cells. */
function xmlText(xml) {
  const paragraphs = [];
  for (const paragraph of xml.matchAll(/<a:p(?:\s[^>]*)?>([\s\S]*?)<\/a:p>/g)) {
    const runs = [...paragraph[1].matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)];
    const text = runs.map(match => decodeXml(match[1])).join('').trim();
    if (text) paragraphs.push(text);
  }
  return paragraphs.join('\n');
}

/** Read slide text and, when present, the speaker notes linked to that slide. */
export async function readPresentation(bytes) {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(bytes);
  const slides = Object.keys(zip.files)
    .map(name => ({ name, number: /^ppt\/slides\/slide(\d+)\.xml$/.exec(name)?.[1] }))
    .filter(item => item.number)
    .sort((a, b) => Number(a.number) - Number(b.number));
  // Slide filenames do not always match the presentation's visible slide order.
  let ordered = slides;
  const presentation = zip.file('ppt/presentation.xml');
  const relationships = zip.file('ppt/_rels/presentation.xml.rels');
  if (presentation && relationships) {
    const presXml = await presentation.async('string');
    const relXml = await relationships.async('string');
    const relMap = new Map();
    for (const rel of relXml.matchAll(/<Relationship\b[^>]*\/>/g)) {
      const id = /\bId="([^"]+)"/.exec(rel[0])?.[1];
      const target = /\bTarget="([^"]+)"/.exec(rel[0])?.[1];
      if (id && target && /\bType="[^"]*\/slide"/.test(rel[0])) {
        const filename = target.startsWith('/') ? target.slice(1) : path.posix.normalize(path.posix.join('ppt', decodeXml(target)));
        relMap.set(id, filename);
      }
    }
    const orderedNames = [...presXml.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"[^>]*\/>/g)]
      .map(match => relMap.get(match[1]))
      .filter(name => name && zip.file(name));
    if (orderedNames.length === slides.length) ordered = orderedNames.map(name => ({name}));
  }
  const result = [];
  for (const slide of ordered) {
    const number = /slide(\d+)\.xml$/.exec(slide.name)?.[1];
    const xml = await zip.file(slide.name).async('string');
    const text = xmlText(xml);
    const relsName = `ppt/slides/_rels/slide${number}.xml.rels`;
    let notes = '';
    if (zip.file(relsName)) {
      const rels = await zip.file(relsName).async('string');
      for (const rel of rels.matchAll(/<Relationship\b[^>]*\/>/g)) {
        if (!/\bType="[^"]*\/notesSlide"/.test(rel[0])) continue;
        const target = /\bTarget="([^"]+)"/.exec(rel[0])?.[1];
        if (!target) continue;
        const location = target.startsWith('/')
          ? path.posix.normalize(target.slice(1))
          : path.posix.normalize(path.posix.join('ppt/slides', decodeXml(target)));
        if (!/^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(location) || !zip.file(location)) continue;
        notes = xmlText(await zip.file(location).async('string'));
        break;
      }
    }
    result.push({ text, notes });
  }
  return result;
}

/** Convert PDFs, PPTX slide decks, and text transcripts under sources/, recursively. */
export async function convertPdfs({ root = ROOT, loadPdf, loadPresentation = readPresentation, logger = console.log } = {}) {
  const sourceDir = path.join(root, 'sources');
  const textDir = path.join(sourceDir, 'text');
  await mkdir(sourceDir, {recursive:true});
  await mkdir(textDir, {recursive:true});
  const names = (await walk(sourceDir, sourceDir, true)).filter(name => EXTENSIONS.test(name) && !path.posix.basename(name).startsWith('~$'));
  const expected = new Set(names.map(name => `${name}.txt`));
  for (const old of await walk(textDir)) {
    if (old.endsWith('.txt') && !expected.has(old)) await unlink(path.join(textDir, ...old.split('/')));
  }
  if (names.some(name => /\.pdf$/i.test(name)) && !loadPdf) {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    loadPdf = async bytes => getDocument({data:new Uint8Array(bytes),useSystemFonts:true,disableFontFace:true}).promise;
  }
  let pages = 0, slides = 0, sections = 0;
  for (const name of names) {
    const source = path.join(sourceDir, ...name.split('/'));
    const units = [];
    if (/\.pdf$/i.test(name)) {
      const pdf = await loadPdf(await readFile(source));
      try {
        for (let n = 1; n <= pdf.numPages; n++) {
          const page = await pdf.getPage(n);
          const {items} = await page.getTextContent();
          const text = items.map(item => `${item.str ?? ''}${item.hasEOL ? '\n' : ' '}`).join('').replace(/[ \t]+\n/g,'\n').trim();
          units.push(`=== ${name} | page ${n} ===\n${text}`);
        }
        pages += pdf.numPages;
      } finally { await pdf.destroy?.(); }
    } else if (/\.pptx$/i.test(name)) {
      const deck = await loadPresentation(await readFile(source), name);
      for (const [index, slide] of deck.entries()) {
        const text = [slide.text?.trim(), slide.notes?.trim() ? `Speaker notes:\n${slide.notes.trim()}` : ''].filter(Boolean).join('\n');
        units.push(`=== ${name} | slide ${index+1} ===\n${text}`);
      }
      slides += deck.length;
    } else {
      const text = (await readFile(source,'utf8')).replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
      // Keep the actual original line numbers in citations (40 lines per chunk).
      const lines = text.endsWith('\n') ? text.slice(0,-1).split('\n') : text.split('\n');
      for(let i=0; i<lines.length; i+=40) {
        const chunk = lines.slice(i,i+40).join('\n').trim();
        if (chunk) units.push(`=== ${name} | lines ${i+1}-${Math.min(i+40, lines.length)} ===\n${chunk}`);
      }
      sections += units.length;
    }
    const target = path.join(textDir, ...`${name}.txt`.split('/'));
    await mkdir(path.dirname(target), {recursive:true});
    await writeFile(target, `${units.join('\n\n')}\n`, 'utf8');
    const words = (units.join(' ').match(/\S+/g) ?? []).length;
    logger(`${name}: ${units.length} ${/\.pdf$/i.test(name) ? 'pages' : /\.pptx$/i.test(name) ? 'slides' : 'sections'}, ${words} words`);
    if (/\.pdf$/i.test(name) && words < Math.max(25, units.length*8)) logger(`Warning: ${name} has almost no extractable text (probably a scan).`);
    if (/\.pptx$/i.test(name) && words < Math.max(25, units.length*8)) logger(`Warning: ${name} has little extractable text (it may contain slide images).`);
  }
  logger('Done.');
  return { files:names.length, pages, slides, sections };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  convertPdfs().catch(error => {console.error(error.message); process.exitCode=1;});
}
