const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

// Ensure uploads/ndas directory exists
const NDA_DIR = process.env.NDA_UPLOAD_DIR || './uploads/ndas';

/**
 * Generate a signed NDA PDF
 * @param {Object} options - NDA data
 * @returns {Promise<string>} - Path to generated PDF
 */
async function generateNdaPdf(options) {
  const {
    ndaId,
    effectiveDate,
    party1, // Signer (prospect)
    party2, // Counter-signer (Aragon Holdings)
    signedAt
  } = options;

  // Ensure directory exists
  await fs.promises.mkdir(NDA_DIR, { recursive: true });

  const filename = `nda-${ndaId}.pdf`;
  const filePath = path.join(NDA_DIR, filename);

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'LETTER',
        margins: { top: 72, bottom: 72, left: 72, right: 72 }
      });

      const stream = fs.createWriteStream(filePath);
      doc.pipe(stream);

      // Header
      doc.fontSize(20).font('Helvetica-Bold')
        .text('Mutual Non-Disclosure Agreement', { align: 'center' });

      doc.moveDown();

      // Effective date
      doc.fontSize(11).font('Helvetica')
        .text(`This Non-Disclosure Agreement ("Agreement") governs the disclosure of information by and between the parties signing below as of ${formatDate(effectiveDate)} (the "Effective Date").`);

      doc.moveDown();

      // Section 1
      doc.font('Helvetica-Bold').text('1. ', { continued: true })
        .font('Helvetica')
        .text('"Confidential Information" means any and all technical and non-technical information provided by either party to the other, including but not limited to (a) patent and patent applications, (b) trade secret, and (c) proprietary information, ideas, samples, media, techniques, sketches, drawings, works of authorship, models, inventions, know-how, processes, apparatuses, equipment, algorithms, software programs, software source documents, and formulae related to the current, future, and proposed products and services of each of the parties, and including, without limitation, their respective information concerning research, experimental work, development, design details and specifications, engineering, financial information, procurement requirements, purchasing, manufacturing, customer lists, investors, employees, business and contractual relationships, business forecasts, sales and merchandising, marketing plans and information the disclosing party provides regarding third parties.');

      doc.moveDown(0.5);

      // Section 2
      doc.font('Helvetica-Bold').text('2. ', { continued: true })
        .font('Helvetica')
        .text('If the Confidential Information is disclosed orally or visually, it shall be identified as such at the time of disclosure.');

      doc.moveDown(0.5);

      // Section 3
      doc.font('Helvetica-Bold').text('3. ', { continued: true })
        .font('Helvetica')
        .text('Each party agrees that at all times and notwithstanding any termination or expiration of this Agreement it will hold in strict confidence and not disclose to any third party Confidential Information of the other, except as approved in writing by the other party to this Agreement, and will use the Confidential Information for no purpose other than evaluating or pursuing a business relationship with the other party to this Agreement. Each party shall only permit access to Confidential Information of the other party to those of its employees or authorized representatives having a need to know and who have signed confidentiality agreements or are otherwise bound by confidentiality obligations at least as restrictive as those contained herein.');

      doc.moveDown(0.5);

      // Section 4
      doc.font('Helvetica-Bold').text('4. ', { continued: true })
        .font('Helvetica')
        .text('Each party shall immediately notify the other in writing upon discovery of any loss or unauthorized disclosure of the Confidential Information of the other party.');

      doc.moveDown(0.5);

      // Section 5
      doc.font('Helvetica-Bold').text('5. ', { continued: true })
        .font('Helvetica')
        .text('Each party\'s obligations under this Agreement with respect to any portion of the other party\'s Confidential Information shall terminate when the Recipient can document that: (a) it was in the public domain; (b) it entered the public domain through no fault of the Recipient; (c) it was in the Recipient\'s possession free of obligation; (d) it was rightfully communicated free of obligation; (e) it was developed independently; (f) it was communicated to a third party free of obligation; (g) it was required by law; or (h) if disclosed orally, it was not identified as confidential.');

      doc.moveDown(0.5);

      // Section 6
      doc.font('Helvetica-Bold').text('6. ', { continued: true })
        .font('Helvetica')
        .text('Upon termination or expiration of the Agreement, or upon written request, each party shall promptly return or destroy all Confidential Information of the other party.');

      doc.moveDown(0.5);

      // Section 7
      doc.font('Helvetica-Bold').text('7. ', { continued: true })
        .font('Helvetica')
        .text('Nothing in this Agreement grants any property rights or license to either party\'s Confidential Information or intellectual property.');

      doc.moveDown(0.5);

      // Section 8
      doc.font('Helvetica-Bold').text('8. ', { continued: true })
        .font('Helvetica')
        .text('Confidential Information shall not be reproduced except as required to accomplish the intent of this Agreement.');

      doc.moveDown(0.5);

      // Section 9
      doc.font('Helvetica-Bold').text('9. ', { continued: true })
        .font('Helvetica')
        .text('This Agreement may be terminated by either party at any time upon 30 days written notice. Obligations shall survive termination.');

      doc.moveDown(0.5);

      // Section 10
      doc.font('Helvetica-Bold').text('10. ', { continued: true })
        .font('Helvetica')
        .text('This Agreement shall be governed by the laws of the State of Delaware. Disputes shall be brought in New Castle County, Delaware.');

      doc.moveDown(0.5);

      // Section 11
      doc.font('Helvetica-Bold').text('11. ', { continued: true })
        .font('Helvetica')
        .text('Each party acknowledges that breach will cause irreparable damage and agrees the other party shall be entitled to seek injunctive relief.');

      doc.moveDown(0.5);

      // Sections 12-14 (abbreviated)
      doc.font('Helvetica-Bold').text('12-14. ', { continued: true })
        .font('Helvetica')
        .text('Severability, third-party rights, and assignment provisions apply as standard.');

      doc.moveDown(1.5);

      // Signature section
      doc.font('Helvetica-Bold').fontSize(12)
        .text('ACCEPTED AND AGREED TO BY THE PARTIES:', { align: 'center' });

      doc.moveDown(1.5);

      // Two-column signature blocks
      const leftX = 72;
      const rightX = 320;
      const colWidth = 200;
      let y = doc.y;

      // Party 1 (Signer/Prospect)
      doc.fontSize(10).font('Helvetica-Bold')
        .text('PARTY 1:', leftX, y, { width: colWidth });
      y += 20;

      doc.font('Helvetica')
        .text(party1.companyName, leftX, y, { width: colWidth });
      y += 15;

      doc.text(party1.address || 'Address on file', leftX, y, { width: colWidth });
      y += 25;

      // Signature line
      doc.moveTo(leftX, y).lineTo(leftX + colWidth, y).stroke();
      y += 5;
      doc.font('Helvetica-Oblique').fontSize(12)
        .text(party1.signature, leftX, y, { width: colWidth });
      y += 15;
      doc.font('Helvetica').fontSize(9).fillColor('gray')
        .text('Electronic Signature', leftX, y, { width: colWidth });
      doc.fillColor('black');
      y += 20;

      doc.fontSize(10)
        .text(`Name: ${party1.fullName}`, leftX, y, { width: colWidth });
      y += 15;
      doc.text(`Title: ${party1.title}`, leftX, y, { width: colWidth });

      // Party 2 (Counter-signer/Aragon Holdings)
      y = doc.y - 95; // Reset to start of signature block

      doc.fontSize(10).font('Helvetica-Bold')
        .text('PARTY 2:', rightX, y - 60, { width: colWidth });

      doc.font('Helvetica')
        .text(party2.companyName, rightX, y - 40, { width: colWidth });

      doc.text(party2.address, rightX, y - 25, { width: colWidth });

      // Signature line
      doc.moveTo(rightX, y - 0).lineTo(rightX + colWidth, y - 0).stroke();
      doc.font('Helvetica-Oblique').fontSize(12)
        .text(party2.signature, rightX, y + 5, { width: colWidth });
      doc.font('Helvetica').fontSize(9).fillColor('gray')
        .text('Electronic Signature', rightX, y + 20, { width: colWidth });
      doc.fillColor('black');

      doc.fontSize(10)
        .text(`Name: ${party2.fullName}`, rightX, y + 40, { width: colWidth });
      doc.text(`Title: ${party2.title}`, rightX, y + 55, { width: colWidth });

      // Footer with timestamp and audit info
      doc.moveDown(4);
      doc.fontSize(8).fillColor('gray')
        .text('─'.repeat(80), { align: 'center' });
      doc.text(`Electronically signed on ${formatDateTime(signedAt)}`, { align: 'center' });
      doc.text(`Document ID: ${ndaId}`, { align: 'center' });
      doc.text('This document was electronically signed and is legally binding.', { align: 'center' });

      doc.end();

      stream.on('finish', () => {
        resolve(filePath);
      });

      stream.on('error', (err) => {
        reject(err);
      });

    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Format date as "January 15, 2026"
 */
function formatDate(dateStr) {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

/**
 * Format datetime as "January 15, 2026 at 3:45 PM EST"
 */
function formatDateTime(dateStr) {
  const date = new Date(dateStr);
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  });
}

module.exports = {
  generateNdaPdf
};
