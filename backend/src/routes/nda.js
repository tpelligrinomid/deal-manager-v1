const express = require('express');
const router = express.Router();
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { authenticate, requireRole } = require('../middleware/auth');
const { supabaseAdmin, createSupabaseClient } = require('../lib/supabase');
const { generateNdaPdf } = require('../services/pdfGenerator');
const path = require('path');
const fs = require('fs').promises;

// Configure multer for external NDA PDF uploads
const ndaUploadDir = process.env.NDA_UPLOAD_DIR || './uploads/ndas';
const maxFileSize = parseInt(process.env.MAX_FILE_SIZE) || 50 * 1024 * 1024; // 50MB default

const ndaStorage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      await fs.mkdir(ndaUploadDir, { recursive: true });
      cb(null, ndaUploadDir);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const uniqueName = `external-${uuidv4()}.pdf`;
    cb(null, uniqueName);
  }
});

const uploadNda = multer({
  storage: ndaStorage,
  limits: { fileSize: maxFileSize },
  fileFilter: (req, file, cb) => {
    // Only allow PDF files for external NDAs
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed for NDA uploads'));
    }
  }
});

// Company info for counter-signature (from env or defaults)
const COMPANY_NAME = process.env.NDA_COMPANY_NAME || 'Aragon Holdings LLC';
const COMPANY_ADDRESS = process.env.NDA_COMPANY_ADDRESS || '123 Main Street, Austin, TX 78701';
const COUNTER_SIGNER_NAME = process.env.NDA_COUNTER_SIGNER_NAME || 'Tristan Pelligrino';
const COUNTER_SIGNER_TITLE = process.env.NDA_COUNTER_SIGNER_TITLE || 'Managing Member';

/**
 * POST /api/nda/sign
 * PUBLIC endpoint - no authentication required
 * Allows prospects to sign the NDA electronically
 */
router.post('/sign', async (req, res) => {
  try {
    const {
      company_name,
      company_address,
      full_name,
      title,
      email,
      phone,
      signature // Their typed name as e-signature
    } = req.body;

    // Validation
    if (!company_name || !full_name || !title || !email || !signature) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['company_name', 'full_name', 'title', 'email', 'signature']
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Get client IP and user agent for audit trail
    const signerIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const signerUserAgent = req.headers['user-agent'] || 'unknown';

    // Check if this company/email combo already signed
    // Use anon client for public access
    const anonClient = createSupabaseClient();

    const { data: existingNda } = await anonClient
      .from('ndas')
      .select('id, signed_at')
      .eq('signer_email', normalizedEmail)
      .eq('signer_company_name', company_name.trim())
      .single();

    if (existingNda) {
      return res.status(409).json({
        error: 'An NDA has already been signed for this company and email',
        signed_at: existingNda.signed_at
      });
    }

    const signedAt = new Date().toISOString();
    const effectiveDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    // Create the NDA record
    const { data: nda, error: insertError } = await anonClient
      .from('ndas')
      .insert({
        signer_company_name: company_name.trim(),
        signer_company_address: company_address?.trim() || null,
        signer_full_name: full_name.trim(),
        signer_title: title.trim(),
        signer_email: normalizedEmail,
        signer_phone: phone?.trim() || null,
        signature_text: signature.trim(),
        signed_at: signedAt,
        signer_ip_address: signerIp,
        signer_user_agent: signerUserAgent,
        counter_signer_name: COUNTER_SIGNER_NAME,
        counter_signer_title: COUNTER_SIGNER_TITLE,
        counter_signed_at: signedAt,
        effective_date: effectiveDate,
        status: 'signed'
      })
      .select()
      .single();

    if (insertError) {
      console.error('Error inserting NDA:', insertError);
      throw insertError;
    }

    // Generate PDF
    let pdfPath = null;
    try {
      pdfPath = await generateNdaPdf({
        ndaId: nda.id,
        effectiveDate,
        // Signer (Party 1)
        party1: {
          companyName: company_name.trim(),
          address: company_address?.trim() || '',
          signature: signature.trim(),
          fullName: full_name.trim(),
          title: title.trim()
        },
        // Counter-signer (Party 2 - Aragon Holdings)
        party2: {
          companyName: COMPANY_NAME,
          address: COMPANY_ADDRESS,
          signature: COUNTER_SIGNER_NAME,
          fullName: COUNTER_SIGNER_NAME,
          title: COUNTER_SIGNER_TITLE
        },
        signedAt
      });

      // Update NDA with PDF path
      await anonClient
        .from('ndas')
        .update({
          pdf_path: pdfPath,
          pdf_generated_at: new Date().toISOString()
        })
        .eq('id', nda.id);

    } catch (pdfError) {
      console.error('Error generating PDF:', pdfError);
      // Don't fail the whole request if PDF generation fails
      // The NDA is still valid, PDF can be regenerated
    }

    // Send email notification via n8n webhook
    if (process.env.N8N_WEBHOOK_URL) {
      fetch(process.env.N8N_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'nda_signed',
          to: normalizedEmail,
          name: full_name.trim(),
          companyName: company_name.trim(),
          signedAt,
          effectiveDate,
          ndaId: nda.id,
          pdfPath,
          // Include counter-signer info
          counterSignerCompany: COMPANY_NAME,
          counterSignerName: COUNTER_SIGNER_NAME
        })
      }).catch(err => console.error('Failed to send NDA email webhook:', err));
    }

    res.status(201).json({
      success: true,
      message: 'NDA signed successfully. A copy will be sent to your email.',
      nda: {
        id: nda.id,
        signed_at: signedAt,
        effective_date: effectiveDate,
        signer_company: company_name.trim(),
        signer_name: full_name.trim(),
        counter_signer_company: COMPANY_NAME,
        counter_signer_name: COUNTER_SIGNER_NAME
      }
    });

  } catch (error) {
    console.error('Error signing NDA:', error);
    res.status(500).json({ error: 'Failed to process NDA signature' });
  }
});

