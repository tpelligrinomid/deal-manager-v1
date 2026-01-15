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
 * GET /api/survey/:dealId/respondents
 * Get all users who have survey responses for this deal (team only)
 */
router.get('/:dealId/respondents', requireRole(['admin', 'team_member']), async (req, res) => {
  try {
    const { dealId } = req.params;

    // Get all sellers with deal access
    const { data: sellers, error: sellersError } = await req.supabase
      .from('deal_access')
      .select('user_id, is_primary_contact, granted_at')
      .eq('deal_id', dealId)
      .eq('access_level', 'seller');

    if (sellersError) throw sellersError;

    if (!sellers || sellers.length === 0) {
      return res.json({ respondents: [] });
    }

    // Get profiles for these sellers
    const userIds = sellers.map(s => s.user_id);
    const { data: profiles, error: profilesError } = await req.supabase
      .from('profiles')
      .select('id, email, full_name')
      .in('id', userIds);

    if (profilesError) throw profilesError;

    // Get progress for each user
    const { data: progressRecords, error: progressError } = await req.supabase
      .from('survey_progress')
      .select('user_id, completion_percentage, started_at, completed_at, last_saved_at')
      .eq('deal_id', dealId)
      .in('user_id', userIds);

    if (progressError) throw progressError;

    // Build response
    const progressMap = {};
    for (const p of (progressRecords || [])) {
      progressMap[p.user_id] = p;
    }

    const profileMap = {};
    for (const p of (profiles || [])) {
      profileMap[p.id] = p;
    }

    const respondents = sellers.map(s => {
      const profile = profileMap[s.user_id] || {};
      const progress = progressMap[s.user_id] || {};
      return {
        user_id: s.user_id,
        email: profile.email,
        full_name: profile.full_name,
        is_primary_contact: s.is_primary_contact || false,
        completion_percentage: progress.completion_percentage || 0,
        started_at: progress.started_at || null,
        completed_at: progress.completed_at || null,
        last_saved_at: progress.last_saved_at || null
      };
    });

    res.json({ respondents });
  } catch (error) {
    console.error('Error fetching survey respondents:', error);
    res.status(500).json({ error: 'Failed to fetch survey respondents' });
  }
});

/**
 * GET /api/survey/:dealId
 * Get survey responses for a deal
 * - Sellers: get only their own responses
 * - Team: get all responses grouped by user, or use ?user_id= to filter
 */
router.get('/:dealId', requireDealAccess, async (req, res) => {
  try {
    const { dealId } = req.params;
    const { user_id: queryUserId } = req.query;
    const isTeam = ['admin', 'team_member'].includes(req.user.role);
    const isSeller = req.user.role === 'seller';

    // Determine which user's responses to fetch
    let targetUserId = req.user.id;

    if (isTeam && queryUserId) {
      // Team can request specific user's responses
      targetUserId = queryUserId;
    } else if (isSeller) {
      // Sellers always see their own
      targetUserId = req.user.id;
    }

    // Build query
    let query = req.supabase
      .from('survey_responses')
      .select('*')
      .eq('deal_id', dealId);

    // If team without user_id filter, get all responses
    // Otherwise filter to specific user
    if (isTeam && !queryUserId) {
      // Get all responses for all users - will group by user below
    } else {
      query = query.eq('user_id', targetUserId);
    }

    const { data: responses, error } = await query;
    if (error) throw error;

    // Get progress
    let progressQuery = req.supabase
      .from('survey_progress')
      .select('*')
      .eq('deal_id', dealId);

    if (!isTeam || queryUserId) {
      progressQuery = progressQuery.eq('user_id', targetUserId).single();
    }

    const { data: progressData } = await progressQuery;

    // Transform responses
    if (isTeam && !queryUserId) {
      // Group responses by user for team view
      const responsesByUser = {};
      for (const response of (responses || [])) {
        const uid = response.user_id;
        if (!responsesByUser[uid]) {
          responsesByUser[uid] = {};
        }
        if (!responsesByUser[uid][response.section_id]) {
          responsesByUser[uid][response.section_id] = {};
        }
        responsesByUser[uid][response.section_id][response.question_id] = {
          answer: response.answer,
          answered_at: response.answered_at,
          internal_notes: response.internal_notes,
          flagged: response.flagged
        };
      }

      // Format progress data
      const progressByUser = {};
      if (Array.isArray(progressData)) {
        for (const p of progressData) {
          progressByUser[p.user_id] = p;
        }
      }

      res.json({
        responses_by_user: responsesByUser,
        progress_by_user: progressByUser
      });
    } else {
      // Single user view (seller or team with user_id filter)
      const responseMap = {};
      for (const response of (responses || [])) {
        if (!responseMap[response.section_id]) {
          responseMap[response.section_id] = {};
        }
        responseMap[response.section_id][response.question_id] = {
          answer: response.answer,
          answered_at: response.answered_at,
          internal_notes: isTeam ? response.internal_notes : undefined,
          flagged: isTeam ? response.flagged : undefined
        };
      }

      res.json({
        responses: responseMap,
        progress: progressData || {
          total_questions: 0,
          answered_questions: 0,
          completion_percentage: 0
        }
      });
    }
  } catch (error) {
    console.error('Error fetching survey responses:', error);
    res.status(500).json({ error: 'Failed to fetch survey responses' });
  }
});

