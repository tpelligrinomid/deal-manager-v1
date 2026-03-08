# Aragon Deal Room API Documentation

Base URL: `https://your-render-app.onrender.com` (or `http://localhost:3001` for development)

## Authentication

All API endpoints (except health check and config endpoints) require authentication via Supabase JWT tokens.

Include the token in the Authorization header:
```
Authorization: Bearer <supabase_access_token>
```

The frontend should use Supabase Auth (Google OAuth or email/password) to obtain the token.

---

## Endpoints

### Health Check

#### `GET /health`
Returns server status. No authentication required.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

---

### Configuration

#### `GET /api/config/survey`
Get the survey configuration (questions, sections, conditional logic). No authentication required.

**Response:** Full survey.json structure

#### `GET /api/config/checklist-template`
Get the default checklist template. No authentication required.

**Response:** Full checklist-template.json structure

---

### Deals

#### `GET /api/deals`
List all deals the authenticated user has access to.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| status | string | Filter by deal status (active, on_hold, loi_issued, closed_won, closed_lost, withdrawn) |
| search | string | Search by agency name |
| limit | number | Max results (default: 50) |
| offset | number | Pagination offset (default: 0) |

**Response:**
```json
{
  "deals": [
    {
      "id": "uuid",
      "agency_name": "Acme Marketing",
      "status": "active",
      "survey_completion": 65,
      "checklist_stats": {
        "total": 45,
        "received": 12,
        "flagged": 2
      },
      "created_at": "2024-01-15T10:30:00.000Z"
    }
  ],
  "count": 1
}
```

#### `GET /api/deals/:dealId`
Get a specific deal by ID.

**Response:**
```json
{
  "id": "uuid",
  "agency_name": "Acme Marketing",
  "dba_name": null,
  "website": "https://acmemarketing.com",
  "city": "Austin",
  "state": "TX",
  "primary_contact_name": "John Smith",
  "primary_contact_email": "john@acmemarketing.com",
  "primary_contact_phone": "555-1234",
  "status": "active",
  "nda_signed_date": "2024-01-10",
  "source": "broker",
  "broker_name": "Jane Doe",
  "broker_email": "jane@broker.com",
  "pipedrive_deal_id": "12345",
  "reported_revenue": 1500000,
  "reported_ebitda": 300000,
  "asking_price": 2000000,
  "survey_progress": {
    "total_questions": 55,
    "answered_questions": 36,
    "completion_percentage": 65,
    "started_at": "2024-01-12T10:00:00.000Z",
    "completed_at": null
  },
  "deal_access": [
    {
      "user_id": "uuid",
      "access_level": "seller",
      "granted_at": "2024-01-11T10:00:00.000Z"
    }
  ],
  "created_at": "2024-01-10T15:00:00.000Z"
}
```

#### `POST /api/deals`
Create a new deal. **Requires: admin or team_member role**

**Request Body:**
```json
{
  "agency_name": "Acme Marketing",
  "dba_name": null,
  "website": "https://acmemarketing.com",
  "city": "Austin",
  "state": "TX",
  "primary_contact_name": "John Smith",
  "primary_contact_email": "john@acmemarketing.com",
  "primary_contact_phone": "555-1234",
  "source": "broker",
  "broker_name": "Jane Doe",
  "broker_email": "jane@broker.com",
  "nda_signed_date": "2024-01-10",
  "pipedrive_deal_id": "12345",
  "reported_revenue": 1500000,
  "reported_ebitda": 300000,
  "asking_price": 2000000
}
```

**Response:** Created deal object

#### `PATCH /api/deals/:dealId`
Update a deal. **Requires: admin or team_member role**

**Request Body:** Any deal fields to update

**Response:** Updated deal object

#### `DELETE /api/deals/:dealId`
Delete a deal. **Requires: admin role**

**Response:**
```json
{ "success": true }
```