/**
 * POST /api/nda/process
 * PUBLIC endpoint - called by Supabase Edge Function after NDA is inserted
 * Generates PDF, uploads to Supabase Storage, and sends webhook to n8n
 */
router.post('/process', async (req, res) => {
  try {
    const {
      nda_id,
      signer_company_name,
      signer_company_address,
      signer_full_name,
      signer_title,
      signer_email,
      signature_text,
      signed_at,
      effective_date
    } = req.body;

    // Validation
    if (!nda_id || !signer_company_name || !signer_full_name || !signer_email || !signature_text) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['nda_id', 'signer_company_name', 'signer_full_name', 'signer_email', 'signature_text']
      });
    }

    const signedAtDate = signed_at || new Date().toISOString();
    const effectiveDateStr = effective_date || new Date().toISOString().split('T')[0];

    // Generate PDF locally
    let localPdfPath = null;
    try {
      localPdfPath = await generateNdaPdf({
        ndaId: nda_id,
        effectiveDate: effectiveDateStr,
        party1: {
          companyName: signer_company_name,
          address: signer_company_address || '',
          signature: signature_text,
          fullName: signer_full_name,
          title: signer_title || ''
        },
        party2: {
          companyName: COMPANY_NAME,
          address: COMPANY_ADDRESS,
          signature: COUNTER_SIGNER_NAME,
          fullName: COUNTER_SIGNER_NAME,
          title: COUNTER_SIGNER_TITLE
        },
        signedAt: signedAtDate
      });
    } catch (pdfError) {
      console.error('Error generating PDF:', pdfError);
      return res.status(500).json({ error: 'Failed to generate PDF', details: pdfError.message });
    }

    // Read PDF as base64 and upload to Supabase Storage via edge function
    let storagePath = null;
    let publicUrl = null;

    try {
      const pdfBuffer = await fs.readFile(localPdfPath);
      const pdfBase64 = pdfBuffer.toString('base64');
      const filename = `nda-${nda_id}.pdf`;

      // Call the edge function to upload to Supabase Storage
      const supabaseUrl = process.env.SUPABASE_URL;
      const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

      if (supabaseUrl && supabaseAnonKey) {
        const uploadResponse = await fetch(`${supabaseUrl}/functions/v1/nda-upload-pdf`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseAnonKey}`
          },
          body: JSON.stringify({
            nda_id,
            pdf_base64: pdfBase64,
            filename
          })
        });

        if (uploadResponse.ok) {
          const uploadResult = await uploadResponse.json();
          storagePath = uploadResult.pdf_path;
          publicUrl = uploadResult.signed_url;
        } else {
          console.error('Failed to upload PDF to storage:', await uploadResponse.text());
        }
      }

      // Clean up local file
      await fs.unlink(localPdfPath).catch(() => {});

    } catch (uploadError) {
      console.error('Error uploading PDF to storage:', uploadError);
      // Continue even if upload fails - we still have the local path as fallback
    }

    // Send email notification via n8n webhook
    if (process.env.N8N_WEBHOOK_URL) {
      try {
        await fetch(process.env.N8N_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'nda_signed',
            to: signer_email,
            name: signer_full_name,
            companyName: signer_company_name,
            signedAt: signedAtDate,
            effectiveDate: effectiveDateStr,
            ndaId: nda_id,
            pdfPath: storagePath || localPdfPath,
            pdfUrl: publicUrl,
            counterSignerCompany: COMPANY_NAME,
            counterSignerName: COUNTER_SIGNER_NAME
          })
        });
      } catch (webhookError) {
        console.error('Failed to send NDA email webhook:', webhookError);
        // Don't fail the request if webhook fails
      }
    }

    res.json({
      success: true,
      pdf_path: storagePath || localPdfPath,
      pdf_url: publicUrl,
      pdf_generated_at: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error processing NDA:', error);
    res.status(500).json({ error: 'Failed to process NDA' });
  }
});

/**
 * GET /api/nda/terms
 * PUBLIC endpoint - returns the NDA terms text for display
 */
router.get('/terms', async (req, res) => {
  try {
    // Return the NDA terms as structured data
    const terms = {
      title: 'Mutual Non-Disclosure Agreement',
      effectiveDateNote: 'This Agreement is effective as of the date of electronic signature.',
      sections: [
        {
          number: 1,
          content: '"Confidential Information" means any and all technical and non-technical information provided by either party to the other, including but not limited to (a) patent and patent applications, (b) trade secret, and (c) proprietary information, ideas, samples, media, techniques, sketches, drawings, works of authorship, models, inventions, know-how, processes, apparatuses, equipment, algorithms, software programs, software source documents, and formulae related to the current, future, and proposed products and services of each of the parties, and including, without limitation, their respective information concerning research, experimental work, development, design details and specifications, engineering, financial information, procurement requirements, purchasing, manufacturing, customer lists, investors, employees, business and contractual relationships, business forecasts, sales and merchandising, marketing plans and information the disclosing party provides regarding third parties.'
        },
        {
          number: 2,
          content: 'If the Confidential Information is disclosed orally or visually, it shall be identified as such at the time of disclosure.'
        },
        {
          number: 3,
          content: 'Each party agrees that at all times and notwithstanding any termination or expiration of this Agreement it will hold in strict confidence and not disclose to any third party Confidential Information of the other, except as approved in writing by the other party to this Agreement, and will use the Confidential Information for no purpose other than evaluating or pursuing a business relationship with the other party to this Agreement. Each party shall only permit access to Confidential Information of the other party to those of its employees or authorized representatives having a need to know and who have signed confidentiality agreements or are otherwise bound by confidentiality obligations at least as restrictive as those contained herein.'
        },
        {
          number: 4,
          content: 'Each party shall immediately notify the other in writing upon discovery of any loss or unauthorized disclosure of the Confidential Information of the other party.'
        },
        {
          number: 5,
          content: 'Each party\'s obligations under this Agreement with respect to any portion of the other party\'s Confidential Information shall terminate when the party to whom Confidential Information was disclosed (the "Recipient") can document that: (a) it was in the public domain at the time it was communicated to the Recipient by the other party; (b) it entered the public domain subsequent to the time it was communicated to the Recipient by the other party through no fault of the Recipient; (c) it was in the Recipient\'s possession free of any obligation of confidence at the time it was communicated to the Recipient by the other party; (d) it was rightfully communicated to the Recipient free of any obligation of confidence subsequent to the time it was communicated to the Recipient by the other party; (e) it was developed by employees or agents of the Recipient independently of and without reference to any information communicated to the Recipient by the other party; (f) it was communicated by the other party to an unaffiliated third party free of any obligation of confidence; (g) the communication was in response to a valid order by a court or other governmental body, was otherwise required by law, or was necessary to establish the rights of either party under this Agreement; or (h) if disclosed orally or visually, it was not identified as Confidential Information of the disclosing party at the time of such communication.'
        },
        {
          number: 6,
          content: 'Upon termination or expiration of the Agreement, or upon written request of the other party, each party shall (a) promptly return to the other all documents and other tangible materials representing the other\'s Confidential Information and all copies thereof in its possession or control, and (b) destroy all intangible copies of the other\'s Confidential Information in its possession or control.'
        },
        {
          number: 7,
          content: 'The parties recognize and agree that nothing contained in this Agreement shall be construed as granting any property rights, by license or otherwise, to any Confidential Information of the other party disclosed pursuant to this Agreement, or to any invention or any patent, copyright, trademark, or other intellectual property right that has issued or that may issue, based on such Confidential Information. Neither party shall make, have made, use or sell for any purpose any product or other item using, incorporating or derived from any Confidential Information of the other party.'
        },
        {
          number: 8,
          content: 'Confidential Information shall not be reproduced in any form except as required to accomplish the intent of this Agreement. Any reproduction of any Confidential Information of the other party by either party shall remain the property of the disclosing party and shall contain any and all confidential or proprietary notices or legends which appear on the original, unless otherwise authorized in writing by the other party.'
        },
        {
          number: 9,
          content: 'This Agreement may be terminated by either party at any time upon 30 days written notice to the other party. The Recipient\'s obligations under this Agreement shall survive termination of the Agreement between the parties and shall be binding upon the Recipient\'s heirs, successors and assigns.'
        },
        {
          number: 10,
          content: 'This Agreement shall be governed by and construed in accordance with the laws of the State of Delaware without reference to conflict of laws principles. Any disputes under this Agreement shall be brought in the state courts and the Federal courts located in New Castle County, Delaware, and the parties irrevocably submit to the jurisdiction and venue of these courts.'
        },
        {
          number: 11,
          content: 'Each party acknowledges that its breach of the Agreement will cause irreparable damage and hereby agrees that the other party shall be entitled to seek injunctive relief under this Agreement, as well as such further relief as may be granted by a court of competent jurisdiction.'
        },
        {
          number: 12,
          content: 'If any provision of this Agreement is found by a proper authority to be unenforceable or invalid such unenforceability or invalidity shall not render this Agreement unenforceable or invalid as a whole.'
        },
        {
          number: 13,
          content: 'Neither party shall communicate any information to the other in violation of the proprietary rights of any third party.'
        },
        {
          number: 14,
          content: 'Neither party will assign or transfer any rights or obligations under this Agreement without the prior written consent of the other party.'
        }
      ],
      counterParty: {
        companyName: COMPANY_NAME,
        address: COMPANY_ADDRESS,
        signerName: COUNTER_SIGNER_NAME,
        signerTitle: COUNTER_SIGNER_TITLE
      }
    };

    res.json(terms);
  } catch (error) {
    console.error('Error fetching NDA terms:', error);
    res.status(500).json({ error: 'Failed to fetch NDA terms' });
  }
});

// ============================================
// Protected routes (require authentication)
// ============================================

/**
 * GET /api/nda
 * List all NDAs (team only)
 */
router.get('/', authenticate, requireRole(['admin', 'team_member']), async (req, res) => {
  try {
    const { status, attached, source, search, limit = 50, offset = 0 } = req.query;

    let query = req.supabase
      .from('ndas')
      .select('*', { count: 'exact' })
      .order('signed_at', { ascending: false })
      .range(offset, offset + parseInt(limit) - 1);

    // Filter by status
    if (status) {
      query = query.eq('status', status);
    }

    // Filter by source (digital or external)
    if (source) {
      query = query.eq('source', source);
    }

    // Filter by attachment status
    if (attached === 'true') {
      query = query.not('deal_id', 'is', null);
    } else if (attached === 'false') {
      query = query.is('deal_id', null);
    }

    // Search by company name or email
    if (search) {
      query = query.or(`signer_company_name.ilike.%${search}%,signer_email.ilike.%${search}%,signer_full_name.ilike.%${search}%`);
    }

    const { data: ndas, error, count } = await query;

    if (error) throw error;

    res.json({ ndas, count });
  } catch (error) {
    console.error('Error listing NDAs:', error);
    res.status(500).json({ error: 'Failed to list NDAs' });
  }
});

/**
 * POST /api/nda/upload-external
 * Upload an externally signed NDA (team only)
 * For NDAs that were signed outside the platform
 */
router.post('/upload-external', authenticate, requireRole(['admin', 'team_member']), uploadNda.single('file'), async (req, res) => {
  try {
    const {
      signer_company_name,
      signer_company_address,
      signer_full_name,
      signer_title,
      signer_email,
      signer_phone,
      signed_at,
      effective_date,
      notes
    } = req.body;

    // Validation
    if (!req.file) {
      return res.status(400).json({ error: 'No PDF file uploaded' });
    }

    if (!signer_company_name || !signer_full_name || !signer_email) {
      // Clean up uploaded file
      await fs.unlink(req.file.path).catch(() => {});
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['signer_company_name', 'signer_full_name', 'signer_email']
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(signer_email)) {
      await fs.unlink(req.file.path).catch(() => {});
      return res.status(400).json({ error: 'Invalid email format' });
    }

    const normalizedEmail = signer_email.toLowerCase().trim();

    // Check if this company/email combo already has an NDA
    const { data: existingNda } = await req.supabase
      .from('ndas')
      .select('id, signed_at, source')
      .eq('signer_email', normalizedEmail)
      .eq('signer_company_name', signer_company_name.trim())
      .single();

    if (existingNda) {
      await fs.unlink(req.file.path).catch(() => {});
      return res.status(409).json({
        error: 'An NDA already exists for this company and email',
        existing_nda_id: existingNda.id,
        signed_at: existingNda.signed_at,
        source: existingNda.source
      });
    }

    // Parse dates or use defaults
    const signedAtDate = signed_at ? new Date(signed_at).toISOString() : new Date().toISOString();
    const effectiveDateStr = effective_date || signedAtDate.split('T')[0];

    // Upload to Supabase Storage if configured
    let storagePath = req.file.path; // Default to local path
    let publicUrl = null;

    try {
      const pdfBuffer = await fs.readFile(req.file.path);
      const pdfBase64 = pdfBuffer.toString('base64');
      const filename = `external-nda-${uuidv4()}.pdf`;

      const supabaseUrl = process.env.SUPABASE_URL;
      const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

      if (supabaseUrl && supabaseAnonKey) {
        const uploadResponse = await fetch(`${supabaseUrl}/functions/v1/nda-upload-pdf`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseAnonKey}`
          },
          body: JSON.stringify({
            nda_id: 'external-' + uuidv4(), // Temporary ID for storage path
            pdf_base64: pdfBase64,
            filename
          })
        });

        if (uploadResponse.ok) {
          const uploadResult = await uploadResponse.json();
          storagePath = uploadResult.pdf_path;
          publicUrl = uploadResult.signed_url;
          // Clean up local file after successful upload to storage
          await fs.unlink(req.file.path).catch(() => {});
        }
      }
    } catch (uploadError) {
      console.error('Error uploading to Supabase Storage:', uploadError);
      // Continue with local file path as fallback
    }

    // Create the NDA record
    const { data: nda, error: insertError } = await req.supabase
      .from('ndas')
      .insert({
        source: 'external',
        signer_company_name: signer_company_name.trim(),
        signer_company_address: signer_company_address?.trim() || null,
        signer_full_name: signer_full_name.trim(),
        signer_title: signer_title?.trim() || null,
        signer_email: normalizedEmail,
        signer_phone: signer_phone?.trim() || null,
        signed_at: signedAtDate,
        effective_date: effectiveDateStr,
        pdf_path: storagePath,
        pdf_generated_at: new Date().toISOString(),
        status: 'signed',
        notes: notes?.trim() || null,
        uploaded_by: req.user.id
        // Fields left null for external NDAs:
        // signature_text, signer_ip_address, signer_user_agent,
        // counter_signer_name, counter_signer_title, counter_signed_at
      })
      .select()
      .single();

    if (insertError) {
      console.error('Error inserting external NDA:', insertError);
      // Clean up file if insert fails
      if (storagePath === req.file.path) {
        await fs.unlink(req.file.path).catch(() => {});
      }
      throw insertError;
    }

    res.status(201).json({
      success: true,
      message: 'External NDA uploaded successfully',
      nda: {
        id: nda.id,
        source: 'external',
        signer_company_name: nda.signer_company_name,
        signer_full_name: nda.signer_full_name,
        signer_email: nda.signer_email,
        signed_at: nda.signed_at,
        effective_date: nda.effective_date,
        status: nda.status,
        pdf_path: nda.pdf_path,
        pdf_url: publicUrl
      }
    });

  } catch (error) {
    console.error('Error uploading external NDA:', error);
    // Clean up uploaded file on error
    if (req.file?.path) {
      await fs.unlink(req.file.path).catch(() => {});
    }
    res.status(500).json({ error: 'Failed to upload external NDA' });
  }
});

