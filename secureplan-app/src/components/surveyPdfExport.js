import { categoryFor, itemFor, surveyDeviceCounts } from './deviceLibrary.js';

function safeText(value) {
  return String(value ?? '').trim();
}

export async function exportSurveyPdf({
  survey = {},
  site = {},
  elements = [],
  planImageDataUrl = null,
}) {
  const { default: jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
  const margin = 36;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  const surveyName = safeText(survey.name || survey.title || 'Survey');
  const siteName = safeText(site.name || site.title || 'Site');

  // Page 1: cover info + the marked-up floor plan image
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text('SecurePlan Survey Export', margin, 42);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text(`Site: ${siteName}`, margin, 66);
  doc.text(`Survey: ${surveyName}`, margin, 82);
  doc.text(`Generated: ${new Date().toLocaleString()}`, margin, 98);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('Marked-Up Floor Plan', margin, 124);

  if (planImageDataUrl) {
    const maxW = pageWidth - margin * 2;
    const maxH = pageHeight - 138;
    try {
      doc.addImage(planImageDataUrl, 'PNG', margin, 138, maxW, maxH, undefined, 'FAST');
    } catch (error) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(10);
      doc.text('The floor plan image could not be rendered for this export.', margin, 150);
    }
  } else {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(10);
    doc.text('A floor plan image was not available for this export.', margin, 150);
  }

  // Page 2+: every plotted device, individually, with name/category/type
  doc.addPage();
  const plottedDevices = elements.filter((element) => element.category !== 'markup');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('Plotted Devices', margin, 42);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`${plottedDevices.length} device${plottedDevices.length === 1 ? '' : 's'} plotted on this survey`, margin, 60);

  const iconSize = 14;
  const nameColX = margin + iconSize + 10;
  const categoryColX = margin + 300;
  const typeColX = margin + 460;
  let y = 92;

  const drawTableHeader = () => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('Device', nameColX, y);
    doc.text('Category', categoryColX, y);
    doc.text('Type', typeColX, y);
    y += 8;
    doc.setDrawColor(180);
    doc.line(margin, y, pageWidth - margin, y);
    y += 16;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
  };

  drawTableHeader();

  plottedDevices.forEach((element) => {
    const item = itemFor(element.category, element.type);
    if (item?.reportIcon) {
      try {
        doc.addImage(item.reportIcon, 'PNG', margin, y - iconSize + 2, iconSize, iconSize, undefined, 'FAST');
      } catch (error) {
        // Fall back to text-only for this row if the icon fails to decode.
      }
    }
    doc.text(safeText(element.label || item?.label || element.type), nameColX, y);
    doc.text(safeText(categoryFor(element.category)?.name || element.category || 'Custom'), categoryColX, y);
    doc.text(safeText(item?.label || element.type), typeColX, y);
    y += Math.max(16, iconSize + 4);
    if (y > pageHeight - 60) {
      doc.addPage();
      y = 50;
      drawTableHeader();
    }
  });

  // Summary by type, appended after the individual device list
  const counts = surveyDeviceCounts(elements);
  if (counts.length) {
    if (y > pageHeight - 140) {
      doc.addPage();
      y = 50;
    } else {
      y += 24;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text('Summary by Type', margin, y);
    y += 26;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    counts.forEach((row) => {
      if (row.reportIcon) {
        try {
          doc.addImage(row.reportIcon, 'PNG', margin, y - iconSize + 3, iconSize, iconSize, undefined, 'FAST');
        } catch (error) {
          // Fall back to text-only for this row if the icon fails to decode.
        }
        doc.text(`${row.label}: ${row.count}`, margin + iconSize + 8, y);
      } else {
        doc.text(`${row.label}: ${row.count}`, margin, y);
      }
      y += Math.max(16, iconSize + 4);
      if (y > pageHeight - 72) {
        doc.addPage();
        y = 50;
      }
    });
  }

  doc.save(`${siteName || 'Site'} - ${surveyName || 'Survey'}.pdf`);
}
