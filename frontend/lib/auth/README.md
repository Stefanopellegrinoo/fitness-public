# Authentication Module

Core authentication system for Fitness App with persistent state, proactive token refresh, and multi-tab synchronization.

## Structure

```
lib/auth/
├── types.ts              # Type definitions (User, AuthState, etc.)
├── auth.context.tsx      # React Context & Provider
├── storage.ts            # localStorage abstraction with fallback
├── token.service.ts      # JWT decoding and expiration tracking
├── storage.test.ts       # Unit tests for storage
└── token.service.test.ts # Unit tests for token service
```

## Key Components

### `storage.ts` - Persistent Storage Layer
Abstraction for saving/loading authentication data to localStorage with graceful fallback for private mode.

**Functions:**
- `saveAuthData(token, user)` - Save token + user object
- `getAuthData()` - Retrieve token and user from storage
- `clearAuthData()` - Remove all auth data
- `hasAuthData()` - Check if valid auth data exists

**Features:**
- Private mode detection and memory fallback
- JSON parse error handling
- Atomic operations for token + user

**Example:**
```typescript
import { saveAuthData, getAuthData, clearAuthData } from '@/lib/auth/storage';

// After login
saveAuthData(accessToken, user);

// On app startup
const { token, user } = getAuthData();

// On logout
clearAuthData();
```

### `token.service.ts` - JWT Token Management
Utilities for decoding JWT tokens, checking expiration, and calculating refresh times.

**Functions:**
- `decodeToken(token)` - Decode JWT and extract claims (exp, userId, email, etc.)
- `isTokenExpired(token, bufferMs)` - Check if token is expired (with optional buffer)
- `getUserIdFromToken(token)` - Extract userId claim
- `getEmailFromToken(token)` - Extract email claim
- `getRefreshTime(token)` - Calculate when to refresh (exp - 60 seconds)

**Features:**
- Automatic error handling for malformed tokens
- Expiration buffer support for proactive refresh (default 0, typically 60000 ms = 1 minute)
- Unix timestamp conversion (JWT uses seconds, we use milliseconds)

**Example:**
```typescript
import { tokenService } from '@/lib/auth/token.service';

// Check expiration
const isExpired = tokenService.isTokenExpired(token);

// Schedule proactive refresh
const refreshTime = tokenService.getRefreshTime(token);
if (refreshTime) {
  const delayMs = refreshTime - Date.now();
  setTimeout(() => refreshToken(), delayMs);
}

// Extract claims
const userId = tokenService.getUserIdFromToken(token);
```

### `types.ts` - Type Definitions

```typescript
interface User {
  id: string;
  email: string;
  createdAt: string;
}

interface AuthState {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  tokenExpiresAt: number | null;      // Unix ms timestamp
  isInitializing: boolean;             // True during localStorage restore
}
```

### `auth.context.tsx` - React Provider
Provides authentication state and methods throughout the app.

**Hooks:**
- `useAuth()` - Access auth state and methods

**Methods:**
- `login(credentials)` - Authenticate user
- `register(credentials)` - Create new account
- `logout()` - Clear session
- `refresh()` - Request new token (handled internally)

## Initialization Flow

1. App mounts → AuthProvider initializes
2. `isInitializing = true` (show loading spinner)
3. Read from `storage.getAuthData()`
4. If token exists and valid → restore to context
5. If token exists but expired → attempt proactive refresh
6. If refresh fails → clear storage, redirect to login (silently)
7. `isInitializing = false` (render content)

## Token Refresh Flow

### Proactive Refresh
- Scheduled at `tokenExpiresAt - 60000 ms` (1 minute before expiry)
- Called silently in background
- User doesn't see interruption
- New token stored in localStorage

### Reactive Refresh (401 handling)
- API call returns 401
- `fetchWithRefresh()` intercepts
- Calls refresh endpoint
- Retries original request
- If refresh fails → redirect to login

## Multi-Tab Synchronization

When user logs in/out in one tab:
1. `saveAuthData()` triggers storage event
2. Other tabs listen via `storage` event listener
3. Auth context updates within 500ms
4. All tabs stay synchronized

## Private Mode Handling

When localStorage unavailable (private browsing):
1. `storage.ts` detects error
2. Falls back to in-memory storage
3. Session works but data lost on browser close
4. No errors shown to user
5. Can still refresh tokens (via cookies)

## Testing

Unit tests are provided for all core functionality:

```bash
# Once test runner is installed:
npm install -D vitest

# Run tests
npm test
```

**Test coverage:**
- `storage.test.ts`: Save/get/clear, JSON errors, private mode fallback
- `token.service.test.ts`: Decode, expiration, claim extraction, refresh time

## Error Handling

- **Malformed tokens**: Treated as expired, triggers refresh
- **localStorage quota exceeded**: Falls back to memory
- **Private mode**: No errors, session-only auth
- **Network errors during refresh**: Retry with exponential backoff
- **Token decode fails**: Token marked as expired immediately

## Implementation Notes

1. **JWT exp claim**: Standard says it's in SECONDS, we convert to milliseconds internally
2. **Refresh buffer**: Hardcoded at 60 seconds (change `getRefreshTime()` if needed)
3. **Memory fallback**: Persistent for session lifetime, not cleared on errors
4. **No signature verification**: jwt-decode only extracts claims; backend verified when issued

## Future Improvements

- [ ] Persistent refresh tokens (current: session-only)
- [ ] Configurable refresh buffer
- [ ] MFA/2FA support
- [ ] Social login integration
- [ ] Session timeout with warning
- [ ] Revocation blacklist (if needed)

## Related Files

- Backend: `/auth/login`, `/auth/register`, `/auth/refresh`, `/auth/logout` endpoints
- Middleware: `middleware.ts` - validates tokens in protected routes
- Pages: `app/(auth)/login`, `app/(auth)/register` - auth UI
- Components: Protected route guards in `app/(protected)/layout.tsx`

## Phase Implementation

- **Phase 1** ✅: storage.ts, token.service.ts, types update, dependency install
- **Phase 2** 🔄: auth.context.tsx integration, initialization, proactive refresh
- **Phase 3**: Middleware token validation and route protection
- **Phase 4**: 401 interceptor and token refresh in API layer
- **Phase 5**: Testing and integration verification
- **Phase 6**: Documentation and cleanup