/**
 * GET /api/nda/unattached
 * List NDAs not yet attached to a deal (for deal creation dropdown)
 */
router.get('/unattached', authenticate, requireRole(['admin', 'team_member']), async (req, res) => {
  try {
    const { data: ndas, error } = await req.supabase
      .from('ndas')
      .select('id, signer_company_name, signer_full_name, signer_email, signed_at, source')
      .is('deal_id', null)
      .eq('status', 'signed')
      .order('signed_at', { ascending: false });

    if (error) throw error;

    res.json(ndas);
  } catch (error) {
    console.error('Error listing unattached NDAs:', error);
    res.status(500).json({ error: 'Failed to list unattached NDAs' });
  }
});

/**
 * GET /api/nda/:ndaId
 * Get a specific NDA (team only)
 */
router.get('/:ndaId', authenticate, requireRole(['admin', 'team_member']), async (req, res) => {
  try {
    const { ndaId } = req.params;

    const { data: nda, error } = await req.supabase
      .from('ndas')
      .select(`
        *,
        deals:deal_id (id, agency_name, status),
        attached_by_profile:attached_by (full_name, email),
        uploaded_by_profile:uploaded_by (full_name, email)
      `)
      .eq('id', ndaId)
      .single();

    if (error) throw error;

    if (!nda) {
      return res.status(404).json({ error: 'NDA not found' });
    }

    res.json(nda);
  } catch (error) {
    console.error('Error fetching NDA:', error);
    res.status(500).json({ error: 'Failed to fetch NDA' });
  }
});

