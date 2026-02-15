/**
 * pdf2json wrapper — extracts positioned text items from PDF.
 * Used for coordinate-aware extraction of chart labels.
 */
import PDFParser from "pdf2json";
import type { TextItem } from "./utils.js";

interface Pdf2JsonText {
  R: Array<{ T: string; TS: number[] }>;
  x: number;
  y: number;
  w: number;
}

interface Pdf2JsonPage {
  Texts: Pdf2JsonText[];
  Width: number;
  Height: number;
}

interface Pdf2JsonOutput {
  Pages: Pdf2JsonPage[];
}

/** Parse a PDF file and return positioned text items per page */
export async function extractTextItems(
  pdfPath: string,
): Promise<{ items: TextItem[]; pageCount: number }> {
  return new Promise((resolve, reject) => {
    const parser = new PDFParser(null, true);

    parser.on("pdfParser_dataReady", (data: Pdf2JsonOutput) => {
      const items: TextItem[] = [];

      for (let pageIdx = 0; pageIdx < data.Pages.length; pageIdx++) {
        const page = data.Pages[pageIdx];
        for (const text of page.Texts) {
          const decoded = text.R.map((r) => decodeURIComponent(r.T)).join("");
          if (!decoded.trim()) continue;

          items.push({
            text: decoded,
            x: text.x,
            y: text.y,
            width: text.w,
            height: text.R[0]?.TS?.[1] || 10,
            page: pageIdx + 1,
          });
        }
      }

      resolve({ items, pageCount: data.Pages.length });
    });

    parser.on("pdfParser_dataError", (err: unknown) => {
      const msg = err instanceof Error ? err.message :
        typeof err === "object" && err !== null && "parserError" in err ? String((err as Record<string, unknown>).parserError) :
        String(err);
      reject(new Error(`pdf2json error: ${msg}`));
    });

    parser.loadPDF(pdfPath);
  });
}
