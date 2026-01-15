# Lovable Master Prompt - Aragon Deal Room

Copy and paste this entire prompt into a new Lovable project. Do NOT enable Lovable Cloud when creating the project.

---

```
Create a React + TypeScript application called "Deal Room" - a deal management portal for M&A due diligence by Aragon Holdings.

## CRITICAL: Manual Supabase Setup

Do NOT use Lovable Cloud. Create a manual Supabase client.

Create `src/lib/supabase.ts`:
```typescript
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
```

Create `src/lib/api.ts`:
```typescript
const API_BASE_URL = 'https://deal-manager-v1.onrender.com';

export const api = {
  baseUrl: API_BASE_URL,

  async fetch(endpoint: string, options: RequestInit = {}) {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    return response;
  },

  async authFetch(endpoint: string, token: string, options: RequestInit = {}) {
    return this.fetch(endpoint, {
      ...options,
      headers: {
        ...options.headers,
        'Authorization': `Bearer ${token}`,
      },
    });
  }
};
```

## Design System

**Typography:**
- Headings: "Playfair Display" (Google Fonts) - weights 400, 500, 600, 700
- Body: "Inter" (Google Fonts) - weights 300, 400, 500, 600, 700
- Add to index.html: `<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap" rel="stylesheet">`

**Colors:**
- Primary (green): #58B50B - CTAs, links, active states
- Accent (orange): #ED8C34 - highlights, badges
- Background: #EEEEEE - page background
- Card/White: #FFFFFF - cards, modals, inputs
- Sidebar: #FAFAFA - sidebar, hero sections
- Text primary: #171717
- Text muted: #666666
- Border: #D9D9D9