/**
 * PATCH /api/nda/:ndaId
 * Update an NDA (attach to deal, add notes, etc.)
 */
router.patch('/:ndaId', authenticate, requireRole(['admin', 'team_member']), async (req, res) => {
  try {
    const { ndaId } = req.params;
    const { deal_id, notes, status } = req.body;

    const updateData = {};

    // Attach to deal
    if (deal_id !== undefined) {
      updateData.deal_id = deal_id;
      updateData.attached_at = deal_id ? new Date().toISOString() : null;
      updateData.attached_by = deal_id ? req.user.id : null;
      updateData.status = deal_id ? 'attached' : 'signed';
    }

    // Update notes
    if (notes !== undefined) {
      updateData.notes = notes;
    }

    // Update status (for voiding)
    if (status !== undefined && ['signed', 'attached', 'voided'].includes(status)) {
      updateData.status = status;
    }

    const { data: nda, error } = await req.supabase
      .from('ndas')
      .update(updateData)
      .eq('id', ndaId)
      .select()
      .single();

    if (error) throw error;

    res.json(nda);
  } catch (error) {
    console.error('Error updating NDA:', error);
    res.status(500).json({ error: 'Failed to update NDA' });
  }
});

/**
 * GET /api/nda/:ndaId/pdf
 * Download the signed NDA PDF
 */
