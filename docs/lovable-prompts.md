# Lovable UI Prompts - Aragon Deal Room

Use these prompts in Lovable to build each screen. Copy and paste them one at a time.

---

## Initial Setup Prompt

**Paste this FIRST to establish the design system:**

```
Create a new React application called "Aragon Deal Room" - a deal management portal for M&A due diligence.

DESIGN SYSTEM (use throughout all screens):

Typography:
- Headings: Playfair Display (Google Fonts) - weights 400, 500, 600, 700
- Body: Inter (Google Fonts) - weights 300, 400, 500, 600, 700
- H1: text-4xl md:text-5xl, H2: text-3xl md:text-4xl, H3: text-2xl

Colors:
- Primary green: #58B50B (CTAs, links, active states)
- Accent orange: #ED8C34 (highlights, badges)
- Background: #EEEEEE (page background)
- Card/White: #FFFFFF (cards, modals, inputs)
- Hero/Sidebar: #FAFAFA (light sections)
- Text: #171717 (primary), #666666 (muted)
- Border: #D9D9D9

Styling:
- Border radius: 0.5rem (8px) on all cards, buttons, inputs
- Card shadows: subtle (0 2px 8px -2px rgba(0,0,0,0.06))
- Buttons: green fill, white text, lift 2px on hover with shadow
- Inputs: white background, gray border, green focus ring
- Container max-width: 1400px, centered with 2rem padding

Tech stack:
- React with TypeScript
- Tailwind CSS
- Supabase for auth (@supabase/supabase-js)
- React Router for navigation
- Lucide React for icons

Set up Supabase auth with Google OAuth and email/password sign-in.

API Base URL: https://deal-manager-v1.onrender.com

Create the basic app structure with:
1. Auth context/provider using Supabase
2. Protected route wrapper
3. Basic layout with sidebar navigation
4. Placeholder pages for: Dashboard, Deals, Settings
```

---

## Screen 1: Authentication

```
Create the authentication screens (Login and Sign Up) for Aragon Deal Room.

Design requirements:
- Split layout: left side has branding, right side has form
- Left side: #FAFAFA background, centered Aragon Holdings logo (just text "Aragon Holdings" in Playfair Display for now), tagline "Deal Room & Due Diligence Portal"
- Right side: white background, centered form card

Login form:
- "Welcome back" heading (Playfair Display)
- Email input
- Password input
- "Sign in" button (green, full width)
- Divider with "or"
- "Continue with Google" button (white with border, Google icon)
- Link to sign up page

Sign up form:
- "Create your account" heading
- Full name input
- Email input
- Password input
- "Create account" button (green)
- Link to login page

Use Supabase auth:
- supabase.auth.signInWithPassword for email login
- supabase.auth.signUp for registration
- supabase.auth.signInWithOAuth({ provider: 'google' }) for Google

After successful auth, redirect to /deals
```

---

## Screen 2: Dashboard / Deals List

```
Create the main Deals dashboard page for Aragon Deal Room.

Layout:
- Sidebar on left (240px wide, #FAFAFA background)
- Main content area with #EEEEEE background

Sidebar:
- "Aragon Holdings" text logo at top (Playfair Display)
- Navigation items with Lucide icons:
  - Deals (LayoutDashboard icon) - active state has green left border and green text
  - Settings (Settings icon)
- User profile at bottom: avatar circle with initials, name, "Sign out" link

Main content:
- Header: "Deals" (H1, Playfair Display) + "New Deal" button (green, Plus icon)
- Filter bar: Search input, Status dropdown (All, Active, On Hold, LOI Issued, Closed Won, Closed Lost)
- Deals displayed as cards in a grid (1 col mobile, 2 cols tablet, 3 cols desktop)

Deal card design:
- White background, subtle shadow, 0.5rem radius
- Agency name as card title (bold)
- Status badge (colored pill: green for active, orange for on hold, etc.)
- Key metrics row: Survey completion %, Documents received count
- Location (city, state) in muted text
- "View Deal" link at bottom
- Hover: elevate shadow slightly

Fetch deals from API:
GET https://deal-manager-v1.onrender.com/api/deals
Headers: Authorization: Bearer {supabase_access_token}

Handle empty state: "No deals yet" message with "Create your first deal" button
```

