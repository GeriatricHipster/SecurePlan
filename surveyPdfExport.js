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
