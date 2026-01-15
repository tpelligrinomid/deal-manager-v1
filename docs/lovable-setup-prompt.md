# Lovable Setup Prompt

Paste this into your Lovable project to set up the architecture:

---

```
This project uses Lovable Cloud for the frontend and Supabase, with a separate backend API on Render.

## Architecture

- **Frontend**: Lovable Cloud (React + TypeScript + Supabase Auth)
- **Backend API**: https://deal-manager-v1.onrender.com (Node.js/Express)
- **Database**: Lovable Cloud's Supabase (shared between frontend and backend)

## How Auth Works

1. Users authenticate via Lovable's Supabase (Google OAuth or email/password)
2. Frontend gets a JWT token from Supabase session
3. Frontend includes JWT in Authorization header when calling the Render backend
4. Backend validates the JWT against the same Supabase instance
5. Backend returns data based on user's role

## API Integration

Create `src/lib/api.ts` for backend calls:

```typescript
const API_BASE_URL = 'https://deal-manager-v1.onrender.com';

export async function apiFetch(
  endpoint: string,
  token: string,
  options: RequestInit = {}
) {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || 'Request failed');
  }

  return response.json();
}

// Usage example:
// const session = await supabase.auth.getSession();
// const deals = await apiFetch('/api/deals', session.data.session.access_token);
```

## User Roles

The backend enforces role-based access:

| Role | Access |
|------|--------|
| `admin` | Full access to everything |
| `team_member` | All deals, most features |
| `seller` | Only their assigned deal (survey + documents) |
| `advisor` | Read-only access to assigned deals |
| `pending` | Blocked - awaiting authorization |

## Post-Login Routing

After authentication, check user role and route accordingly:

```typescript
const checkUserAndRoute = async (session) => {
  try {
    const user = await apiFetch('/api/users/me', session.access_token);

    switch (user.role) {
      case 'admin':
      case 'team_member':
      case 'advisor':
        navigate('/deals');
        break;
      case 'seller':
        navigate('/portal');
        break;
      case 'pending':
        navigate('/pending');
        break;
    }
  } catch (error) {
    if (error.message.includes('pending')) {
      navigate('/pending');
    } else {
      navigate('/login');
    }
  }
};
```

## Key Backend Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/users/me` | GET | Get current user profile |
| `/api/deals` | GET | List all deals |
| `/api/deals` | POST | Create a deal |
| `/api/deals/:id` | GET | Get deal details |
| `/api/deals/:id/invite-seller` | POST | Invite seller to deal |
| `/api/survey/:dealId` | GET | Get survey responses |
| `/api/survey/:dealId/responses` | POST | Save survey responses |
| `/api/documents/:dealId` | GET | List documents |
| `/api/documents/:dealId/upload` | POST | Upload document |
| `/api/checklist/:dealId` | GET | Get checklist items |
| `/api/users/invite` | POST | Pre-authorize a new user (admin only) |

## Design System

Use throughout the app:

- **Headings**: Playfair Display font
- **Body**: Inter font
- **Primary color**: #58B50B (green)
- **Accent color**: #ED8C34 (orange)
- **Background**: #EEEEEE
- **Cards**: #FFFFFF with subtle shadow
- **Border radius**: 0.5rem (8px)
```