---

## Screen 3: Create Deal Modal

```
Create a "New Deal" modal/dialog for creating deals.

Trigger: "New Deal" button on deals page opens modal

Modal design:
- Overlay with semi-transparent dark background
- Centered white card, max-width 600px
- "Create New Deal" heading (Playfair Display)
- X close button in top right

Form fields (two columns where appropriate):
- Agency Name* (required)
- DBA Name (optional)
- Website
- City, State (side by side)
- Primary Contact Name*
- Primary Contact Email*
- Primary Contact Phone
- Source dropdown: Broker, Inbound, Outbound, Referral
- Broker Name (shown if source is Broker)
- Broker Email (shown if source is Broker)
- NDA Signed Date (date picker)
- Reported Revenue (currency input)
- Reported EBITDA (currency input)
- Asking Price (currency input)

Footer:
- "Cancel" button (gray/outline)
- "Create Deal" button (green)

POST to https://deal-manager-v1.onrender.com/api/deals
On success: close modal, refresh deals list, show success toast
```

---

## Screen 4: Deal Detail View

```
Create the Deal Detail page that shows when you click into a deal.

URL: /deals/:dealId

Layout:
- Same sidebar as dashboard
- Main content with tabs

Header section:
- Back arrow + "Back to Deals" link
- Agency name (H1, Playfair Display)
- Status badge
- "Edit Deal" button (outline style)

Tab navigation (horizontal tabs below header):
- Overview
- Survey (with completion % badge)
- Documents (with count badge)
- Checklist (with progress badge)
- Notes

Overview tab content:
- Two column layout
- Left column "Deal Information" card:
  - Contact info (name, email, phone)
  - Location
  - Website (linked)
  - Source
  - NDA signed date
- Right column "Financials" card:
  - Reported Revenue
  - Reported EBITDA
  - Asking Price
  - Implied multiple (calculated: price / EBITDA)
- Bottom: "Survey Progress" progress bar and "Checklist Progress" progress bar

Fetch deal from:
GET https://deal-manager-v1.onrender.com/api/deals/{dealId}
```

---

## Screen 5: Survey Tab (Internal View)

```
Create the Survey tab for the Deal Detail page - this is the INTERNAL view for Aragon team to review survey responses.

Layout:
- Left sidebar: list of survey sections (scrollable)
- Main area: selected section's questions and responses

Section sidebar:
- List all 13 sections from the survey
- Show completion indicator (checkmark if all required questions answered, partial circle if in progress)
- Active section highlighted with green left border
- Sections:
  1. Owner Background & Vision
  2. Business Overview
  3. Ownership & Corporate Structure
  4. Team & Organizational Structure
  5. HR & People Operations
  6. Client Relationships
  7. Sales & Pipeline
  8. Marketing
  9. Service Delivery & Operations
  10. Financial Context
  11. Technology & Tools
  12. Growth & Transition Goals
  13. Risks & Challenges

Main content for selected section:
- Section title (H2)
- Section description (muted text)
- List of questions with responses

Question display:
- Question label (medium weight)
- Response value (or "Not answered" in muted italic if empty)
- For internal team: "Add note" button that expands to textarea
- Flag toggle (orange flag icon) to mark responses for follow-up
- If flagged, show orange left border on that question

Fetch survey responses:
GET https://deal-manager-v1.onrender.com/api/survey/{dealId}

Fetch survey config for questions:
GET https://deal-manager-v1.onrender.com/api/config/survey
```

---

## Screen 6: Documents Tab

