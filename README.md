# Aragon Deal Room

A deal management and due diligence portal for agency acquisitions.

## Project Structure

```
Deal Manager v1/
├── backend/                    # Node.js/Express API (deploy to Render)
│   ├── src/
│   │   ├── index.js           # Main server entry point
│   │   ├── lib/
│   │   │   └── supabase.js    # Supabase client configuration
│   │   ├── middleware/
│   │   │   └── auth.js        # Authentication & authorization middleware
│   │   └── routes/
│   │       ├── deals.js       # Deal CRUD operations
│   │       ├── survey.js      # Survey responses
│   │       ├── documents.js   # Document upload/download
│   │       ├── checklist.js   # Due diligence checklist
│   │       └── users.js       # User management
│   ├── package.json
│   └── .env.example
│
├── config/                     # Configuration files
│   ├── survey.json            # 60-question agency audit questionnaire
│   └── checklist-template.json # Default due diligence checklist items
│
├── supabase/
│   └── schema.sql             # Database schema (run in Supabase SQL Editor)
│
├── docs/
│   └── API.md                 # Full API documentation for Lovable integration
│
└── Initial-context.txt        # Original project brief
```

## Setup Instructions

### 1. Supabase Setup

1. Create a new Supabase project at https://supabase.com
2. Go to SQL Editor and run the contents of `supabase/schema.sql`
3. Go to Authentication > Providers and enable:
   - Email (for standard login)
   - Google (for OAuth)
4. Copy your project URL and keys from Settings > API

### 2. Backend Setup (Render)

1. Create a new Web Service on Render
2. Connect your GitHub repo (or upload the `backend/` folder)
3. Configure:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
4. Add environment variables:
   ```
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_ANON_KEY=your-anon-key
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   PORT=3001
   NODE_ENV=production
   CORS_ORIGINS=https://your-lovable-app.lovable.app
   UPLOAD_DIR=./uploads
   MAX_FILE_SIZE=52428800
   ```

### 3. Lovable UI Setup

Use the API documentation in `docs/API.md` to build your frontend in Lovable.

**Key integration points:**

1. **Authentication**: Use Supabase Auth JS library
   ```javascript
   import { createClient } from '@supabase/supabase-js'

   const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

   // Google OAuth
   await supabase.auth.signInWithOAuth({ provider: 'google' })

   // Email/Password
   await supabase.auth.signInWithPassword({ email, password })

   // Get token for API calls
   const { data: { session } } = await supabase.auth.getSession()
   const token = session?.access_token
   ```

2. **API Calls**: Include token in Authorization header
   ```javascript
   const response = await fetch(`${API_URL}/api/deals`, {
     headers: {
       'Authorization': `Bearer ${token}`,
       'Content-Type': 'application/json'
     }
   })
   ```

3. **File Uploads**: Use FormData for document uploads
   ```javascript
   const formData = new FormData()
   formData.append('file', file)
   formData.append('category', 'tax_returns')

   await fetch(`${API_URL}/api/documents/${dealId}/upload`, {
     method: 'POST',
     headers: { 'Authorization': `Bearer ${token}` },
     body: formData
   })
   ```

## Core Features

### For Aragon Team
- Create and manage deals
- View survey responses with internal notes
- Track document collection progress
- Manage due diligence checklist
- Invite sellers to portal
- Add deal notes

### For Sellers
- Complete 60-question agency audit survey
- Upload requested documents
- View checklist status
- Save and resume progress

## Survey Sections

1. Business Overview
2. Ownership & Leadership
3. Team & Org Structure
4. Client Relationships
5. Service Delivery
6. Sales & Marketing
7. Financial Context
8. Technology & Tools
9. Growth & Goals
10. Risks & Challenges

## Checklist Categories

- Financial (tax returns, P&Ls, bank statements)
- Legal (entity docs, litigation history)
- HR (employee roster, compensation, contracts)
- Clients (client list, contracts, concentration)
- Operations (tech stack, SOPs, vendors)
- Insurance (E&O, general liability, cyber)

## Development

```bash
cd backend
npm install
cp .env.example .env  # Edit with your Supabase credentials
npm run dev           # Starts with nodemon for hot reload
```

## API Documentation

See `docs/API.md` for complete endpoint documentation.