router.get('/:ndaId/pdf', authenticate, requireRole(['admin', 'team_member']), async (req, res) => {
  try {
    const { ndaId } = req.params;

    const { data: nda, error } = await req.supabase
      .from('ndas')
      .select('pdf_path, signer_company_name, signed_at')
      .eq('id', ndaId)
      .single();

    if (error || !nda) {
      return res.status(404).json({ error: 'NDA not found' });
    }

    if (!nda.pdf_path) {
      return res.status(404).json({ error: 'PDF not yet generated for this NDA' });
    }

    // Check if file exists
    try {
      await fs.access(nda.pdf_path);
    } catch {
      return res.status(404).json({ error: 'PDF file not found on server' });
    }

    const filename = `NDA-${nda.signer_company_name.replace(/[^a-zA-Z0-9]/g, '_')}-${nda.signed_at.split('T')[0]}.pdf`;
    res.download(nda.pdf_path, filename);

  } catch (error) {
    console.error('Error downloading NDA PDF:', error);
    res.status(500).json({ error: 'Failed to download NDA PDF' });
  }
});

/**
 * DELETE /api/nda/:ndaId
 * Delete an NDA (admin only, for voided/test NDAs)
 */
router.delete('/:ndaId', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { ndaId } = req.params;

    // Get PDF path before deleting
    const { data: nda } = await req.supabase
      .from('ndas')
      .select('pdf_path')
      .eq('id', ndaId)
      .single();

    const { error } = await req.supabase
      .from('ndas')
      .delete()
      .eq('id', ndaId);

    if (error) throw error;

    // Delete PDF file if exists
    if (nda?.pdf_path) {
      try {
        await fs.unlink(nda.pdf_path);
      } catch (e) {
        console.warn('Could not delete NDA PDF file:', e.message);
      }
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting NDA:', error);
    res.status(500).json({ error: 'Failed to delete NDA' });
  }
});

module.exports = router;
