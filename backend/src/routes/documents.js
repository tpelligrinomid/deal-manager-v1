const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const { authenticate, requireRole, requireDealAccess } = require('../middleware/auth');
const { supabaseAdmin } = require('../lib/supabase');

// All routes require authentication
router.use(authenticate);

// Configure multer for file uploads
const uploadDir = process.env.UPLOAD_DIR || './uploads';
const maxFileSize = parseInt(process.env.MAX_FILE_SIZE) || 50 * 1024 * 1024; // 50MB default

const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const dealDir = path.join(uploadDir, req.params.dealId);
    try {
      await fs.mkdir(dealDir, { recursive: true });
      cb(null, dealDir);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}-${file.originalname}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: maxFileSize },
  fileFilter: (req, file, cb) => {
    // Allow common document types
    const allowedMimes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'image/jpeg',
      'image/png',
      'image/gif',
      'text/plain',
      'text/csv',
      'application/zip',
      'application/x-zip-compressed'
    ];

    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type not allowed: ${file.mimetype}`));
    }
  }
});

/**
 * GET /api/documents/:dealId
 * List all documents for a deal
 */
router.get('/:dealId', requireDealAccess, async (req, res) => {
  try {
    const { dealId } = req.params;
    const { category } = req.query;

    let query = supabaseAdmin
      .from('documents')
      .select(`
        *,
        profiles:uploaded_by (full_name, email)
      `)
      .eq('deal_id', dealId)
      .order('uploaded_at', { ascending: false });

    if (category) {
      query = query.eq('category', category);
    }

    // Sellers only see documents marked as seller_visible
    if (req.user.role === 'seller') {
      query = query.eq('seller_visible', true);
    }

    const { data: documents, error } = await query;

    if (error) throw error;

    res.json(documents);
  } catch (error) {
    console.error('Error listing documents:', error);
    res.status(500).json({ error: 'Failed to list documents' });
  }
});

/**
 * POST /api/documents/:dealId/upload
 * Upload a document
 */
router.post('/:dealId/upload', requireDealAccess, upload.single('file'), async (req, res) => {
  try {
    const { dealId } = req.params;
    const { category = 'other', subcategory, description, checklist_item_id } = req.body;

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Create document record
    const { data: document, error } = await supabaseAdmin
      .from('documents')
      .insert({
        deal_id: dealId,
        file_name: req.file.originalname,
        file_path: req.file.path,
        file_size: req.file.size,
        mime_type: req.file.mimetype,
        category,
        subcategory,
        description,
        checklist_item_id,
        uploaded_by: req.user.id,
        seller_visible: true
      })
      .select()
      .single();

    if (error) throw error;

    // If linked to a checklist item, update its status
    if (checklist_item_id) {
      await supabaseAdmin
        .from('checklist_items')
        .update({
          status: 'received',
          received_at: new Date().toISOString()
        })
        .eq('id', checklist_item_id)
        .eq('status', 'requested'); // Only update if currently 'requested'
    }

    res.status(201).json(document);
  } catch (error) {
    console.error('Error uploading document:', error);
    // Clean up uploaded file on error
    if (req.file?.path) {
      await fs.unlink(req.file.path).catch(() => {});
    }
    res.status(500).json({ error: 'Failed to upload document' });
  }
});

/**
 * GET /api/documents/:dealId/:documentId/download
 * Download a document
 */
router.get('/:dealId/:documentId/download', requireDealAccess, async (req, res) => {
  try {
    const { dealId, documentId } = req.params;

    const { data: document, error } = await supabaseAdmin
      .from('documents')
      .select('*')
      .eq('id', documentId)
      .eq('deal_id', dealId)
      .single();

    if (error || !document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Check seller visibility
    if (req.user.role === 'seller' && !document.seller_visible) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Check if file exists
    try {
      await fs.access(document.file_path);
    } catch {
      return res.status(404).json({ error: 'File not found on server' });
    }

    res.download(document.file_path, document.file_name);
  } catch (error) {
    console.error('Error downloading document:', error);
    res.status(500).json({ error: 'Failed to download document' });
  }
});

/**
 * PATCH /api/documents/:dealId/:documentId
 * Update document metadata (team only)
 */
router.patch('/:dealId/:documentId', requireRole(['admin', 'team_member']), async (req, res) => {
  try {
    const { dealId, documentId } = req.params;
    const { category, subcategory, description, seller_visible, checklist_item_id } = req.body;

    const updateData = {};
    if (category !== undefined) updateData.category = category;
    if (subcategory !== undefined) updateData.subcategory = subcategory;
    if (description !== undefined) updateData.description = description;
    if (seller_visible !== undefined) updateData.seller_visible = seller_visible;
    if (checklist_item_id !== undefined) updateData.checklist_item_id = checklist_item_id;

    const { data: document, error } = await supabaseAdmin
      .from('documents')
      .update(updateData)
      .eq('id', documentId)
      .eq('deal_id', dealId)
      .select()
      .single();

    if (error) throw error;

    res.json(document);
  } catch (error) {
    console.error('Error updating document:', error);
    res.status(500).json({ error: 'Failed to update document' });
  }
});

/**
 * DELETE /api/documents/:dealId/:documentId
 * Delete a document (team only)
 */
router.delete('/:dealId/:documentId', requireRole(['admin', 'team_member']), async (req, res) => {
  try {
    const { dealId, documentId } = req.params;

    // Get document to find file path
    const { data: document, error: fetchError } = await supabaseAdmin
      .from('documents')
      .select('file_path')
      .eq('id', documentId)
      .eq('deal_id', dealId)
      .single();

    if (fetchError || !document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Delete from database
    const { error: deleteError } = await supabaseAdmin
      .from('documents')
      .delete()
      .eq('id', documentId);

    if (deleteError) throw deleteError;

    // Delete file from disk
    try {
      await fs.unlink(document.file_path);
    } catch (e) {
      console.warn('Could not delete file:', e.message);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting document:', error);
    res.status(500).json({ error: 'Failed to delete document' });
  }
});

/**
 * GET /api/documents/:dealId/categories
 * Get document counts by category
 */
router.get('/:dealId/categories', requireDealAccess, async (req, res) => {
  try {
    const { dealId } = req.params;

    const { data: documents, error } = await supabaseAdmin
      .from('documents')
      .select('category')
      .eq('deal_id', dealId);

    if (error) throw error;

    // Count by category
    const counts = documents.reduce((acc, doc) => {
      acc[doc.category] = (acc[doc.category] || 0) + 1;
      return acc;
    }, {});

    res.json(counts);
  } catch (error) {
    console.error('Error getting document categories:', error);
    res.status(500).json({ error: 'Failed to get document categories' });
  }
});

module.exports = router;