```
Create the Documents tab for the Deal Detail page.

Layout:
- Header with "Documents" title and "Upload Document" button
- Filter/sort bar: Category dropdown, sort by date
- Document list as table or cards

Category filters (from document_category enum):
- All Documents
- Tax Returns
- Financial Statements
- Insurance
- Payroll
- Client Contracts
- Vendor Agreements
- Org Charts
- Legal Documents
- Other

Document card/row display:
- File icon (based on mime type - PDF, Word, Excel, Image icons from Lucide)
- File name (clickable to download)
- Category badge
- Uploaded by (name)
- Upload date
- File size
- Actions: Download, Delete (trash icon, with confirmation)

Upload modal (triggered by "Upload Document" button):
- Drag and drop zone with dashed border
- Or "Browse files" button
- Category dropdown (required)
- Subcategory text input (optional, e.g., "2023" for tax returns)
- Description textarea (optional)
- Link to checklist item dropdown (optional)
- "Upload" button

Empty state: "No documents uploaded yet" with upload button

API endpoints:
GET https://deal-manager-v1.onrender.com/api/documents/{dealId}
POST https://deal-manager-v1.onrender.com/api/documents/{dealId}/upload (multipart/form-data)
GET https://deal-manager-v1.onrender.com/api/documents/{dealId}/{documentId}/download
```

---

## Screen 7: Checklist Tab

```
Create the Checklist tab for the Deal Detail page.

Layout:
- Summary stats bar at top
- Checklist items grouped by category in expandable sections

Stats bar:
- Total items count
- Received count (green)
- Requested/pending count (orange)
- Flagged count (red)
- Progress bar showing overall completion

Category sections (collapsible):
- Financial
- Legal & Entity
- HR & Personnel
- Clients & Contracts
- Operations
- Insurance

Each category section:
- Category name as header with chevron to expand/collapse
- Count badge showing "X of Y received"

Checklist item row:
- Status icon (circle for not requested, clock for requested, check for received, eye for reviewed, flag for flagged)
- Item name
- Description (smaller, muted)
- Status dropdown to change status
- Linked documents (if any) - small file icons that link to documents
- "Add note" expand button for internal notes
- If documents linked: show count badge

Status colors:
- Not requested: gray
- Requested: orange
- Received: blue
- Reviewed: green
- Flagged: red

Actions:
- "Request All" button (marks all not_requested as requested)
- "Add Custom Item" button opens modal to add new checklist item

API:
GET https://deal-manager-v1.onrender.com/api/checklist/{dealId}
PATCH https://deal-manager-v1.onrender.com/api/checklist/{dealId}/{itemId}
```

---

## Screen 8: Notes Tab

```
Create the Notes tab for the Deal Detail page.

Layout:
- "Add Note" form at top
- Notes list below (newest first)

Add Note form:
- Note type dropdown: General, Call Log, Meeting, Internal
- Textarea for note content (placeholder: "Add a note about this deal...")
- "Add Note" button (green)

Note card display:
- Note type badge (colored)
- Note content (preserves line breaks)
- Author name and avatar
- Timestamp (relative: "2 hours ago" or absolute if older than 24h)
- Edit button (pencil icon) - only for your own notes
- No delete for safety (notes are part of the record)

Note type colors:
- General: gray
- Call Log: blue
- Meeting: purple
- Internal: orange

Empty state: "No notes yet. Add the first note to keep track of conversations and updates."

API:
GET https://deal-manager-v1.onrender.com/api/deals/{dealId}/notes
POST https://deal-manager-v1.onrender.com/api/deals/{dealId}/notes
```

---

## Screen 9: Seller Portal - Survey Form

