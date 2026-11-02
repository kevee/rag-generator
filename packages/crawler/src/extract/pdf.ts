import { extractText, getDocumentProxy, getMeta } from "unpdf";

export interface ExtractedPdf {
  title: string | null;
  text: string;
  pages: number;
  /** True when the PDF has no usable text layer (likely scanned). */
  empty: boolean;
}

function cleanPdfText(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function pdfToText(buffer: Buffer): Promise<ExtractedPdf> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { totalPages, text } = await extractText(pdf, { mergePages: true });
  let title: string | null = null;
  try {
    const meta = await getMeta(pdf);
    const info = meta.info as unknown as Record<string, unknown> | undefined;
    const t = info?.Title;
    if (typeof t === "string" && t.trim() && !/^untitled$/i.test(t.trim())) title = t.trim();
  } catch {
    // metadata is optional
  }
  const cleaned = cleanPdfText(text);
  return { title, text: cleaned, pages: totalPages, empty: cleaned.replace(/\s/g, "").length < 50 };
}
