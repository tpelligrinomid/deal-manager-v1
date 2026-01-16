# NDA Management Guide

This document explains how the Non-Disclosure Agreement (NDA) system works in Deal Room.

## Overview

The NDA is the gateway to creating deals. Prospects sign an NDA on a public page before any confidential information is exchanged. Once signed, the team can attach the NDA to a deal.

```
┌─────────────────────────────────────────────────────────────────┐
│                        NDA → DEAL FLOW                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. Prospect visits public NDA page                             │
│                  ↓                                              │
│  2. Fills out form + electronically signs                       │
│                  ↓                                              │
│  3. System auto-counter-signs for Aragon Holdings LLC           │
│                  ↓                                              │
│  4. PDF generated + emailed to both parties                     │
│                  ↓                                              │
│  5. NDA appears in dashboard (status: "signed")                 │
│                  ↓                                              │
│  6. Team creates deal + attaches NDA (status: "attached")       │
│                  ↓                                              │
│  7. Team invites seller to deal                                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Public NDA Signing Page

### URL
```
https://your-frontend.com/nda
```

### Form Fields
| Field | Required | Description |
|-------|----------|-------------|
| Company Name | Yes | The prospect's company name |
| Company Address | No | Business address |
| Full Name | Yes | Signer's legal name |
| Title | Yes | Signer's job title |
| Email | Yes | Where to send the signed copy |
| Phone | No | Contact phone number |
| Signature | Yes | Typed name as electronic signature |

### API Endpoint
```javascript
POST /api/nda/sign (public, no auth required)

Body:
{
  "company_name": "Acme Marketing Agency",
  "company_address": "123 Main St, Austin, TX 78701",
  "full_name": "John Smith",
  "title": "CEO",
  "email": "john@acme.com",
  "phone": "512-555-1234",
  "signature": "John Smith"
}

Response:
{
  "success": true,
  "message": "NDA signed successfully. A copy will be sent to your email.",
  "nda": {
    "id": "uuid",
    "signed_at": "2026-01-15T...",
    "effective_date": "2026-01-15",
    "signer_company": "Acme Marketing Agency",
    "signer_name": "John Smith",
    "counter_signer_company": "Aragon Holdings LLC",
    "counter_signer_name": "Tristan Pelligrino"
  }
}
```

## NDA Terms Endpoint

To display NDA terms on the signing page:
```javascript
GET /api/nda/terms (public)

Response:
{
  "title": "Mutual Non-Disclosure Agreement",
  "sections": [...],
  "counterParty": {
    "companyName": "Aragon Holdings LLC",
    "signerName": "Tristan Pelligrino",
    "signerTitle": "Managing Member"
  }
}
```

---

## Team Dashboard (Authenticated)

### List All NDAs
```javascript
GET /api/nda
Query params:
  - status: 'signed' | 'attached' | 'voided'
  - attached: 'true' | 'false' (filter by attachment status)
  - search: search by company name, email, or signer name
  - limit: default 50
  - offset: default 0

Response:
{
  "ndas": [...],
  "count": 42
}
```

### List Unattached NDAs
For deal creation dropdown:
```javascript
GET /api/nda/unattached

Response: [
  {
    "id": "uuid",
    "signer_company_name": "Acme Marketing",
    "signer_full_name": "John Smith",
    "signer_email": "john@acme.com",
    "signed_at": "2026-01-15T..."
  }
]
```

### Get Single NDA
```javascript
GET /api/nda/:ndaId

