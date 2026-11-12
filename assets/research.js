const form = document.querySelector('#research-form');
const textarea = document.querySelector('#question');
const answer = document.querySelector('#answer');
const answerMode = document.querySelector('#answer-mode');
const ask = document.querySelector('#ask-button');
const debate = document.querySelector('#debate-button');
const count = document.querySelector('#char-count');
const label = document.querySelector('#library-label');
const dot = document.querySelector('#status-dot');
const documents = document.querySelector('#doc-count');
const pages = document.querySelector('#page-count');
let apiOnline = false;
let busy = false;

function setAnswer(text, state='result') {
  answer.className = state === 'error' ? 'answer-error' : state === 'waiting' ? 'answer-waiting' : 'answer-result';
  answer.textContent = text;
}

async function refreshLibrary() {
  try {
    const response = await fetch('api/status', {cache:'no-store'});
    if (!response.ok || !(response.headers.get('content-type') ?? '').includes('application/json')) throw Error('No local API');
    const result = await response.json();
    if (typeof result.documents !== 'number' || typeof result.pages !== 'number') throw Error('Invalid status');
    apiOnline = true;
    documents.textContent = String(result.documents).padStart(2,'0');
    pages.textContent = String(result.pages).padStart(2,'0');
    label.textContent = result.ready ? 'SOURCES READY' : 'AWAITING SOURCES';
    dot.classList.toggle('ready',Boolean(result.ready));
  } catch {
    apiOnline = false;
    documents.textContent = '—'; pages.textContent = '—';
    label.textContent = 'LOCAL SERVER OFFLINE';
    dot.classList.remove('ready');
    setAnswer('The Research page runs on my laptop. Ask me for a demo.\n\nTo run your own copy, open the project folder and enter: npm start', 'error');
    answerMode.textContent = 'OFFLINE';
  }
}

async function submit(mode) {
  if (busy) return;
  const question = textarea.value.trim();
  if (!question) { textarea.focus(); textarea.setCustomValidity('Please enter a question or claim.'); textarea.reportValidity(); return; }
  textarea.setCustomValidity('');
  if (!apiOnline) { setAnswer('The Research page runs on my laptop. Ask me for a demo.', 'error'); return; }
  busy = true;
  ask.disabled = true; debate.disabled = true;
  answerMode.textContent = mode === 'debate' ? 'CHALLENGE MODE' : 'ASK MODE';
  setAnswer('Thinking…\n\nReviewing your supplied readings and checking page references.', 'waiting');
  try {
    const response = await fetch('api/ask', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({mode,question}) });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || 'Something went wrong.');
    setAnswer(data.answer);
  } catch (error) { setAnswer(error.message || 'Request failed.', 'error'); }
  finally { busy=false; ask.disabled=false; debate.disabled=false; }
}
form.addEventListener('submit', event => {event.preventDefault();submit('ask');});
debate.addEventListener('click',()=>submit('debate'));
textarea.addEventListener('input',()=>{ textarea.setCustomValidity('');count.textContent=`${textarea.value.length} / 2000`; });
textarea.addEventListener('keydown',event=>{ if ((event.metaKey || event.ctrlKey) && event.key==='Enter') {event.preventDefault();submit('ask');} });
document.querySelectorAll('[data-question]').forEach(chip => chip.addEventListener('click',()=>{textarea.value=chip.dataset.question;textarea.dispatchEvent(new Event('input'));textarea.focus();}));
refreshLibrary();
