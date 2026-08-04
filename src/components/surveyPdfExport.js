import { categoryFor, itemFor } from './deviceLibrary.js';

function escapePdfText(text) {
  return String(text ?? '')
    .replaceAll('\\', '\\\\')
    .replaceAll('(', '\\(')
    .replaceAll(')', '\\)')
    .replaceAll('\r', ' ')
    .replaceAll('\n', ' ');
}

function countBy(items, getKey) {
  const counts = new Map();
  for (const item of items) {
    const key = getKey(item);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function toTypeLabel(element) {
  return itemFor(element.category, element.type)?.label || element.type || 'Unknown';
}

function buildSummaryLines(survey, site, elements) {
  const devices = elements.filter((element) => element.category !== 'markup');
  const byCategory = countBy(devices, (element) => categoryFor(element.category)?.name || 'Custom');
  const byType = countBy(devices, toTypeLabel);
  const lines = [];

  lines.push('SecurePlan Survey Report');
  lines.push('');
  lines.push(`Site: ${site?.name || 'Unknown site'}`);
  lines.push(`Survey: ${survey?.name || 'Untitled survey'}`);
  if (site?.address) lines.push(`Location: ${site.address}`);
  if (survey?.description) lines.push(`Description: ${survey.description}`);
  lines.push(`Generated: ${new Date().toLocaleString()}`);
  lines.push(`Total plotted devices: ${devices.length}`);
  lines.push('');
  lines.push('By system');
  for (const [label, count] of byCategory.entries()) {
    lines.push(`  - ${label}: ${count}`);
  }
  lines.push('');
  lines.push('By device type');
  for (const [label, count] of byType.entries()) {
    lines.push(`  - ${label}: ${count}`);
  }
  if (!byCategory.size && !byType.size) {
    lines.push('  No plotted devices found.');
  }
  return lines;
}

function paginate(lines, maxLinesPerPage = 42) {
  const pages = [];
  for (let index = 0; index < lines.length; index += maxLinesPerPage) {
    pages.push(lines.slice(index, index + maxLinesPerPage));
  }
  return pages.length ? pages : [[]];
}

function createPdfObject(stream) {
  return `${stream.length}\nstream\n${stream}\nendstream`;
}

function buildPdf(pages) {
  const objects = [];
  const pageRefs = [];
  const fontRef = 3;

  const makeContentStream = (pageLines) => {
    const width = 612;
    const height = 792;
    const margin = 48;
    const lineHeight = 15;
    const commands = [
      'BT',
      '/F1 12 Tf',
      '1 0 0 1 0 0 Tm',
    ];

    let y = height - margin;
    pageLines.forEach((line, index) => {
      const fontSize = index === 0 ? 18 : line === '' ? 10 : 12;
      const leading = line === '' ? 10 : lineHeight;
      commands.push(`BT /F1 ${fontSize} Tf 1 0 0 1 ${margin} ${y} Tm (${escapePdfText(line)}) Tj ET`);
      y -= leading;
    });

    return commands.join('\n');
  };

  const pageSize = [612, 792];
  pages.forEach((lines, index) => {
    const pageRef = 4 + index * 2;
    const contentRef = 5 + index * 2;
    pageRefs.push(pageRef);
    const contentStream = makeContentStream(lines);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageSize[0]} ${pageSize[1]}] /Contents ${contentRef} 0 R /Resources << /Font << /F1 ${fontRef} 0 R >> >> >>`);
    objects.push(`<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream`);
  });

  const kids = pageRefs.map((ref) => `${ref} 0 R`).join(' ');
  const catalog = `<< /Type /Catalog /Pages 2 0 R >>`;
  const pagesObject = `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`;
  const fontObject = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`;

  const allObjects = [catalog, pagesObject, fontObject, ...objects];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 0; i < allObjects.length; i += 1) {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${allObjects[i]}\nendobj\n`;
  }
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${allObjects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i < offsets.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer << /Size ${allObjects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return pdf;
}

export function downloadSurveyPdf({ survey, site, elements = [] }) {
  const summaryLines = buildSummaryLines(survey, site, elements);
  const pages = paginate(summaryLines);
  const pdf = buildPdf(pages);
  const blob = new Blob([pdf], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${(site?.name || 'site').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'secureplan'}-${(survey?.name || 'survey').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'report'}.pdf`;
  anchor.click();
  URL.revokeObjectURL(url);
}

import jsPDF from 'jspdf';
import { surveyDeviceCounts } from './deviceLibrary.js';

function safeText(value) {
  return String(value ?? '').trim();
}

export async function exportSurveyPdf({
  survey = {},
  site = {},
  elements = [],
  planImageDataUrl = null,
}) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
  const margin = 36;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  const surveyName = safeText(survey.name || survey.title || 'Survey');
  const siteName = safeText(site.name || site.title || 'Site');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text('SecurePlan Survey Export', margin, 42);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text(`Site: ${siteName}`, margin, 66);
  doc.text(`Survey: ${surveyName}`, margin, 82);
  doc.text(`Generated: ${new Date().toLocaleString()}`, margin, 98);

  const counts = surveyDeviceCounts(elements);
  const total = counts.reduce((sum, row) => sum + row.count, 0);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('Device Counts', margin, 130);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text(`Total plotted devices: ${total}`, margin, 150);

  let y = 170;
  counts.forEach((row) => {
    doc.text(`${row.label}: ${row.count}`, margin, y);
    y += 16;
    if (y > pageHeight - 72) {
      doc.addPage();
      y = 50;
    }
  });

  if (planImageDataUrl) {
    doc.addPage();
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text('Marked-Up Floor Plan', margin, 42);

    const maxW = pageWidth - margin * 2;
    const maxH = pageHeight - 70;
    doc.addImage(planImageDataUrl, 'PNG', margin, 56, maxW, maxH, undefined, 'FAST');
  }

  doc.save(`${siteName || 'Site'} - ${surveyName || 'Survey'}.pdf`);
}
