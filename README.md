# The Research Partner

An independent, **local-first research companion** built for Bath Entrepreneurs' Innov8 Build Night 2. Ask questions about your own PDF readings, or use Debate mode to challenge a claim using only those readings.

[Open the research room after starting the server](http://localhost:3000/research.html)

## Requirements

- Node.js 20 or newer.
- The [Codex CLI](https://github.com/openai/codex) installed, authenticated, and available as `codex` on your `PATH`. The Codex CLI's applicable access/usage costs are your responsibility.
- Text-based PDF research papers. Image-only scans require OCR beforehand; the converter warns when it extracts almost no text.

## Start in four steps

```sh
npm install
mkdir -p sources     # On Windows, create the folder in File Explorer if needed.
# Copy your PDFs into sources/ (on your own computer).
npm run convert
npm start
```

Visit <http://localhost:3000/research.html>. Keep the terminal running. On Windows the commands are the same except for the folder-creation line. Sign into the Codex CLI first if needed (typically `codex login`).

If you add, remove or change PDFs, rerun `npm run convert`. The converter writes `sources/text/<filename>.pdf.txt` and labels every page `=== filename.pdf | page N ===`.

### Modes

- **Ask:** Answers a question using source quotations and page citations.
- **Challenge:** Makes the strongest evidence-backed case against your claim, without inventing a counterargument.
- **Not in my sources.:** Returned when there is no basis for an answer.

The server checks that each double-quoted excerpt appears on the exact cited PDF page. **This is a literal-quotation check, not a guarantee that the model's interpretation or the research itself is correct.** A good answer can be rejected if PDF extraction garbles words, punctuation or line breaks. Review the original paper before relying on a result.

## Privacy and deployment

**PDFs and extracted text stay on your laptop.** The entire `sources/` folder is ignored by Git. The local HTTP server binds to `127.0.0.1`, and only a short allowlist of public frontend files is served; `/sources/` and `/prompts/` are inaccessible over HTTP. The source text *is sent to the Codex CLI/model service* to answer your questions, so do not use confidential documents unless that service is approved for them.

The homepage and research interface can be statically hosted, but **questions only work while the Node API is running locally**. On GitHub Pages, the Research page displays a demo/offline message rather than pretending its backend is deployed. No hosted backend, accounts, database or API keys are included.

The server uses `codex exec --skip-git-repo-check --ephemeral --sandbox read-only -`, with a 120-second timeout. The response must contain exact quotes followed by `(filename.pdf, p. N)` citations, or exactly `Not in my sources.`. Invalid citations are rejected rather than displayed. The system does not perform OCR or semantic retrieval; it sends all extracted text per request, with a 1 MB source limit to prevent runaway contexts.

## Checks

```sh
npm run check
```

The test suite covers conversion, citation verification, both API modes, invalid inputs, fallback responses and protection against serving private files. Tests mock the model process; they **do not establish that your own Codex account and supplied PDFs will produce useful research answers**. Test with a real paper and manually verify a quotation after setup.

## Files

| File | Purpose |
|---|---|
| `index.html` | Editorial landing page |
| `research.html`, `assets/` | Research UI, mobile layout and interactions |
| `convert.mjs` | PDF to page-labelled text conversion |
| `server.mjs` | Local static server and `/api/ask` + `/api/status` endpoints |
| `evidence.mjs` | Page parsing, prompt assembly and exact quote checks |
| `prompts/` | Source-only Ask and Debate instructions |
| `tests/` | Node built-in unit and integration tests |

Built as a standalone repository because `seorno/buildnight2` was empty when work began.