/**
 * Middleware to check if user can submit survey responses
 * Only sellers can fill out surveys, not advisors/viewers
 */
const canSubmitSurvey = async (req, res, next) => {
  // Team members can submit on behalf of users (for notes/flags)
  if (['admin', 'team_member'].includes(req.user.role)) {
    return next();
  }

  // Check if user has seller access to this deal
  const { dealId } = req.params;
  const { data: access, error } = await req.supabase
    .from('deal_access')
    .select('access_level')
    .eq('deal_id', dealId)
    .eq('user_id', req.user.id)
    .single();

  if (error || !access) {
    return res.status(403).json({ error: 'No access to this deal' });
  }

  if (access.access_level !== 'seller') {
    return res.status(403).json({
      error: 'Only sellers can submit survey responses',
      code: 'SURVEY_SELLER_ONLY'
    });
  }

  next();
};

/**
 * POST /api/survey/:dealId/responses
 * Save survey responses (batch update)
 * - Sellers save their own responses
 * - Team can optionally specify user_id to add notes/flags
 */
router.post('/:dealId/responses', requireDealAccess, canSubmitSurvey, async (req, res) => {
  try {
    const { dealId } = req.params;
    const { responses, user_id: targetUserId } = req.body;
    const isTeam = ['admin', 'team_member'].includes(req.user.role);

    if (!responses || typeof responses !== 'object') {
      return res.status(400).json({ error: 'Responses object is required' });
    }

    // Determine which user's responses we're saving
    const userId = (isTeam && targetUserId) ? targetUserId : req.user.id;

    // Prepare upsert data
    const upsertData = [];
    for (const [sectionId, questions] of Object.entries(responses)) {
      for (const [questionId, value] of Object.entries(questions)) {
        const responseData = {
          deal_id: dealId,
          user_id: userId,
          section_id: sectionId,
          question_id: questionId,
          answer: value,
          answered_at: new Date().toISOString(),
          answered_by: req.user.id
        };
        upsertData.push(responseData);
      }
    }

    // Upsert responses with new composite key
    const { error: upsertError } = await req.supabase
      .from('survey_responses')
      .upsert(upsertData, {
        onConflict: 'deal_id,user_id,section_id,question_id'
      });

    if (upsertError) throw upsertError;

    // Update progress for this user
    await updateSurveyProgress(req.supabase, dealId, userId);

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
router.patch('/:dealId/response/:sectionId/:questionId', requireDealAccess, canSubmitSurvey, async (req, res) => {
  try {
    const { dealId, sectionId, questionId } = req.params;
    const { answer, internal_notes, flagged, user_id: targetUserId } = req.body;
    const isTeam = ['admin', 'team_member'].includes(req.user.role);

    // Determine which user's response we're updating
    const userId = (isTeam && targetUserId) ? targetUserId : req.user.id;

    const updateData = {
      deal_id: dealId,
      user_id: userId,
      section_id: sectionId,
      question_id: questionId
    };

    // Sellers can only update answers
    if (answer !== undefined) {
      updateData.answer = answer;
      updateData.answered_at = new Date().toISOString();
      updateData.answered_by = req.user.id;
    }

    // Only team members can update internal notes and flags
    if (isTeam) {
      if (internal_notes !== undefined) updateData.internal_notes = internal_notes;
      if (flagged !== undefined) updateData.flagged = flagged;
    }

    const { data: response, error } = await req.supabase
      .from('survey_responses')
      .upsert(updateData, {
        onConflict: 'deal_id,user_id,section_id,question_id'
      })
      .select()
      .single();

    if (error) throw error;

    // Update progress if answer changed
    if (answer !== undefined) {
      await updateSurveyProgress(req.supabase, dealId, userId);
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
      .select('*, profiles:user_id (full_name, email)')
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
 * GET /api/survey/:dealId/compare
 * Compare responses across all respondents for a deal (team only)
 * Returns responses grouped by question for easy comparison
 */
router.get('/:dealId/compare', requireRole(['admin', 'team_member']), async (req, res) => {
  try {
    const { dealId } = req.params;
    const { section_id: sectionFilter } = req.query;

    // Get all responses for this deal
    let query = req.supabase
      .from('survey_responses')
      .select('*')
      .eq('deal_id', dealId);

    if (sectionFilter) {
      query = query.eq('section_id', sectionFilter);
    }

    const { data: responses, error } = await query;
    if (error) throw error;

    // Get user info
    const userIds = [...new Set((responses || []).map(r => r.user_id))];
    const { data: profiles } = await req.supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', userIds);

    const profileMap = {};
    for (const p of (profiles || [])) {
      profileMap[p.id] = p;
    }

    // Group by section > question > user
    const comparison = {};
    for (const r of (responses || [])) {
      if (!comparison[r.section_id]) {
        comparison[r.section_id] = {};
      }
      if (!comparison[r.section_id][r.question_id]) {
        comparison[r.section_id][r.question_id] = {};
      }
      comparison[r.section_id][r.question_id][r.user_id] = {
        answer: r.answer,
        answered_at: r.answered_at,
        user_name: profileMap[r.user_id]?.full_name || profileMap[r.user_id]?.email || 'Unknown'
      };
    }

    res.json({ comparison, users: profileMap });
  } catch (error) {
    console.error('Error comparing survey responses:', error);
    res.status(500).json({ error: 'Failed to compare survey responses' });
  }
});

/**
 * Helper: Update survey progress for a specific user on a deal
 */
async function updateSurveyProgress(supabase, dealId, userId) {
  try {
    const surveyConfig = require('../../../config/survey.json');

    // Count total required questions (not including conditional ones for now)
    const totalQuestions = surveyConfig.sections.reduce(
      (sum, section) => sum + section.questions.filter(q => q.required && !q.condition).length,
      0
    );

    // Count answered questions for this user
    const { count: answeredCount } = await supabase
      .from('survey_responses')
      .select('*', { count: 'exact', head: true })
      .eq('deal_id', dealId)
      .eq('user_id', userId)
      .not('answer', 'is', null);

    const completionPercentage = totalQuestions > 0
      ? Math.round((answeredCount / totalQuestions) * 100)
      : 0;

    const updateData = {
      deal_id: dealId,
      user_id: userId,
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
        .eq('user_id', userId)
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
      .upsert(updateData, {
        onConflict: 'deal_id,user_id'
      });
  } catch (error) {
    console.error('Error updating survey progress:', error);
  }
}

module.exports = router;
