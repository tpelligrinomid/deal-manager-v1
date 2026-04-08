const express = require('express');
const router = express.Router();
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { authenticate, requireRole, requireDealAccess } = require('../middleware/auth');

// All routes require authentication
router.use(authenticate);

// Multer: memory storage (buffer) — files go straight to Supabase Storage, never to disk
const maxFileSize = parseInt(process.env.MAX_FILE_SIZE) || 50 * 1024 * 1024; // 50MB default

const STORAGE_BUCKET = 'deal-documents';

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

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxFileSize },
  fileFilter: (req, file, cb) => {
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

    let query = req.supabase
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
 * Upload a document to Supabase Storage
 */
router.post('/:dealId/upload', requireDealAccess, upload.single('file'), async (req, res) => {
  try {
    const { dealId } = req.params;
    const { category = 'other', subcategory, description, checklist_item_id } = req.body;

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Build storage path: {dealId}/{uuid}-{originalname}
    const storagePath = `${dealId}/${uuidv4()}-${req.file.originalname}`;

    // Upload to Supabase Storage
    const { error: uploadError } = await req.supabase.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: false
      });

    if (uploadError) {
      console.error('Supabase Storage upload error:', uploadError);
      throw new Error(`Storage upload failed: ${uploadError.message}`);
    }

    // Create document record with storage path
    const { data: document, error } = await req.supabase
      .from('documents')
      .insert({
        deal_id: dealId,
        file_name: req.file.originalname,
        file_path: storagePath,
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

    if (error) {
      // Clean up storage on DB insert failure
      await req.supabase.storage.from(STORAGE_BUCKET).remove([storagePath]);
      throw error;
    }

    // If linked to a checklist item, update its status
    if (checklist_item_id) {
      await req.supabase
        .from('checklist_items')
        .update({
          status: 'received',
          received_at: new Date().toISOString()
        })
        .eq('id', checklist_item_id)
        .eq('status', 'requested');
    }

    res.status(201).json(document);
  } catch (error) {
    console.error('Error uploading document:', error);
    res.status(500).json({ error: 'Failed to upload document' });
  }
});

/**
 * GET /api/documents/:dealId/:documentId/download
 * Download a document from Supabase Storage
 */
router.get('/:dealId/:documentId/download', requireDealAccess, async (req, res) => {
  try {
    const { dealId, documentId } = req.params;

    const { data: document, error } = await req.supabase
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

    // Download from Supabase Storage
    const { data: fileData, error: downloadError } = await req.supabase.storage
      .from(STORAGE_BUCKET)
      .download(document.file_path);

    if (downloadError) {
      console.error('Storage download error:', downloadError);
      return res.status(404).json({ error: 'File not found in storage' });
    }

    // Convert blob to buffer and send
    const buffer = Buffer.from(await fileData.arrayBuffer());

    res.setHeader('Content-Type', document.mime_type);
    res.setHeader('Content-Disposition', `attachment; filename="${document.file_name}"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
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

    const { data: document, error } = await req.supabase
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

    // Get document to find storage path
    const { data: document, error: fetchError } = await req.supabase
      .from('documents')
      .select('file_path')
      .eq('id', documentId)
      .eq('deal_id', dealId)
      .single();

    if (fetchError || !document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Delete from database
    const { error: deleteError } = await req.supabase
      .from('documents')
      .delete()
      .eq('id', documentId);

    if (deleteError) throw deleteError;

    // Delete from Supabase Storage
    const { error: storageError } = await req.supabase.storage
      .from(STORAGE_BUCKET)
      .remove([document.file_path]);

    if (storageError) {
      console.warn('Could not delete file from storage:', storageError.message);
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

    const { data: documents, error } = await req.supabase
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
