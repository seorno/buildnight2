import http from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parsePages, verifyAnswer } from './evidence.mjs';
import { prepareEvidence, evidencePrompt, resolveEvidenceAnswer, evidenceFallback } from './grounding.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const STATIC = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/research.html', ['research.html', 'text/html; charset=utf-8']],
  ['/assets/styles.css', ['assets/styles.css', 'text/css; charset=utf-8']],
  ['/assets/guide.css', ['assets/guide.css', 'text/css; charset=utf-8']],
  ['/assets/research.js', ['assets/research.js', 'text/javascript; charset=utf-8']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']]
]);
const MAX_QUESTION = 2000;
const MAX_BODY = 16_384;
// The model sees a bounded, question-relevant excerpt selection, not the entire library.

function respond(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(payload));
}

async function collectBody(req) {
  const parts = [];
  let size = 0;
  for await (const part of req) {
    size += part.length;
    if (size > MAX_BODY) { const error = new Error('Request is too large.'); error.status = 413; throw error; }
    parts.push(part);
  }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')); }
  catch { const error = new Error('Malformed JSON.'); error.status = 400; throw error; }
}

async function readSources(root) {
  const directory = path.join(root, 'sources', 'text');
  async function scan(dir, prefix = '') {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    const results=[];
    for (const entry of entries.sort((a,b)=>a.name.localeCompare(b.name, 'en'))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(dir,entry.name);
      if (entry.isDirectory()) results.push(...await scan(absolute,relative));
      else if (entry.isFile() && /\.(?:pdf|pptx|txt)\.txt$/i.test(entry.name)) {
        results.push({name:relative,content:await readFile(absolute,'utf8')});
      }
    }
    return results;
  }
  return scan(directory);
}

/** Runs Codex without handing filenames or user input to a shell command. */
export function runCodex(prompt, cwd) {
  return new Promise((resolve, reject) => {
    const child = execFile('codex', ['exec', '--skip-git-repo-check', '--ephemeral', '--sandbox', 'read-only', '-'], {
      cwd, timeout: 120_000, maxBuffer: 1024 * 1024, windowsHide: true, shell: process.platform === 'win32'
    }, (error, stdout, stderr) => {
      if (error) {
        if (error.code === 'ENOENT') reject(new Error('Codex CLI is not installed or not available in PATH.'));
        else if (error.killed) reject(new Error('Codex exceeded the two-minute time limit.'));
        else reject(new Error(`Codex failed: ${stderr.trim().slice(-450) || error.message}`));
      } else resolve(stdout.trim());
    });
    child.stdin?.on('error', () => {});
    child.stdin?.end(prompt);
  });
}

export function createAppServer({root = ROOT, runner = runCodex} = {}) {
  return http.createServer(async (req, res) => {
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('x-frame-options', 'DENY');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('content-security-policy', "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    let pathname;
    try { pathname = new URL(req.url, 'http://localhost').pathname; }
    catch { respond(res,400,{error:'Invalid URL.'}); return; }
    if (req.method === 'GET' && pathname === '/api/status') {
      try {
        const sources = await readSources(root);
        const pages = parsePages(sources);
        respond(res,200,{documents:new Set(pages.map(p=>p.filename)).size, pages:pages.length, ready:pages.some(p=>p.text.length>0)});
      } catch { respond(res,500,{error:'Could not read source library.'}); }
      return;
    }
    if (req.method === 'POST' && pathname === '/api/ask') {
      try {
        if (!(req.headers['content-type'] ?? '').startsWith('application/json')) { respond(res,415,{error:'Send JSON.'}); return; }
        const body = await collectBody(req);
        if (!body || !['ask','debate'].includes(body.mode) || typeof body.question !== 'string' || !body.question.trim() || body.question.length > MAX_QUESTION) {
          respond(res,400,{error:'Provide mode (ask or debate) and a question of 1–2000 characters.'}); return;
        }
        const sources = await readSources(root);
        const pages = parsePages(sources);
        if (!pages.some(p=>p.text.length)) { respond(res,200,{answer:'Not in my sources.'}); return; }
        let instructions;
        try { instructions = await readFile(path.join(root,'prompts',`${body.mode}.txt`),'utf8'); }
        catch (error) { if (error.code==='ENOENT') { respond(res,503,{error:`${body.mode} mode isn't set up yet.`}); return; } throw error; }
        const cards = prepareEvidence(pages,body.question);
        if (!cards.length) { respond(res,200,{answer:'Not in my sources.'}); return; }
        const prompt = evidencePrompt(instructions,cards,body.question);
        let rawAnswer;
        try { rawAnswer = await runner(prompt, path.join(root,'sources','text')); }
        catch (error) { respond(res,502,{error:error.message}); return; }
        const grounded = resolveEvidenceAnswer(rawAnswer,cards);
        if (grounded.ok) { respond(res,200,{answer:grounded.answer}); return; }
        // Backwards compatibility: accept an older-style answer only if every quote is verifiable.
        if (verifyAnswer(rawAnswer,pages).ok) { respond(res,200,{answer:rawAnswer}); return; }
        respond(res,200,{answer:evidenceFallback(cards),warning:'Codex response lacked verifiable citations.'});
      } catch(error) { respond(res,error.status || 500,{error:error.status ? error.message : 'The research request could not be completed.'}); }
      return;
    }
    if (req.method==='GET' && STATIC.has(pathname)) {
      const [relative, type] = STATIC.get(pathname);
      try {
        const data = await readFile(path.join(root,relative));
        res.writeHead(200,{'content-type':type,'cache-control':'no-cache'});
        res.end(data);
      } catch { respond(res,404,{error:'Not found.'}); }
      return;
    }
    respond(res,404,{error:'Not found.'});
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  createAppServer().listen(port,'127.0.0.1',()=>console.log(`Research page running at http://localhost:${port}/research.html`));
}