Response: {
  "id": "uuid",
  "signer_company_name": "...",
  "signer_full_name": "...",
  ...
  "deals": { "id": "...", "agency_name": "..." },  // if attached
  "attached_by_profile": { "full_name": "..." }
}
```

### Attach NDA to Deal
```javascript
PATCH /api/nda/:ndaId
Body: { "deal_id": "deal-uuid" }
```

### Download NDA PDF
```javascript
GET /api/nda/:ndaId/pdf
// Returns PDF file download
```

---

## Creating a Deal with NDA

When creating a deal, you can optionally attach an NDA:

```javascript
POST /api/deals
Body: {
  "agency_name": "Acme Marketing Agency",
  "nda_id": "nda-uuid",  // Optional: attach NDA
  ...other fields
}
```

If `nda_id` is provided:
1. System verifies NDA exists and isn't already attached
2. Deal is created with `nda_id` reference
3. NDA status updated to "attached"

---

## Environment Variables

Configure these in Render:

```env
# Counter-signature info (Aragon Holdings)
NDA_COMPANY_NAME=Aragon Holdings LLC
NDA_COMPANY_ADDRESS=123 Main Street, Austin, TX 78701
NDA_COUNTER_SIGNER_NAME=Tristan Pelligrino
NDA_COUNTER_SIGNER_TITLE=Managing Member

# PDF storage directory
NDA_UPLOAD_DIR=./uploads/ndas

# Email webhook (n8n)
N8N_WEBHOOK_URL=https://your-n8n-webhook-url
```

---

## n8n Email Workflow

When an NDA is signed, a webhook is sent to n8n:

```json
{
  "type": "nda_signed",
  "to": "signer@email.com",
  "name": "John Smith",
  "companyName": "Acme Marketing Agency",
  "signedAt": "2026-01-15T14:30:00Z",
  "effectiveDate": "2026-01-15",
  "ndaId": "uuid",
  "pdfPath": "/uploads/ndas/nda-uuid.pdf",
  "counterSignerCompany": "Aragon Holdings LLC",
  "counterSignerName": "Tristan Pelligrino"
}
```

Your n8n workflow should:
1. Generate or fetch the signed PDF
2. Email it to the signer
3. Optionally notify the team

---

## Database Schema

### ndas table
```sql
id UUID PRIMARY KEY
-- Signer info
signer_company_name TEXT NOT NULL
signer_company_address TEXT
signer_full_name TEXT NOT NULL
signer_title TEXT NOT NULL
signer_email TEXT NOT NULL
signer_phone TEXT
-- Signature
signature_text TEXT NOT NULL
signed_at TIMESTAMPTZ NOT NULL
signer_ip_address TEXT
signer_user_agent TEXT
-- Counter-signature
counter_signer_name TEXT NOT NULL
counter_signer_title TEXT NOT NULL
counter_signed_at TIMESTAMPTZ NOT NULL
-- PDF
pdf_path TEXT
pdf_generated_at TIMESTAMPTZ
-- Deal linking
deal_id UUID REFERENCES deals(id)
attached_at TIMESTAMPTZ
attached_by UUID REFERENCES profiles(id)
-- Meta
effective_date DATE NOT NULL
status TEXT CHECK (status IN ('signed', 'attached', 'voided'))
notes TEXT
created_at TIMESTAMPTZ
```

### deals table addition
```sql
nda_id UUID REFERENCES ndas(id) -- Link to attached NDA
```

---

## NDA Statuses

| Status | Meaning |
|--------|---------|
| `signed` | NDA is signed but not yet attached to a deal |
| `attached` | NDA is attached to a deal |
| `voided` | NDA has been voided (rare, admin only) |

---

## Audit Trail

Each NDA captures:
- IP address of signer
- User agent (browser info)
- Exact timestamp
- Both signatures with timestamps

The generated PDF includes:
- Full NDA text
- Both party signatures
- Document ID
- Timestamp

---

## Troubleshooting

### PDF not generating
1. Check that `pdfkit` is installed: `npm install pdfkit`
2. Check uploads directory exists and is writable
3. Check Render logs for errors

### Email not sending
1. Verify `N8N_WEBHOOK_URL` is set
2. Check n8n workflow is active
3. Check n8n execution logs

### NDA not appearing in list
1. Verify RLS policies allow viewing
2. Check user role is admin or team_member

### Can't attach NDA to deal
1. NDA might already be attached to another deal
2. Check NDA status is 'signed' not 'voided'