#### `POST /api/deals/:dealId/invite-seller`
Invite a seller to access the deal portal. **Requires: admin or team_member role**

**Request Body:**
```json
{
  "email": "seller@agency.com",
  "full_name": "John Smith"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Invitation sent to seller@agency.com"
}
```

#### `POST /api/deals/:dealId/notes`
Add a note to a deal. **Requires: admin or team_member role**

**Request Body:**
```json
{
  "content": "Called John today, discussed timeline expectations.",
  "note_type": "call_log"
}
```

Note types: `general`, `call_log`, `meeting`, `internal`

**Response:** Created note object

#### `GET /api/deals/:dealId/notes`
Get all notes for a deal. **Requires: admin or team_member role**

**Response:**
```json
[
  {
    "id": "uuid",
    "content": "Called John today...",
    "note_type": "call_log",
    "created_at": "2024-01-15T10:30:00.000Z",
    "profiles": {
      "full_name": "Sarah Connor",
      "email": "sarah@aragon.com"
    }
  }
]
```

---

### Survey

#### `GET /api/survey/:dealId`
Get all survey responses for a deal.

**Response:**
```json
{
  "responses": {
    "business_overview": {
      "founding_year": {
        "answer": 2015,
        "answered_at": "2024-01-12T10:30:00.000Z",
        "internal_notes": "Verify this date",
        "flagged": true
      },
      "founding_story": {
        "answer": "Started in a garage...",
        "answered_at": "2024-01-12T10:35:00.000Z"
      }
    },
    "ownership_leadership": {
      ...
    }
  },
  "progress": {
    "total_questions": 55,
    "answered_questions": 36,
    "completion_percentage": 65
  }
}
```

Note: `internal_notes` and `flagged` are only visible to admin/team_member roles.

#### `POST /api/survey/:dealId/responses`
Save multiple survey responses at once (batch save).

**Request Body:**
```json
{
  "responses": {
    "business_overview": {
      "founding_year": 2015,
      "founding_story": "We started in a garage..."
    },
    "ownership_leadership": {
      "owner_count": 2
    }
  }
}
```

**Response:**
```json
{
  "success": true,
  "saved": 3
}
```

#### `PATCH /api/survey/:dealId/response/:sectionId/:questionId`
Update a single response (including internal notes for team members).

**Request Body:**
```json
{
  "answer": 2016,
  "internal_notes": "Owner corrected this - originally said 2015",
  "flagged": false
}
```

**Response:** Updated response object

#### `GET /api/survey/:dealId/flagged`
Get all flagged responses. **Requires: admin or team_member role**

**Response:** Array of flagged response objects

---

### Documents

#### `GET /api/documents/:dealId`
List all documents for a deal.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| category | string | Filter by category |

**Response:**
```json
[
  {
    "id": "uuid",
    "file_name": "2023_Tax_Return.pdf",
    "file_size": 1048576,
    "mime_type": "application/pdf",
    "category": "tax_returns",
    "subcategory": "2023",
    "description": "Federal tax return for 2023",
    "uploaded_at": "2024-01-14T09:00:00.000Z",
    "profiles": {
      "full_name": "John Smith",
      "email": "john@agency.com"
    }
  }
]
```

#### `POST /api/documents/:dealId/upload`
Upload a document. Use `multipart/form-data`.

**Form Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| file | File | Yes | The file to upload |
| category | string | No | Document category (default: "other") |
| subcategory | string | No | Subcategory (e.g., year) |
| description | string | No | Description |
| checklist_item_id | uuid | No | Link to checklist item |

**Categories:** `tax_returns`, `financial_statements`, `insurance`, `payroll`, `client_contracts`, `vendor_agreements`, `org_charts`, `legal_documents`, `other`

**Response:** Created document object

#### `GET /api/documents/:dealId/:documentId/download`
Download a document file.

**Response:** File download

#### `PATCH /api/documents/:dealId/:documentId`
Update document metadata. **Requires: admin or team_member role**

