# Survey Management Guide

This document explains how to manage the Agency Audit Questionnaire survey in Deal Room.

## Overview

The survey system consists of:
- **Configuration file**: `config/survey.json` - defines all questions and sections
- **Backend API**: Serves config and stores responses
- **Database**: Stores responses as flexible key-value pairs

## How It Works

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  survey.json    │────>│  Backend API    │────>│   Frontend UI   │
│  (questions)    │     │  /api/survey/*  │     │   (renders)     │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                               │
                               v
                        ┌─────────────────┐
                        │    Database     │
                        │ survey_responses│
                        └─────────────────┘
```

1. Frontend fetches `GET /api/survey/config` to get question definitions
2. Frontend fetches `GET /api/survey/:dealId` to get existing answers
3. User fills out questions, frontend auto-saves via `POST /api/survey/:dealId/responses`
4. Responses stored as individual rows keyed by `(deal_id, section_id, question_id)`

---

## Making Changes to the Survey

### Edit the Configuration File

All survey changes are made in:
```
config/survey.json
```

### Deploy Changes

After editing, push to deploy:
```bash
git add config/survey.json
git commit -m "Update survey: [describe change]"
git push
```

Render auto-deploys. Changes take effect immediately - no database migrations needed.

---

## Safe Changes (No Risk)

These changes won't affect existing response data:

| Change | How to Do It |
|--------|--------------|
| Edit question text/label | Change the `label` field |
| Edit description | Change section `description` field |
| Add placeholder text | Add/edit `placeholder` field |
| Change character limit | Edit `maxLength` field |
| Change number min/max | Edit `min` or `max` fields |
| Add new question | Add new object to section's `questions` array |
| Add new section | Add new object to `sections` array |
| Reorder questions | Move objects within `questions` array |
| Reorder sections | Move objects within `sections` array |
| Add/remove select options | Edit the `options` array |
| Make required optional | Change `required: true` to `required: false` |
| Make optional required | Change `required: false` to `required: true` |

### Example: Edit a Question Label

Before:
```json
{
  "id": "owner_bio",
  "label": "Describe your position...",
  ...
}
```

After:
```json
{
  "id": "owner_bio",
  "label": "Tell us about your role and how you founded the agency.",
  ...
}
```

### Example: Add a New Question

Add to the appropriate section's `questions` array:
```json
{
  "id": "new_question_id",
  "type": "textarea",
  "label": "Your new question here?",
  "required": false,
  "maxLength": 1500
}
```

---

## Risky Changes (Requires Care)

### Changing a Question ID

**DO NOT** change the `id` field of existing questions. This breaks the link to existing responses.

```json
// DON'T DO THIS - existing answers will be orphaned
{
  "id": "owner_bio"  // changing to "founder_bio" breaks existing data
}
```

**If you must rename an ID**, run this SQL first:
```sql
UPDATE survey_responses
SET question_id = 'new_question_id'
WHERE question_id = 'old_question_id';
```

### Changing a Section ID

Same rule - don't change `section.id` values without migrating data:
```sql
UPDATE survey_responses
SET section_id = 'new_section_id'
WHERE section_id = 'old_section_id';
```

### Removing a Question

You can remove questions from the config. Existing responses stay in the database (orphaned but harmless). They simply won't be displayed anymore.

To fully clean up removed question data:
```sql
DELETE FROM survey_responses
WHERE question_id = 'removed_question_id';
```

---

## Question Types Reference

### text
Single-line text input.
```json
{
  "id": "payroll_software",
  "type": "text",
  "label": "What payroll software do you use?",
  "placeholder": "e.g., Gusto, ADP, Paychex",
  "required": true
}
```

### textarea
Multi-line text with character limit.
```json
{
  "id": "owner_bio",
  "type": "textarea",
  "label": "Describe your background...",
  "required": true,
  "maxLength": 3000
}
```

### number
Numeric input with optional min/max.
```json
{
  "id": "founding_year",
  "type": "number",
  "label": "What year was the agency founded?",
  "required": true,
  "min": 1900,
  "max": 2026
}
```

### select
Dropdown with single selection.
```json
{
  "id": "geographic_focus",
  "type": "select",
  "label": "What is your geographic focus?",
  "required": true,
  "options": [
    "Local (single metro area)",
    "Regional (multiple states)",
    "National (US-wide)",
    "Global"
  ]
}
```

### multiselect
Checkboxes for multiple selections. Stored as JSON array.
```json
{
  "id": "primary_services",
  "type": "multiselect",
  "label": "What are your primary service offerings?",
  "required": true,
  "options": [
    "SEO",
    "PPC",
    "Social Media",
    "Content Marketing",
    "Web Design"
  ]
}
```

### boolean
Yes/No question. Stored as `true` or `false`.
```json
{
  "id": "has_employees",
  "type": "boolean",
  "label": "Do you have W-2 employees?",
  "required": true
}
```

### file
File upload (integrates with document system).
```json
{
  "id": "proposal_upload",
  "type": "file",
  "label": "Upload a recent proposal",
  "required": false,
  "accept": ".pdf,.doc,.docx"
}
```

---

## Conditional Questions

Show a question only when another question has a specific answer:

```json
{
  "id": "employee_count",
  "type": "number",
  "label": "How many employees?",
  "required": true,
  "condition": {
    "questionId": "has_employees",
    "value": true
  }
}
```

This question only appears if `has_employees` is answered `true`.

**Rules:**
- The referenced `questionId` must be in the same section
- `value` can be `true`, `false`, or a string matching a select option
- Conditional questions are excluded from progress calculation when hidden

---

## Database Schema

### survey_responses
Stores individual answers:
```
| Column       | Type      | Description                    |
|--------------|-----------|--------------------------------|
| id           | UUID      | Primary key                    |
| deal_id      | UUID      | Reference to deals table       |
| section_id   | TEXT      | Matches section.id in config   |
| question_id  | TEXT      | Matches question.id in config  |
| answer       | JSONB     | The response value             |
| answered_at  | TIMESTAMP | When answered                  |
| answered_by  | UUID      | User who answered              |
| internal_notes| TEXT     | Team-only notes (not for seller)|
| flagged      | BOOLEAN   | Team can flag for review       |
```

### survey_progress
Tracks completion per deal:
```
| Column               | Type      | Description              |
|----------------------|-----------|--------------------------|
| deal_id              | UUID      | Primary key              |
| total_questions      | INTEGER   | Count of required Qs     |
| answered_questions   | INTEGER   | Count answered           |
| completion_percentage| INTEGER   | 0-100                    |
| started_at           | TIMESTAMP | First answer timestamp   |
| completed_at         | TIMESTAMP | 100% completion time     |
| last_saved_at        | TIMESTAMP | Most recent save         |
```

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/survey/config` | Get survey structure (sections & questions) |
| GET | `/api/survey/:dealId` | Get responses and progress for a deal |
| POST | `/api/survey/:dealId/responses` | Batch save responses |
| PATCH | `/api/survey/:dealId/response/:sectionId/:questionId` | Update single response |
| GET | `/api/survey/:dealId/flagged` | Get flagged responses (team only) |

---

## Troubleshooting

### Question not showing up
1. Check the `condition` field - is it hidden by a conditional?
2. Verify the question is in the correct section
3. Check for JSON syntax errors in config file

### Responses not saving
1. Check browser console for API errors
2. Verify the `question_id` matches exactly (case-sensitive)
3. Check Render logs for backend errors

### Progress percentage wrong
Progress only counts `required: true` questions that don't have conditions (or whose conditions are met). Optional questions don't affect the percentage.

### Need to export survey data
```sql
SELECT
  d.agency_name,
  sr.section_id,
  sr.question_id,
  sr.answer,
  sr.answered_at
FROM survey_responses sr
JOIN deals d ON sr.deal_id = d.id
WHERE sr.deal_id = 'your-deal-uuid'
ORDER BY sr.section_id, sr.question_id;
```

---

## Current Survey Sections

1. **owner_background** - Owner Background & Vision (9 questions)
2. **business_overview** - Business Overview (11 questions)
3. **ownership_structure** - Ownership & Corporate Structure (7 questions)
4. **team_structure** - Team & Organizational Structure (11 questions)
5. **hr_operations** - HR & People Operations (12 questions)
6. **client_relationships** - Client Relationships (8 questions)
7. **sales_pipeline** - Sales & Pipeline (10 questions)
8. **marketing** - Marketing (6 questions)
9. **service_delivery** - Service Delivery & Operations (6 questions)
10. **financial_context** - Financial Context (12 questions)
11. **technology_tools** - Technology & Tools (6 questions)
12. **growth_transition** - Growth & Transition Goals (6 questions)
13. **risks_challenges** - Risks & Challenges (7 questions)

**Total: ~110 questions**
