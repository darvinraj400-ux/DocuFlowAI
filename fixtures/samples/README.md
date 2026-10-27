# Sample fixtures

- `sample-invoice.json` — a synthetic, clearly-labelled extraction result for
  reproducible demos. It is not a real invoice.

To generate a tiny synthetic PDF for manual testing, install `pdf-lib` (already
a dependency) and run a snippet like:

```ts
import { PDFDocument } from "pdf-lib"
const doc = await PDFDocument.create()
doc.addPage([400, 600])
const bytes = await doc.save() // Uint8Array
```

Then save `bytes` to `fixtures/samples/sample-invoice.pdf`. For automated tests
we generate minimal PDFs in-process (see `tests/unit/file-validation.test.ts`).