**Request Body:**
```json
{
  "category": "financial_statements",
  "description": "Updated P&L for Q4",
  "seller_visible": true
}
```

**Response:** Updated document object

#### `DELETE /api/documents/:dealId/:documentId`
Delete a document. **Requires: admin or team_member role**

**Response:**
```json
{ "success": true }
```

---

### Checklist

#### `GET /api/checklist/:dealId`
Get all checklist items for a deal.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| category | string | Filter by category |
| status | string | Filter by status |

**Response:**
```json
{
  "items": {
    "Financial": [
      {
        "id": "uuid",
        "item_name": "Tax Returns (3 years)",
        "description": "Federal and state tax returns...",
        "status": "received",
        "required": true,
        "requested_at": "2024-01-11T10:00:00.000Z",
        "received_at": "2024-01-13T14:00:00.000Z",
        "internal_notes": "Only 2 years provided so far",
        "documents": [
          {
            "id": "uuid",
            "file_name": "2023_Tax_Return.pdf",
            "uploaded_at": "2024-01-13T14:00:00.000Z"
          }
        ]
      }
    ],
    "Legal": [...],
    "HR": [...]
  },
  "stats": {
    "total": 45,
    "not_requested": 10,
    "requested": 15,
    "received": 12,
    "reviewed": 5,
    "flagged": 3
  }
}
```

#### `PATCH /api/checklist/:dealId/:itemId`
Update a checklist item.

**Request Body:**
```json
{
  "status": "reviewed",
  "internal_notes": "All documents look good",
  "seller_notes": "Please provide updated version"
}
```

**Statuses:** `not_requested`, `requested`, `received`, `reviewed`, `flagged`

**Response:** Updated item object

#### `POST /api/checklist/:dealId`
Add a custom checklist item. **Requires: admin or team_member role**

**Request Body:**
```json
{
  "category": "Financial",
  "item_name": "Revenue forecast",
  "description": "2024 revenue projections",
  "required": false
}
```

**Response:** Created item object

#### `DELETE /api/checklist/:dealId/:itemId`
Remove a checklist item. **Requires: admin or team_member role**

**Response:**
```json
{ "success": true }
```

#### `POST /api/checklist/:dealId/request-all`
Mark all not_requested items as requested. **Requires: admin or team_member role**

**Response:**
```json
{ "updated": 25 }
```

---

### Users

#### `GET /api/users/me`
Get current user's profile.

