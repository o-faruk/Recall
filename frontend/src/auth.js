// ----------------------------------------------------------------------
// Recall — Cognito auth setup
// Configures AWS Amplify with the Cognito user pool, and exposes a helper to
// grab the logged-in user's ID token (a JWT) to send to the API.
// Values come from VITE_ env vars (set in Amplify + .env.local for live mode).
// ----------------------------------------------------------------------

import { Amplify } from "aws-amplify";
import { fetchAuthSession } from "aws-amplify/auth";

const userPoolId = import.meta.env.VITE_COGNITO_USER_POOL_ID;
const userPoolClientId = import.meta.env.VITE_COGNITO_CLIENT_ID;

// Only configure if the vars are present (so local demo mode still runs).
if (userPoolId && userPoolClientId) {
  Amplify.configure({
    Auth: { Cognito: { userPoolId, userPoolClientId } },
  });
}

// Returns the current user's Cognito ID token (JWT), or null if not signed in.
// The API Gateway Cognito authorizer validates this token.
export async function getIdToken() {
  try {
    const { tokens } = await fetchAuthSession();
    return tokens?.idToken?.toString() ?? null;
  } catch {
    return null;
  }
}
