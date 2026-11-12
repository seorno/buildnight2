# The Research Partner

A local-first, source-grounded research companion built for Bath Entrepreneurs' Innov8 Build Night 2. Use PDFs, TXT lecture notes and PPTX slide decks in nested folders. Ask a question or challenge a claim using only your own materials.

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

Codex now cites server-numbered evidence excerpts (e.g., [E1]) rather than writing exact quotations itself. The server resolves those IDs to original page, slide or line references and inserts verbatim text. If Codex returns an unverified answer, the app shows only a clearly labelled extractive fallback, never unsupported generated assertions. This checks literal attribution, not whether an interpretation is sound. Always read the original source before relying on it.

## Privacy and deployment

**PDFs and extracted text stay on your laptop.** The entire `sources/` folder is ignored by Git. The local HTTP server binds to `127.0.0.1`, and only a short allowlist of public frontend files is served; `/sources/` and `/prompts/` are inaccessible over HTTP. The source text *is sent to the Codex CLI/model service* to answer your questions, so do not use confidential documents unless that service is approved for them.

The homepage and research interface can be statically hosted, but **questions only work while the Node API is running locally**. On GitHub Pages, the Research page displays a demo/offline message rather than pretending its backend is deployed. No hosted backend, accounts, database or API keys are included.

The server calls `codex exec --skip-git-repo-check --ephemeral --sandbox read-only -` with a 120-second timeout. Each Ask or Debate request consumes applicable Codex usage. Rather than sending the full library each time, it selects at most 80 relevant, bounded excerpts. This is not comprehensive semantic retrieval; for very large reading collections, verify important omissions manually. No OCR is included.

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