**Response:**
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "full_name": "John Smith",
  "role": "team_member",
  "company_name": null,
  "phone": "555-1234",
  "created_at": "2024-01-01T00:00:00.000Z"
}
```

#### `PATCH /api/users/me`
Update current user's profile.

**Request Body:**
```json
{
  "full_name": "John Smith Jr.",
  "phone": "555-5678"
}
```

**Response:** Updated profile object

#### `GET /api/users`
List all users. **Requires: admin or team_member role**

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| role | string | Filter by role |
| search | string | Search by email or name |
| limit | number | Max results (default: 50) |
| offset | number | Pagination offset |

**Response:**
```json
{
  "users": [...],
  "count": 25
}
```

#### `GET /api/users/team/members`
Get team members only (for dropdowns). **Requires: admin or team_member role**

**Response:**
```json
[
  {
    "id": "uuid",
    "email": "sarah@aragon.com",
    "full_name": "Sarah Connor",
    "role": "admin"
  }
]
```

---

## Error Responses

All errors follow this format:

```json
{
  "error": "Error message here"
}
```

Common status codes:
- `400` - Bad request (missing/invalid parameters)
- `401` - Unauthorized (missing or invalid token)
- `403` - Forbidden (insufficient permissions)
- `404` - Not found
- `500` - Server error

---

### NDAs

#### `GET /api/nda`
List all NDAs. **Requires: admin or team_member role**

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| status | string | Filter by status (signed, attached, voided) |
| source | string | Filter by source (digital, external) |
| attached | string | Filter by attachment status ('true' or 'false') |
| search | string | Search by company name, email, or signer name |
| limit | number | Max results (default: 50) |
| offset | number | Pagination offset (default: 0) |

**Response:**
```json
{
  "ndas": [
    {
      "id": "uuid",
      "source": "digital",
      "signer_company_name": "Acme Marketing",
      "signer_full_name": "John Smith",
      "signer_email": "john@acme.com",
      "signed_at": "2026-01-15T10:30:00.000Z",
      "status": "signed",
      "deal_id": null
    }
  ],
  "count": 42
}
```

#### `POST /api/nda/sign`
Public endpoint for electronic NDA signing. No authentication required.

**Request Body:**
```json
{
  "company_name": "Acme Marketing Agency",
  "company_address": "123 Main St, Austin, TX 78701",
  "full_name": "John Smith",
  "title": "CEO",
  "email": "john@acme.com",
  "phone": "512-555-1234",
  "signature": "John Smith"
}
```

**Response:**
```json
{
  "success": true,
  "message": "NDA signed successfully. A copy will be sent to your email.",
  "nda": {
    "id": "uuid",
    "signed_at": "2026-01-15T10:30:00.000Z",
    "effective_date": "2026-01-15"
  }
}
```

#### `POST /api/nda/upload-external`
Upload an externally signed NDA. **Requires: admin or team_member role**

Use `multipart/form-data` for this endpoint.

**Form Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| file | File (PDF) | Yes | The signed NDA PDF |
| signer_company_name | string | Yes | Company name of the signer |
| signer_full_name | string | Yes | Full name of the signer |
| signer_email | string | Yes | Email of the signer |
| signer_company_address | string | No | Company address |
| signer_title | string | No | Job title |
| signer_phone | string | No | Phone number |
| signed_at | string | No | Date NDA was signed (ISO format, defaults to now) |
| effective_date | string | No | Effective date (YYYY-MM-DD, defaults to signed_at date) |
| notes | string | No | Internal notes about this NDA |

**Response:**
```json
{
  "success": true,
  "message": "External NDA uploaded successfully",
  "nda": {
    "id": "uuid",
    "source": "external",
    "signer_company_name": "Acme Marketing",
    "signer_full_name": "John Smith",
    "signer_email": "john@acme.com",
    "signed_at": "2026-01-10T00:00:00.000Z",
    "effective_date": "2026-01-10",
    "status": "signed"
  }
}
```

#### `GET /api/nda/unattached`
List NDAs not attached to any deal. **Requires: admin or team_member role**

**Response:**
```json
[
  {
    "id": "uuid",
    "signer_company_name": "Acme Marketing",
    "signer_full_name": "John Smith",
    "signer_email": "john@acme.com",
    "signed_at": "2026-01-15T10:30:00.000Z",
    "source": "digital"
  }
]
```

#### `GET /api/nda/:ndaId`
Get a specific NDA. **Requires: admin or team_member role**

**Response:** Full NDA object with related deal and profile data

#### `PATCH /api/nda/:ndaId`
Update an NDA. **Requires: admin or team_member role**

**Request Body:**
```json
{
  "deal_id": "uuid",
  "notes": "Internal notes here",
  "status": "voided"
}
```

#### `GET /api/nda/:ndaId/pdf`
Download the NDA PDF. **Requires: admin or team_member role**

**Response:** PDF file download

#### `DELETE /api/nda/:ndaId`
Delete an NDA. **Requires: admin role**

---

## User Roles

| Role | Description | Permissions |
|------|-------------|-------------|
| admin | Aragon administrator | Full access to everything |
| team_member | Aragon team | Full access except user management |
| seller | Agency owner/seller | Access to assigned deals only, can complete survey and upload docs |
| advisor | External advisor | View-only access to assigned deals |