**Styling:**
- Border radius: 0.5rem (8px) on cards, buttons, inputs
- Card shadow: `0 2px 8px -2px rgba(0,0,0,0.06), 0 4px 16px -4px rgba(0,0,0,0.08)`
- Buttons: green fill (#58B50B), white text, hover lifts 2px with shadow
- Inputs: white background, gray border, green focus ring (#58B50B)

**Tailwind config customization:**
```javascript
// Add to tailwind.config.js
theme: {
  extend: {
    colors: {
      primary: '#58B50B',
      accent: '#ED8C34',
      background: '#EEEEEE',
      sidebar: '#FAFAFA',
    },
    fontFamily: {
      display: ['Playfair Display', 'serif'],
      sans: ['Inter', 'sans-serif'],
    },
  },
}
```

## App Structure

Create these routes:
- `/login` - Login page (public)
- `/signup` - Sign up page (public)
- `/auth/callback` - OAuth callback handler
- `/pending` - Pending authorization page
- `/deals` - Deals dashboard (protected: admin, team_member, advisor)
- `/deals/:id` - Deal detail (protected: admin, team_member, advisor)
- `/portal` - Seller portal (protected: seller only)
- `/settings` - User settings (protected: any authorized user)

## Authentication Context

Create `src/contexts/AuthContext.tsx`:

```typescript
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { api } from '@/lib/api';

interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  role: 'admin' | 'team_member' | 'seller' | 'advisor' | 'pending';
  company_name?: string;
}

interface AuthContextType {
  session: Session | null;
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session) {
        fetchProfile(session.access_token);
      } else {
        setLoading(false);
      }
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        if (session) {
          await fetchProfile(session.access_token);
        } else {
          setProfile(null);
          setLoading(false);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const fetchProfile = async (token: string) => {
    try {
      const response = await api.authFetch('/api/users/me', token);
      if (response.ok) {
        const data = await response.json();
        setProfile(data);
      } else if (response.status === 403) {
        // User is pending authorization
        setProfile({ id: '', email: '', full_name: '', role: 'pending' });
      }
    } catch (error) {
      console.error('Failed to fetch profile:', error);
    } finally {
      setLoading(false);
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setProfile(null);
  };

  return (
    <AuthContext.Provider value={{ session, user, profile, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};
```

## Protected Route Component

Create `src/components/ProtectedRoute.tsx`:

```typescript
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: string[];
}

export function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
  const { session, profile, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-muted">Loading...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (profile?.role === 'pending') {
    return <Navigate to="/pending" replace />;
  }

  if (allowedRoles && profile && !allowedRoles.includes(profile.role)) {
    // Redirect based on role
    if (profile.role === 'seller') {
      return <Navigate to="/portal" replace />;
    }
    return <Navigate to="/deals" replace />;
  }

  return <>{children}</>;
}
```

## Login Page

Create `/login` page with this exact design:

- Centered card on #EEEEEE background
- Card: white background, rounded-lg, shadow, padding 2rem, max-width 420px
- "Deal Room" heading in Playfair Display, text-4xl, #171717
- "by Aragon Holdings" subtitle in text-sm, #666666, italic
- "Sign in to access your deal room" in text-sm, #666666, margin-bottom 2rem
- Email input with mail icon
- Password input with lock icon
- "Sign In" button: full width, #58B50B background, white text, rounded-lg, py-3
- Divider: horizontal line with "or" text in the middle
- "Continue with Google" button: full width, white background, #D9D9D9 border, Google "G" icon on left
- "Don't have an account? Sign up" link at bottom in primary green

Login handlers:
```typescript
const handleEmailLogin = async (e: React.FormEvent) => {
  e.preventDefault();
  setLoading(true);
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    toast.error(error.message);
  }
  setLoading(false);
};

const handleGoogleLogin = async () => {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${window.location.origin}/auth/callback`
    }
  });
  if (error) {
    toast.error(error.message);
  }
};
```

## Sign Up Page

Same design as login but with:
- "Create your account" heading
- Full name input (with user icon)
- Email input
- Password input
- "Create Account" button
- Note below form: "You must be invited before you can access the Deal Room." in text-sm, #666666
- "Already have an account? Sign in" link

Sign up handler:
```typescript
const handleSignUp = async (e: React.FormEvent) => {
  e.preventDefault();
  setLoading(true);
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName }
    }
  });
  if (error) {
    toast.error(error.message);
  } else {
    toast.success('Account created! Checking authorization...');
    // Auth state change will handle redirect
  }
  setLoading(false);
};
```

## Auth Callback Page

Create `/auth/callback` page:
- Shows loading spinner
- Handles OAuth redirect
- Redirects to appropriate page based on role

```typescript
useEffect(() => {
  const handleCallback = async () => {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error || !session) {
      navigate('/login');
      return;
    }
    // Profile fetch happens in AuthContext, which triggers redirect
  };
  handleCallback();
}, []);
```

## Pending Authorization Page

Create `/pending` page:
- Centered card (same style as login)
- Clock icon (Lucide) at top, text-4xl, #666666
- "Account Pending" heading in Playfair Display
- "Your account is awaiting authorization. Please contact an administrator for access." in text-muted
- "Sign Out" button: outline style (border only, primary color text)

## Navigation After Auth

In the main App component, handle post-auth routing:
- After auth state changes and profile is loaded
- If role is 'seller' → navigate to '/portal'
- If role is 'admin', 'team_member', or 'advisor' → navigate to '/deals'
- If role is 'pending' → navigate to '/pending'

## Placeholder Pages

Create simple placeholder pages for now:
- `/deals` - "Deals Dashboard" heading, "Coming soon..." text
- `/portal` - "Seller Portal" heading, "Coming soon..." text
- `/settings` - "Settings" heading, "Coming soon..." text

These will be built out in subsequent prompts.

## Toast Notifications

Use react-hot-toast or sonner for toast notifications:
- Success: green
- Error: red
- Position: bottom-right
- Auto-dismiss after 4 seconds

## File Structure

```
src/
├── components/
│   ├── ProtectedRoute.tsx
│   └── ui/ (shadcn components)
├── contexts/
│   └── AuthContext.tsx
├── lib/
│   ├── supabase.ts
│   ├── api.ts
│   └── utils.ts
├── pages/
│   ├── Login.tsx
│   ├── SignUp.tsx
│   ├── AuthCallback.tsx
│   ├── Pending.tsx
│   ├── Deals.tsx
│   ├── Portal.tsx
│   └── Settings.tsx
├── App.tsx
└── main.tsx
```

## Environment Variables Needed

The user will configure these in Lovable settings:
- VITE_SUPABASE_URL
- VITE_SUPABASE_ANON_KEY

Do not hardcode any credentials.
```

---

After pasting this prompt, set your environment variables in Lovable:
- `VITE_SUPABASE_URL` = your Supabase project URL
- `VITE_SUPABASE_ANON_KEY` = your Supabase anon key
