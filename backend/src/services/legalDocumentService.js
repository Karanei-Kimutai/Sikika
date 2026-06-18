/**
 * legalDocumentService.js
 * -----------------------
 * Compiles the structured authoring fields of a LegalCaseFile into a PDF buffer
 * suitable for private Cloudinary storage and subsequent signed-URL delivery.
 *
 * Design notes:
 * - Uses pdfkit to generate a binary PDF in memory (no disk I/O).
 * - The generated document serves as a handover artifact; it never represents
 *   a legal opinion from the platform — counsel authors all content.
 * - The platform does NOT contact law enforcement or any external party. All
 *   handover and submission is performed manually by legal counsel.
 */

const PDFDocument = require('pdfkit');

/**
 * buildLegalCasePdfBuffer
 * -----------------------
 * Streams a PDF document into a Buffer from the authored fields of a legal case.
 *
 * Document structure:
 * 1. Header — platform name, document type label, generation date.
 * 2. Case metadata — case ID, escalation date, linked report ID, case status.
 * 3. Case summary (authored).
 * 4. Legal grounds (authored).
 * 5. Requested relief (authored).
 * 6. Recommended next steps (authored).
 * 7. Footer — disclaimer that this is a draft handover document.
 *
 * @param {object} legalCase  - LegalCaseFile model instance (toJSON-safe).
 * @param {object} report     - Associated IncidentReport object with report fields.
 * @returns {Promise<Buffer>} Resolved Buffer containing the full PDF binary.
 */
function buildLegalCasePdfBuffer(legalCase, report) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 60, size: 'A4' });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // ── Colour palette (matches project identity) ──────────────────────────────
    const PRIMARY = '#6c3483';   // brand purple
    const BODY    = '#2c2c2c';
    const MUTED   = '#555555';
    const RULE    = '#d3d3d3';

    // ── Header ─────────────────────────────────────────────────────────────────
    doc.fillColor(PRIMARY)
       .fontSize(18)
       .font('Helvetica-Bold')
       .text('Sikika Kenya', { align: 'center' });

    doc.moveDown(0.3)
       .fillColor(MUTED)
       .fontSize(11)
       .font('Helvetica')
       .text('Legal Case Handover Document', { align: 'center' });

    doc.moveDown(0.3)
       .fillColor(MUTED)
       .fontSize(9)
       .text(`Generated: ${new Date().toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' })} (EAT)`, { align: 'center' });

    doc.moveDown(1)
       .moveTo(60, doc.y).lineTo(535, doc.y).strokeColor(RULE).lineWidth(1).stroke();

    doc.moveDown(1);

    // ── Case metadata table ─────────────────────────────────────────────────────
    const metaRows = [
      ['Legal Case ID', legalCase.legalCaseId || '—'],
      ['Case Status', legalCase.currentCaseStatus || '—'],
      ['Linked Report ID', legalCase.reportId || '—'],
      ['Escalation Date', legalCase.escalationTimestamp
        ? new Date(legalCase.escalationTimestamp).toLocaleDateString('en-KE')
        : '—'
      ],
      ['Incident Category', report?.category || '—'],
      ['Severity', report?.severityLevel || '—'],
      ['Incident Date', report?.date || '—'],
      ['Location', report?.location || '—']
    ];

    doc.fillColor(PRIMARY).fontSize(12).font('Helvetica-Bold').text('Case Metadata');
    doc.moveDown(0.4);

    for (const [label, value] of metaRows) {
      doc.fillColor(MUTED).fontSize(9).font('Helvetica-Bold').text(`${label}:`, { continued: true, width: 160 });
      doc.fillColor(BODY).fontSize(9).font('Helvetica').text(`  ${value}`);
    }

    doc.moveDown(1)
       .moveTo(60, doc.y).lineTo(535, doc.y).strokeColor(RULE).lineWidth(0.5).stroke()
       .moveDown(1);

    // ── Helper — renders a section heading followed by authored text ────────────
    /**
     * @param {string} heading   - Section title.
     * @param {string} content   - Authored free-text body (may be empty/null).
     */
    function renderSection(heading, content) {
      doc.fillColor(PRIMARY).fontSize(12).font('Helvetica-Bold').text(heading);
      doc.moveDown(0.4);

      const body = String(content || '').trim();
      if (body) {
        doc.fillColor(BODY).fontSize(10).font('Helvetica').text(body, { lineGap: 4 });
      } else {
        doc.fillColor(MUTED).fontSize(10).font('Helvetica-Oblique').text('[Not yet authored]');
      }

      doc.moveDown(1)
         .moveTo(60, doc.y).lineTo(535, doc.y).strokeColor(RULE).lineWidth(0.5).stroke()
         .moveDown(1);
    }

    // ── Four authored sections ──────────────────────────────────────────────────
    renderSection('Case Summary', legalCase.caseSummary);
    renderSection('Legal Grounds', legalCase.legalGroundsText);
    renderSection('Requested Relief', legalCase.requestedReliefText);
    renderSection('Recommended Next Steps', legalCase.recommendedActionsText);

    // ── Footer disclaimer ──────────────────────────────────────────────────────
    doc.fontSize(8)
       .fillColor(MUTED)
       .font('Helvetica-Oblique')
       .text(
         'DISCLAIMER: This document is a draft handover artifact prepared by the assigned legal counsel ' +
         'using Sikika. It does not constitute a legal opinion issued by the platform ' +
         'or its operators. The platform does not contact law enforcement, courts, or any external party ' +
         'on behalf of a survivor — all handover and submission is performed manually by legal counsel ' +
         'in accordance with survivor consent.',
         { align: 'left', lineGap: 2 }
       );

    doc.end();
  });
}

module.exports = { buildLegalCasePdfBuffer };
