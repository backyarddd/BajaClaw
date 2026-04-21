---
name: ocr-pdf
description: Extract text from PDFs and images. Installs tesseract and poppler automatically.
version: 0.1.0
tools: [Bash, Read, Write]
triggers: ["ocr", "extract text from pdf", "read the pdf", "scanned document", "image to text", "tesseract", "pdf to text", "what does this pdf say", "receipt text", "invoice text"]
effort: low
---

## Non-negotiable rules

1. **Ensure first.** Before invoking `pdftotext` or `tesseract`,
   run the right ensure calls:

   ```bash
   bajaclaw ensure poppler     # pdftotext, pdfimages, pdftoppm
   bajaclaw ensure tesseract   # ocr engine
   ```

2. **Text PDFs first, OCR as fallback.** Most PDFs have a real
   text layer. Try `pdftotext` before burning seconds on OCR -
   OCR is slower and error-prone.
3. **Never upload the user's file.** Everything runs locally.

## Decide: text layer or scan?

```bash
pdf=/path/to/doc.pdf
pdftotext "$pdf" - | head -c 200
```

- Output is readable text -> use the text-layer path.
- Output is empty or gibberish -> the PDF is an image scan, use OCR.

`pdfinfo "$pdf"` also reports "Pages: N" and metadata that helps
shape the rest.

## Path A - Text layer (fast)

```bash
pdftotext -layout "$pdf" /tmp/out.txt   # preserve columns
pdftotext "$pdf" /tmp/out.txt           # reflow; better for prose
```

Page range:

```bash
pdftotext -f 1 -l 3 "$pdf" /tmp/pages1-3.txt
```

Per-page split:

```bash
for i in $(seq 1 $(pdfinfo "$pdf" | awk '/^Pages:/{print $2}')); do
  pdftotext -f "$i" -l "$i" "$pdf" "/tmp/p${i}.txt"
done
```

## Path B - OCR (slower, for scans)

Step 1: rasterize each page to PNG at 300 DPI:

```bash
pdftoppm -r 300 -png "$pdf" /tmp/page
# produces /tmp/page-1.png, /tmp/page-2.png, ...
```

Step 2: OCR each page:

```bash
for img in /tmp/page-*.png; do
  tesseract "$img" "${img%.png}" -l eng
  # produces <name>.txt next to each image
done
cat /tmp/page-*.txt > /tmp/out.txt
```

For non-English docs, pick the right `-l` code (`eng`, `spa`, `fra`,
`deu`, `chi_sim`, etc.). Multi-language: `-l eng+spa`.

### Tuning OCR accuracy

- `--oem 1` uses LSTM (best modern engine).
- `--psm 6` assumes "single uniform block of text" - best for
  dense pages. Try `--psm 4` ("single column, variable sizes")
  for structured documents like forms.
- Before OCR, consider `pdftoppm -r 400` for very small print,
  or pre-process the PNG with `convert` (ImageMagick) to deskew +
  denoise. That's out-of-scope for this skill but worth knowing.

## Just an image (no PDF)

```bash
tesseract /path/to/image.png /tmp/out -l eng
cat /tmp/out.txt
```

Common image formats (PNG/JPG/TIFF) work directly.

## Post-processing

Both paths produce a text blob. Before presenting it:

- Strip obvious junk (form-feed `\f`, long runs of whitespace,
  control chars): `tr -d '\f' < /tmp/out.txt | cat -s`
- Detect page boundaries if you need per-page output (form feeds
  are standard page separators from `pdftotext -layout`).
- Watch for OCR confusions: `rn` vs `m`, `0` vs `O`, `1` vs `l`.
  If precise transcription matters (receipts, invoices), highlight
  uncertain tokens to the user rather than silently guessing.

## Pitfalls

- **Password-protected PDFs.** `pdftotext` takes `-upw <user>` and
  `-opw <owner>` for passwords. Without them, it fails. Ask the
  user for the password rather than guessing.
- **Encrypted-with-permissions PDFs.** Some PDFs allow reading but
  not copying text. Poppler honors the flag. Use OCR as fallback.
- **Image-only PDFs with huge page counts.** OCR'ing 500 pages at
  300 DPI is slow and fills disk with intermediate PNGs. Warn the
  user before you start. Clean up `/tmp/page-*.png` when done.
- **Tesseract language data.** Only English ships by default on
  many platforms. For other languages, install the data pack:
  brew: `brew install tesseract-lang`. apt: `apt-get install
  tesseract-ocr-<lang>` (e.g. `tesseract-ocr-spa`). If your
  extraction returns junk for non-English text, it's probably this.
- **Scanned tables.** OCR + tables = grief. `pdftotext -layout`
  handles digital tables; OCR'd tables need a different tool
  (camelot, tabula) which is out of scope here.

## Verification

- `file /tmp/out.txt` reports `UTF-8 Unicode text` (or ASCII).
- `wc -l /tmp/out.txt` matches your expectation given the document
  length. Empty output = something went wrong; re-check path A/B
  decision.
- Spot-check the output against a known phrase from the document.
