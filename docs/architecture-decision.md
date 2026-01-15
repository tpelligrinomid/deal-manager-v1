# Architecture Decision: Lovable Cloud + Render Backend

## Decision

We are using **Lovable Cloud's Supabase** for the database and authentication, while keeping our **custom backend API on Render**.

## Why This Change

Originally, we planned to use a separate Supabase project. However, Lovable Cloud offers significant advantages:

- **Simplified auth**: Google OAuth is pre-configured
- **No environment variable management** in the frontend
- **Seamless integration** between Lovable UI and Supabase
- **One less service to manage**

The migration risk is minimal - if we ever leave Lovable, we simply export the database and point to a new Supabase instance.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND                                 │
│                    (Lovable Cloud)                               │
│  - React + TypeScript                                           │
│  - Supabase Auth (Google OAuth, Email/Password)                 │
│  - Connects to Lovable's Supabase automatically                 │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      │ API Calls (with Supabase JWT)
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                         BACKEND                                  │
│              (Render - deal-manager-v1.onrender.com)            │
│  - Node.js + Express                                            │
│  - Validates Supabase JWT tokens                                │
│  - Business logic, file uploads                                 │
│  - Connects to Lovable's Supabase via service role key          │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      │ Database queries
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                        DATABASE                                  │
│                  (Lovable Cloud Supabase)                       │
│  - PostgreSQL                                                   │
│  - Tables: profiles, authorized_emails, deals, documents, etc.  │
│  - Row Level Security (RLS)                                     │
│  - Auth triggers for invite-only access                         │
└─────────────────────────────────────────────────────────────────┘
```

## Setup Required

### 1. Lovable Cloud Supabase

Run these SQL files in Lovable's Supabase SQL Editor:
- `supabase/schema.sql` - Core tables and RLS policies
- `supabase/migration-001-auth-flow.sql` - Invite-only auth system

Then add the first admin:
```sql
INSERT INTO authorized_emails (email, role, full_name)
VALUES ('your-email@example.com', 'admin', 'Your Name');
```

### 2. Render Backend

Update environment variables in Render to use Lovable's Supabase credentials:

| Variable | Value |
|----------|-------|
| `SUPABASE_URL` | Lovable's Supabase project URL |
| `SUPABASE_ANON_KEY` | Lovable's anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Lovable's service role key |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | Your Lovable app URL |

### 3. Google OAuth

Configure in Lovable Cloud dashboard:
- Users → Auth Settings → Google
- Add Google Client ID and Secret from Google Cloud Console

## Why Keep the Backend on Render?

The Render backend provides:

1. **Complex business logic** - Survey processing, checklist management, deal workflows
2. **File uploads** - Document storage and management
3. **Admin operations** - Using Supabase service role key for privileged operations
4. **API abstraction** - Clean REST API that could be consumed by other clients
5. **Future flexibility** - Easy to add features without Lovable constraints

## Data Flow Examples

### User Signs Up
1. User clicks "Sign Up" in Lovable frontend
2. Lovable's Supabase Auth creates the user
3. Database trigger checks `authorized_emails` table
4. If email is authorized → profile created with correct role
5. If not authorized → profile created with 'pending' role

### User Loads Deals
1. User logs in via Lovable frontend
2. Frontend gets Supabase session (JWT token)
3. Frontend calls `GET /api/deals` on Render backend
4. Backend validates JWT against Lovable's Supabase
5. Backend queries Lovable's Supabase for deals
6. Returns data to frontend

### Seller Uploads Document
1. Seller selects file in Lovable frontend
2. Frontend calls `POST /api/documents/:dealId/upload` on Render backend
3. Backend validates JWT, checks user has access to deal
4. Backend saves file, creates record in Lovable's Supabase
5. Returns success to frontend
