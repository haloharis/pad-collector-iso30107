import { AppState, type AppStateStatus } from 'react-native';
import { randomUUID } from 'expo-crypto';

// A UUID generated when the app opens, renewed after 30 minutes in the background
// (SPEC section 5). Groups one sitting's clips for later train/test splitting —
// split by install_id, never by session, since one person has many sessions.
const RENEW_AFTER_MS = 30 * 60 * 1000;

let sessionId = randomUUID();
let backgroundedAt: number | null = null;

AppState.addEventListener('change', (state: AppStateStatus) => {
  if (state === 'background' || state === 'inactive') {
    backgroundedAt ??= Date.now();
  } else if (state === 'active') {
    if (backgroundedAt != null && Date.now() - backgroundedAt > RENEW_AFTER_MS) {
      sessionId = randomUUID();
    }
    backgroundedAt = null;
  }
});

export function getSessionId(): string {
  return sessionId;
}
