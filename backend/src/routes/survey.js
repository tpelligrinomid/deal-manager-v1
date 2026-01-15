const express = require('express');
const router = express.Router();
const { authenticate, requireRole, requireDealAccess } = require('../middleware/auth');

// All routes require authentication
router.use(authenticate);

/**
 * GET /api/survey/config
 * Get the survey configuration (questions, sections, etc.)
 */
router.get('/config', async (req, res) => {
  try {
    const surveyConfig = require('../../../config/survey.json');
    res.json(surveyConfig);
  } catch (error) {
    console.error('Error loading survey config:', error);
    res.status(500).json({ error: 'Failed to load survey configuration' });
  }
});

/**
 * GET /api/survey/:dealId
 * Get all survey responses for a deal
 */
router.get('/:dealId', requireDealAccess, async (req, res) => {
  try {
    const { dealId } = req.params;

    // Get responses
    const { data: responses, error } = await req.supabase
      .from('survey_responses')
      .select('*')
      .eq('deal_id', dealId);

    if (error) throw error;

    // Get progress
    const { data: progress } = await req.supabase
      .from('survey_progress')
      .select('*')
      .eq('deal_id', dealId)
      .single();

    // Transform to a more usable format: { section_id: { question_id: response } }
    const responseMap = {};
    for (const response of responses) {
      if (!responseMap[response.section_id]) {
        responseMap[response.section_id] = {};
      }
      responseMap[response.section_id][response.question_id] = {
        answer: response.answer,
        answered_at: response.answered_at,
        internal_notes: ['admin', 'team_member'].includes(req.user.role) ? response.internal_notes : undefined,
        flagged: ['admin', 'team_member'].includes(req.user.role) ? response.flagged : undefined
      };
    }

    res.json({
      responses: responseMap,
      progress: progress || {
        total_questions: 0,
        answered_questions: 0,
        completion_percentage: 0
      }
    });
  } catch (error) {
    console.error('Error fetching survey responses:', error);
    res.status(500).json({ error: 'Failed to fetch survey responses' });
  }
});

/**
 * POST /api/survey/:dealId/responses
 * Save survey responses (batch update)
 */
router.post('/:dealId/responses', requireDealAccess, async (req, res) => {
  try {
    const { dealId } = req.params;
    const { responses } = req.body;

    if (!responses || typeof responses !== 'object') {
      return res.status(400).json({ error: 'Responses object is required' });
    }

    // Sellers can only submit answers, not internal notes
    const isSeller = req.user.role === 'seller';

    // Prepare upsert data
    const upsertData = [];
    for (const [sectionId, questions] of Object.entries(responses)) {
      for (const [questionId, value] of Object.entries(questions)) {
        const responseData = {
          deal_id: dealId,
          section_id: sectionId,
          question_id: questionId,
          answer: value,
          answered_at: new Date().toISOString(),
          answered_by: req.user.id
        };
        upsertData.push(responseData);
      }
    }

    // Upsert responses
    const { error: upsertError } = await req.supabase
      .from('survey_responses')
      .upsert(upsertData, {
        onConflict: 'deal_id,section_id,question_id'
      });

    if (upsertError) throw upsertError;

    // Update progress
    await updateSurveyProgress(req.supabase, dealId);

    res.json({ success: true, saved: upsertData.length });
  } catch (error) {
    console.error('Error saving survey responses:', error);
    res.status(500).json({ error: 'Failed to save survey responses' });
  }
});

/**
 * PATCH /api/survey/:dealId/response/:sectionId/:questionId
 * Update a single response (including internal notes)
 */
router.patch('/:dealId/response/:sectionId/:questionId', requireDealAccess, async (req, res) => {
  try {
    const { dealId, sectionId, questionId } = req.params;
    const { answer, internal_notes, flagged } = req.body;

    const updateData = {};

    // Sellers can only update answers
    if (answer !== undefined) {
      updateData.answer = answer;
      updateData.answered_at = new Date().toISOString();
      updateData.answered_by = req.user.id;
    }

    // Only team members can update internal notes and flags
    if (['admin', 'team_member'].includes(req.user.role)) {
      if (internal_notes !== undefined) updateData.internal_notes = internal_notes;
      if (flagged !== undefined) updateData.flagged = flagged;
    }

    const { data: response, error } = await req.supabase
      .from('survey_responses')
      .upsert({
        deal_id: dealId,
        section_id: sectionId,
        question_id: questionId,
        ...updateData
      }, {
        onConflict: 'deal_id,section_id,question_id'
      })
      .select()
      .single();

    if (error) throw error;

    // Update progress if answer changed
    if (answer !== undefined) {
      await updateSurveyProgress(req.supabase, dealId);
    }

    res.json(response);
  } catch (error) {
    console.error('Error updating survey response:', error);
    res.status(500).json({ error: 'Failed to update survey response' });
  }
});

/**
 * GET /api/survey/:dealId/flagged
 * Get all flagged responses for a deal (team only)
 */
router.get('/:dealId/flagged', requireRole(['admin', 'team_member']), async (req, res) => {
  try {
    const { dealId } = req.params;

    const { data: flagged, error } = await req.supabase
      .from('survey_responses')
      .select('*')
      .eq('deal_id', dealId)
      .eq('flagged', true);

    if (error) throw error;

    res.json(flagged);
  } catch (error) {
    console.error('Error fetching flagged responses:', error);
    res.status(500).json({ error: 'Failed to fetch flagged responses' });
  }
});

/**
 * Helper: Update survey progress for a deal
 */
async function updateSurveyProgress(supabase, dealId) {
  try {
    const surveyConfig = require('../../../config/survey.json');

    // Count total required questions (not including conditional ones for now)
    const totalQuestions = surveyConfig.sections.reduce(
      (sum, section) => sum + section.questions.filter(q => q.required && !q.condition).length,
      0
    );

    // Count answered questions
    const { count: answeredCount } = await supabase
      .from('survey_responses')
      .select('*', { count: 'exact', head: true })
      .eq('deal_id', dealId)
      .not('answer', 'is', null);

    const completionPercentage = totalQuestions > 0
      ? Math.round((answeredCount / totalQuestions) * 100)
      : 0;

    const updateData = {
      total_questions: totalQuestions,
      answered_questions: answeredCount || 0,
      completion_percentage: completionPercentage,
      last_saved_at: new Date().toISOString()
    };

    // Mark as started if first answer
    if (answeredCount > 0) {
      const { data: progress } = await supabase
        .from('survey_progress')
        .select('started_at')
        .eq('deal_id', dealId)
        .single();

      if (!progress?.started_at) {
        updateData.started_at = new Date().toISOString();
      }
    }

    // Mark as completed if all required questions answered
    if (completionPercentage >= 100) {
      updateData.completed_at = new Date().toISOString();
    }

    await supabase
      .from('survey_progress')
      .upsert({
        deal_id: dealId,
        ...updateData
      }, {
        onConflict: 'deal_id'
      });
  } catch (error) {
    console.error('Error updating survey progress:', error);
  }
}

module.exports = router;
