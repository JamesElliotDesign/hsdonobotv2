function sanitizePdfText(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/£/g, 'GBP ')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
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

function isSectionHeading(line) {
  const value = String(line || '').trim();
  return Boolean(value) && value.length <= 56 && /^[A-Z0-9][A-Z0-9 &/()_-]+$/.test(value);
}

function textCommand(text, x, y, font = 'F1', size = 9) {
  return [
    'BT',
    `/${font} ${size} Tf`,
    `${x} ${y} Td`,
    `(${sanitizePdfText(text)}) Tj`,
    'ET',
  ].join('\n');
}

function createTextPdf(lines, options = {}) {
  const title = options.title || 'Hacksaw Support Evidence Receipt';
  const wrapped = lines.flatMap((line) => wrapLine(line));
  const linesPerPage = 55;
  const pages = [];

  for (let index = 0; index < wrapped.length; index += linesPerPage) {
    pages.push(wrapped.slice(index, index + linesPerPage));
  }
  if (pages.length === 0) pages.push(['']);

  const pageCount = pages.length;
  const firstFontObjectId = 3 + pageCount * 2;
  const regularFontObjectId = firstFontObjectId;
  const boldFontObjectId = firstFontObjectId + 1;
  const maxObjectId = boldFontObjectId;
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
      textCommand(title, 50, 810, 'F2', 14),
      textCommand(`Page ${index + 1} of ${pageCount}`, 500, 28, 'F1', 8),
    ];

    let y = 785;
    for (const line of pageLines) {
      if (isSectionHeading(line)) {
        commands.push(textCommand(line, 50, y, 'F2', 10));
      } else {
        commands.push(textCommand(line, 50, y, 'F1', 9));
      }
      y -= 13;
    }

    const stream = commands.join('\n');
    objects.set(
      pageId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${regularFontObjectId} 0 R /F2 ${boldFontObjectId} 0 R >> >> /Contents ${contentId} 0 R >>`
    );
    objects.set(contentId, `<< /Length ${Buffer.byteLength(stream, 'ascii')} >>\nstream\n${stream}\nendstream`);
  });

  objects.set(
    regularFontObjectId,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  );
  objects.set(
    boldFontObjectId,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'
  );

  let pdf = '%PDF-1.4\n%HACKSAW\n';
  const offsets = [0];
  for (let id = 1; id <= maxObjectId; id += 1) {
    offsets[id] = Buffer.byteLength(pdf, 'binary');
    pdf += `${id} 0 obj\n${objects.get(id)}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, 'binary');
  pdf += `xref\n0 ${maxObjectId + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let id = 1; id <= maxObjectId; id += 1) {
    pdf += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  }

  pdf += `trailer\n<< /Size ${maxObjectId + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'binary');
}

module.exports = { createTextPdf, sanitizePdfText };