```
Create the Seller Portal survey form - this is a separate view for sellers to complete their survey.

This should be a distinct experience from the internal team view - cleaner, more focused.

URL: /portal/survey (seller accesses after logging in)

Layout:
- No sidebar - full width
- Header: "Agency Audit Questionnaire" + Aragon Holdings logo
- Progress bar showing overall completion %
- Section navigation as horizontal tabs or step indicator

Survey form:
- One section at a time (not all sections on one page)
- Section title and description at top
- Questions rendered based on type from survey config:
  - text: single line input
  - textarea: multi-line input with maxLength counter
  - number: number input with min/max
  - select: dropdown
  - multiselect: checkbox group
  - boolean: yes/no radio buttons or toggle
  - file: file upload zone
- Conditional questions: only show if condition is met (check previous answers)
- Required indicator (*) on required fields

Navigation:
- "Previous" button (outline, disabled on first section)
- "Save & Continue" button (green)
- "Save Draft" button (outline) - saves without advancing
- Section dots/steps showing progress

Auto-save:
- Save responses automatically when user moves to next section
- Show "Saved" indicator with timestamp

Completion:
- After last section, show completion screen
- "Your responses have been submitted. Thank you!"
- Summary of completion stats

API:
GET https://deal-manager-v1.onrender.com/api/config/survey (get questions)
GET https://deal-manager-v1.onrender.com/api/survey/{dealId} (get existing responses)
POST https://deal-manager-v1.onrender.com/api/survey/{dealId}/responses (save responses)

The dealId should come from the seller's access - they only have access to one deal.
```

---

## Screen 10: Seller Portal - Document Upload

```
Create the Seller Portal document upload page.

URL: /portal/documents

Layout:
- Header: "Document Upload" + Aragon Holdings logo
- Instructions text explaining what documents are needed

Two sections:

1. "Requested Documents" section:
- Show checklist items that are in "requested" status
- For each: item name, description, upload zone
- When document uploaded, show success state with file name
- Status changes to "received" automatically

2. "Additional Documents" section:
- For any other files the seller wants to share
- Category dropdown
- Description field
- Upload zone

Upload zone design:
- Dashed border, light background
- Cloud upload icon
- "Drag files here or click to browse"
- Show file name and size after selection
- Progress bar during upload
- Success checkmark when complete

Accepted file types shown: PDF, Word, Excel, PowerPoint, Images, ZIP

API:
GET https://deal-manager-v1.onrender.com/api/checklist/{dealId}?status=requested
POST https://deal-manager-v1.onrender.com/api/documents/{dealId}/upload
```

---

## Screen 11: Invite Seller Modal

```
Create an "Invite Seller" modal accessible from the Deal Detail page.

Trigger: "Invite Seller" button in deal header (only shown to team members)

Modal design:
- "Invite Seller to Portal" heading
- Description: "Send an invitation to the agency owner to complete the survey and upload documents."

Form fields:
- Full Name* (required)
- Email Address* (required)

Info box:
- "The seller will receive an email with a link to create their account and access the deal portal."

Footer:
- "Cancel" button
- "Send Invitation" button (green)

On submit:
POST https://deal-manager-v1.onrender.com/api/deals/{dealId}/invite-seller
Body: { email, full_name }

Success: Show toast "Invitation sent to {email}"
```

---

## Additional Prompts

### Toast Notifications
```
Add a toast notification system using a toast library or custom implementation.

Toast types:
- Success (green): "Deal created successfully", "Document uploaded", etc.
- Error (red): "Failed to save", "Upload failed", etc.
- Info (blue): "Changes saved", etc.

Position: bottom-right
Auto-dismiss after 4 seconds
Include close X button
```

### Loading States
```
Add consistent loading states throughout the app:

- Page loading: centered spinner with "Loading..." text
- Button loading: replace text with spinner, disable button
- Card loading: skeleton placeholder with pulse animation
- Table loading: skeleton rows

Use the primary green color for spinners.
```

### Error Handling
```
Add error boundary and error states:

- API error: show error message with "Try again" button
- 404 page: "Page not found" with link back to deals
- Network error: "Unable to connect. Check your internet connection."
- Auth error: redirect to login with message "Session expired. Please sign in again."
```

---

## Environment Variables for Lovable

When deploying, set these in Lovable:

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_API_BASE_URL=https://deal-manager-v1.onrender.com
```
