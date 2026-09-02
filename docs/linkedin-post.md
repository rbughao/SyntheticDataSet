# LinkedIn announcement

Paste the block below straight into LinkedIn. It deliberately uses no Markdown —
LinkedIn does not render it, so bold and headings would post as literal
asterisks and hashes.

---

Built a browser tool that turns any document into LLM fine-tuning data — or a ready-made FAQ.

Drop in a PDF, a folder, a website, or a Drive folder. Get Q&A pairs out. Export as ChatML, Alpaca or ShareGPT for training — or CSV if you just want the FAQ.

• 68 file formats, including source code
• 8 providers — or Ollama locally, free
• No backend; nothing leaves your machine except the API calls you authorise

Two things I'm glad I built:
It estimates the cost before you spend it.
It refuses to send your .env file to an LLM.

MIT: github.com/rbughao/SyntheticDataSet

#LLM #FineTuning #MachineLearning #FAQ #OpenSource

---

## Notes

**Attach an image.** `docs/screenshots/03-review-workspace.png` is the best
single view — it reads as an FAQ to a non-ML viewer and as training data to an
ML one.

**The first line is the post.** LinkedIn truncates at roughly two lines before
"…see more", so both audiences — fine-tuning and FAQ — have to land there
rather than further down.

**Claims to keep honest if this gets edited:**

- *68 formats* — matches the extensions declared in `src/utils/fileReader.js`
- *8 providers* — seven real ones plus the offline Mock provider
- *CSV for an FAQ* — true; note the columns are `instruction,output,type`
  rather than `question,answer`, which is a rename away in a spreadsheet
- *No backend* — true of the app itself. URL import and site crawl do rely on
  the dev server's CORS proxy, so a deployed static build loses those two
  sources. Drop "or a website" from line 2 if you would rather not invite the
  question.
