import { getDocument, GlobalWorkerOptions } from "./vendor/pdfjs-5.6.205/pdf.min.mjs";

GlobalWorkerOptions.workerSrc = "/vendor/pdfjs-5.6.205/pdf.worker.min.mjs";

export async function showPdf(panel, blob, signal) {
  const data = await blob.arrayBuffer();
  if (signal.aborted) return;
  const task = getDocument({ data, isEvalSupported: false, useWasm: false });
  signal.addEventListener("abort", () => { task.destroy().catch(() => {}); }, { once: true });
  const pdf = await task.promise;
  const canvas = panel.querySelector("canvas");
  const status = panel.querySelector('[role="status"]');
  const previous = panel.querySelector("[data-previous]");
  const next = panel.querySelector("[data-next]");
  async function render(number) {
    previous.disabled = next.disabled = true;
    canvas.hidden = true;
    status.textContent = "กำลังโหลดหน้า " + number;
    try {
      const page = await pdf.getPage(number);
      if (signal.aborted) return;
      const width = Math.max(panel.clientWidth, 320);
      const scale = Math.min(width * (window.devicePixelRatio || 1), 1800) / page.getViewport({ scale: 1 }).width;
      const viewport = page.getViewport({ scale });
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, viewport }).promise;
      if (signal.aborted) return;
      canvas.hidden = false;
      canvas.setAttribute("aria-label", "หน้า " + number);
      status.textContent = `หน้า ${number} จาก ${pdf.numPages}`;
      previous.disabled = number === 1;
      next.disabled = number === pdf.numPages;
      previous.onclick = () => render(number - 1);
      next.onclick = () => render(number + 1);
    } catch {
      if (signal.aborted) return;
      status.textContent = "แสดงหน้า PDF ไม่สำเร็จ";
      panel.querySelector("[data-retry-pdf]").hidden = false;
    }
  }
  panel.querySelector("[data-pagination]").hidden = false;
  await render(1);
}
