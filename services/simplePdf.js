function sanitizePdfText(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function wrapLine(line, width = 92) {
  const text = String(line ?? '');
  if (!text) return [''];
  const output = [];
  let remaining = text;

  while (remaining.length > width) {
    let splitAt = remaining.lastIndexOf(' ', width);
    if (splitAt < Math.floor(width * 0.55)) splitAt = width;
    output.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  output.push(remaining);
  return output;
}

function createTextPdf(lines, options = {}) {
  const title = options.title || 'Hacksaw Support Evidence Receipt';
  const wrapped = [title, '', ...lines].flatMap((line) => wrapLine(line));
  const linesPerPage = 56;
  const pages = [];

  for (let index = 0; index < wrapped.length; index += linesPerPage) {
    pages.push(wrapped.slice(index, index + linesPerPage));
  }
  if (pages.length === 0) pages.push(['']);

  const pageCount = pages.length;
  const fontObjectId = 3 + pageCount * 2;
  const objects = new Map();

  objects.set(1, '<< /Type /Catalog /Pages 2 0 R >>');

  const pageObjectIds = pages.map((_, index) => 3 + index * 2);
  objects.set(
    2,
    `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageCount} >>`
  );

  pages.forEach((pageLines, index) => {
    const pageId = 3 + index * 2;
    const contentId = pageId + 1;
    const commands = [
      'BT',
      '/F1 9 Tf',
      '50 800 Td',
      '12 TL',
      ...pageLines.map((line) => `(${sanitizePdfText(line)}) Tj T*`),
      'ET',
    ].join('\n');

    objects.set(
      pageId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontObjectId} 0 R >> >> /Contents ${contentId} 0 R >>`
    );
    objects.set(contentId, `<< /Length ${Buffer.byteLength(commands, 'ascii')} >>\nstream\n${commands}\nendstream`);
  });

  objects.set(fontObjectId, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  let pdf = '%PDF-1.4\n%HACKSAW\n';
  const offsets = [0];
  for (let id = 1; id <= fontObjectId; id += 1) {
    offsets[id] = Buffer.byteLength(pdf, 'binary');
    pdf += `${id} 0 obj\n${objects.get(id)}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, 'binary');
  pdf += `xref\n0 ${fontObjectId + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let id = 1; id <= fontObjectId; id += 1) {
    pdf += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  }

  pdf += `trailer\n<< /Size ${fontObjectId + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'binary');
}

module.exports = { createTextPdf };
