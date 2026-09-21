import PDFDocument from 'pdfkit';

/**
 * Generates a professional PDF report stream from real MongoDB report metrics.
 * @param {Object} report MongoDB Report document or JSON
 * @param {WritableStream} res Express HTTP response stream
 */
export function generatePdfReport(report, res) {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 40,
    bufferPages: true
  });

  const filename = `Health_Report_${(report.patientId || 'PATIENT').replaceAll(' ', '_')}_${new Date(report.createdAt).toISOString().slice(0, 10)}.pdf`;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);

  doc.pipe(res);

  const primaryColor = '#0f172a'; // Slate 900
  const secondaryColor = '#2563eb'; // Blue 600
  const textDark = '#1e293b'; // Slate 800
  const textSubtle = '#64748b'; // Slate 500
  const bgLight = '#f8fafc'; // Slate 50
  const borderColor = '#e2e8f0'; // Slate 200

  // 1. Header Banner
  doc.rect(0, 0, doc.page.width, 90).fill('#0f172a');

  doc.fillColor('#38bdf8').fontSize(22).font('Helvetica-Bold').text('SMART HEALTH', 40, 24, { continued: true });
  doc.fillColor('#ffffff').fontSize(22).font('Helvetica-Bold').text(' MONITORING SYSTEM');

  doc.fillColor('#94a3b8').fontSize(10).font('Helvetica').text('CLINICAL BIOMETRIC & DIAGNOSTIC INTELLIGENCE REPORT', 40, 52);

  // Status Badge on Header
  const statusText = report.status || 'GENERATED';
  const badgeWidth = 100;
  const badgeX = doc.page.width - 40 - badgeWidth;
  doc.roundedRect(badgeX, 30, badgeWidth, 26, 4).fill('#1e293b');
  doc.fillColor('#38bdf8').fontSize(10).font('Helvetica-Bold').text(`STATUS: ${statusText}`, badgeX, 38, { width: badgeWidth, align: 'center' });

  let y = 105;

  // 2. Report Overview & Metadata Box
  doc.roundedRect(40, y, doc.page.width - 80, 110, 6).fill(bgLight).stroke(borderColor);

  doc.fillColor(primaryColor).fontSize(14).font('Helvetica-Bold').text(report.title || 'Comprehensive Health Assessment Report', 55, y + 15);

  const col1X = 55;
  const col2X = 300;
  const metaY = y + 42;

  doc.fontSize(9).font('Helvetica');

  // Col 1
  doc.fillColor(textSubtle).text('Report ID:', col1X, metaY);
  doc.fillColor(textDark).font('Helvetica-Bold').text(report.reportId || 'RPT-N/A', col1X + 80, metaY);

  doc.fillColor(textSubtle).font('Helvetica').text('Report Type:', col1X, metaY + 18);
  doc.fillColor(textDark).font('Helvetica-Bold').text(report.reportType?.replaceAll('_', ' ') || 'COMPREHENSIVE', col1X + 80, metaY + 18);

  doc.fillColor(textSubtle).font('Helvetica').text('Created Date/Time:', col1X, metaY + 36);
  const formattedDate = new Date(report.createdAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'medium' });
  doc.fillColor(textDark).font('Helvetica-Bold').text(formattedDate, col1X + 100, metaY + 36);

  // Col 2
  doc.fillColor(textSubtle).font('Helvetica').text('Generated User:', col2X, metaY);
  doc.fillColor(textDark).font('Helvetica-Bold').text(`${report.createdByUsername} (${report.createdByUserRole})`, col2X + 85, metaY);

  doc.fillColor(textSubtle).font('Helvetica').text('Patient Target:', col2X, metaY + 18);
  doc.fillColor(secondaryColor).font('Helvetica-Bold').text(report.patientId || 'P-101', col2X + 85, metaY + 18);

  doc.fillColor(textSubtle).font('Helvetica').text('Device Hardware:', col2X, metaY + 36);
  doc.fillColor(textDark).font('Helvetica-Bold').text(report.deviceId || 'ESP32_HEALTH_01', col2X + 85, metaY + 36);

  y += 130;

  // 3. Overall Risk Assessment Callout
  const summary = report.metricsSummary || {};
  const risk = summary.risk || {};
  const riskLevel = risk.overallRisk || 'INSUFFICIENT_DATA';

  let riskBg = '#f0fdf4'; // Light green
  let riskBorder = '#86efac';
  let riskText = '#166534';
  if (riskLevel === 'HIGH_RISK') {
    riskBg = '#fef2f2';
    riskBorder = '#fca5a5';
    riskText = '#991b1b';
  } else if (riskLevel !== 'LOW_RISK') {
    riskBg = '#fffbeb';
    riskBorder = '#fde68a';
    riskText = '#92400e';
  }


  doc.roundedRect(40, y, doc.page.width - 80, 80, 6).fill(riskBg).stroke(riskBorder);

  doc.fillColor(riskText).fontSize(12).font('Helvetica-Bold').text('OVERALL HEALTH RISK ASSESSMENT', 55, y + 15);
  doc.fillColor(riskText).fontSize(18).font('Helvetica-Bold').text(riskLevel.replaceAll('_', ' '), doc.page.width - 240, y + 12, { width: 185, align: 'right' });

  const reasons = (risk.reasons && risk.reasons.length > 0) ? risk.reasons.join(' • ') : 'All vital parameters within evaluated clinical boundaries.';
  doc.fillColor(textDark).fontSize(9).font('Helvetica').text(`Clinical Reasons: ${reasons}`, 55, y + 42, { width: doc.page.width - 110 });

  y += 95;

  // 4. Real Vitals Aggregation Table
  doc.fillColor(primaryColor).fontSize(12).font('Helvetica-Bold').text('REAL-TIME VITAL SIGNS SUMMARY (MongoDB Source)', 40, y);
  y += 20;

  // Table Header
  const tableX = 40;
  const colWidths = [120, 115, 115, 115];
  doc.rect(tableX, y, doc.page.width - 80, 24).fill('#1e293b');

  doc.fillColor('#ffffff').fontSize(9).font('Helvetica-Bold');
  doc.text('VITAL PARAMETER', tableX + 10, y + 7, { width: colWidths[0] });
  doc.text('AVERAGE VALUE', tableX + colWidths[0], y + 7, { width: colWidths[1], align: 'center' });
  doc.text('MIN / MAX RANGE', tableX + colWidths[0] + colWidths[1], y + 7, { width: colWidths[2], align: 'center' });
  doc.text('STATUS', tableX + colWidths[0] + colWidths[1] + colWidths[2], y + 7, { width: colWidths[3], align: 'center' });

  y += 24;

  const vitalsData = summary.vitals || {};
  const rows = [
    {
      name: 'Heart Rate (BPM)',
      avg: vitalsData.avgHeartRate ? `${vitalsData.avgHeartRate} BPM` : 'N/A',
      range: vitalsData.minHeartRate ? `${vitalsData.minHeartRate} - ${vitalsData.maxHeartRate} BPM` : 'N/A',
      status: vitalsData.avgHeartRate ? (vitalsData.avgHeartRate >= 60 && vitalsData.avgHeartRate <= 100 ? 'NORMAL' : 'ATTENTION') : 'NO DATA'
    },
    {
      name: 'Blood Oxygen (SpO2)',
      avg: vitalsData.avgSpo2 ? `${vitalsData.avgSpo2}%` : 'N/A',
      range: vitalsData.minSpo2 ? `${vitalsData.minSpo2}% - ${vitalsData.maxSpo2}%` : 'N/A',
      status: vitalsData.avgSpo2 ? (vitalsData.avgSpo2 >= 95 ? 'OPTIMAL' : 'LOW SPO2') : 'NO DATA'
    },
    {
      name: 'Body Temp (°C)',
      avg: vitalsData.avgTemp ? `${vitalsData.avgTemp}°C` : 'N/A',
      range: vitalsData.minTemp ? `${vitalsData.minTemp}°C - ${vitalsData.maxTemp}°C` : 'N/A',
      status: vitalsData.avgTemp ? (vitalsData.avgTemp >= 36.1 && vitalsData.avgTemp <= 37.5 ? 'NORMAL' : 'ABNORMAL') : 'NO DATA'
    }
  ];

  rows.forEach((row, i) => {
    const rowBg = i % 2 === 0 ? '#ffffff' : bgLight;
    doc.rect(tableX, y, doc.page.width - 80, 22).fill(rowBg).stroke(borderColor);

    doc.fillColor(textDark).fontSize(9).font('Helvetica-Bold').text(row.name, tableX + 10, y + 6);
    doc.font('Helvetica').text(row.avg, tableX + colWidths[0], y + 6, { width: colWidths[1], align: 'center' });
    doc.text(row.range, tableX + colWidths[0] + colWidths[1], y + 6, { width: colWidths[2], align: 'center' });
    
    const isNormal = row.status === 'NORMAL' || row.status === 'OPTIMAL';
    doc.fillColor(isNormal ? '#166534' : '#991b1b').font('Helvetica-Bold').text(row.status, tableX + colWidths[0] + colWidths[1] + colWidths[2], y + 6, { width: colWidths[3], align: 'center' });
    
    y += 22;
  });

  y += 15;

  // 5. Dual ML Model Intelligence Section
  doc.fillColor(primaryColor).fontSize(12).font('Helvetica-Bold').text('AI / MACHINE LEARNING DIAGNOSTIC MODEL OUTPUTS', 40, y);
  y += 20;

  const boxW = (doc.page.width - 90) / 2;
  const ecgMl = summary.ecgMl || {};
  const vitalMl = summary.vitalMl || {};

  // Box 1: ECG ML
  doc.roundedRect(40, y, boxW, 85, 6).fill(bgLight).stroke(borderColor);
  doc.fillColor(secondaryColor).fontSize(10).font('Helvetica-Bold').text('1. ECG Arrhythmia Classifier', 52, y + 12);
  doc.fillColor(textDark).fontSize(9).font('Helvetica');
  doc.text(`Classification Risk: ${ecgMl.riskLabel || 'N/A'}`, 52, y + 30);
  doc.text(`Confidence Probability: ${ecgMl.riskProbability != null ? (ecgMl.riskProbability * 100).toFixed(2) + '%' : 'N/A'}`, 52, y + 45);
  doc.text(`Dataset Basis: MIT-BIH (187 points)`, 52, y + 60);

  // Box 2: Vital ML
  doc.roundedRect(40 + boxW + 10, y, boxW, 85, 6).fill(bgLight).stroke(borderColor);
  doc.fillColor(secondaryColor).fontSize(10).font('Helvetica-Bold').text('2. Vital Signs Risk ML Model', 52 + boxW + 10, y + 12);
  doc.fillColor(textDark).fontSize(9).font('Helvetica');
  doc.text(`Classification Risk: ${vitalMl.riskLabel || 'N/A'}`, 52 + boxW + 10, y + 30);
  doc.text(`Confidence Probability: ${vitalMl.riskProbability != null ? (vitalMl.riskProbability * 100).toFixed(2) + '%' : 'N/A'}`, 52 + boxW + 10, y + 45);
  doc.text(`Model File: vital_risk_model.pkl`, 52 + boxW + 10, y + 60);

  y += 100;

  // 6. Recent Health Alerts Section
  const alerts = summary.alerts || [];
  doc.fillColor(primaryColor).fontSize(12).font('Helvetica-Bold').text(`RECOGNIZED HEALTH ALERTS (${alerts.length} Records)`, 40, y);
  y += 20;

  if (alerts.length === 0) {
    doc.fontSize(9).font('Helvetica-Oblique').fillColor(textSubtle).text('No critical or warning alerts logged for this evaluation period.', 40, y);
    y += 20;
  } else {
    alerts.slice(0, 4).forEach((alert) => {
      doc.rect(40, y, doc.page.width - 80, 20).fill('#fff1f2').stroke('#fecdd3');
      doc.fillColor('#9f1239').fontSize(8).font('Helvetica-Bold').text(`[${alert.severity || 'WARNING'}] ${alert.category || 'ALERT'}`, 50, y + 5);
      doc.fillColor(textDark).font('Helvetica').text(alert.message || '', 180, y + 5, { width: doc.page.width - 320 });
      doc.fillColor(textSubtle).text(new Date(alert.timestamp).toLocaleTimeString(), doc.page.width - 120, y + 5, { align: 'right' });
      y += 22;
    });
  }

  y += 15;

  // 7. Clinical Notes / Remarks
  if (report.notes) {
    doc.fillColor(primaryColor).fontSize(10).font('Helvetica-Bold').text('CLINICAL NOTES & OBSERVATIONS', 40, y);
    y += 15;
    doc.rect(40, y, doc.page.width - 80, 35).fill(bgLight).stroke(borderColor);
    doc.fillColor(textDark).fontSize(9).font('Helvetica-Oblique').text(report.notes, 50, y + 10, { width: doc.page.width - 100 });
    y += 45;
  }

  // 8. Footer (Page numbers and disclaimer)
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    
    // Temporarily set bottom margin to 0 to prevent automatic page breaks when printing footer
    const oldBottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;

    const bottomY = doc.page.height - 30;
    doc.moveTo(40, bottomY - 5).lineTo(doc.page.width - 40, bottomY - 5).strokeColor(borderColor).stroke();

    doc.fillColor(textSubtle).fontSize(8).font('Helvetica');
    doc.text('Smart Health IoT Monitoring System • Confidential Automated Medical Document', 40, bottomY);
    doc.text(`Page ${i + 1} of ${range.count}`, doc.page.width - 120, bottomY, { align: 'right' });

    // Restore bottom margin
    doc.page.margins.bottom = oldBottomMargin;
  }

  doc.end();
}
