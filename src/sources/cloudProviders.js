import { authorizedFetch, redirectUri } from './oauth.js'

/**
 * Cloud source configuration.
 *
 * Client IDs are not secrets — they identify the app and are visible in every
 * authorization request. They are tied to the deployment's origin, though,
 * which is why one cannot ship in the repo and each deployment supplies its own.
 */

export const CLOUD_PROVIDERS = {
  gdrive: {
    id: 'gdrive',
    label: 'Google Drive',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: [
      'https://www.googleapis.com/auth/drive.readonly',
      'openid',
      'email',
    ],
    // Google will not return a code to a popup without an explicit prompt
    extraAuthParams: { access_type: 'online', prompt: 'consent' },
    appTypeHint: 'Web application',
    profileUrl: 'https://www.googleapis.com/oauth2/v3/userinfo',
    parseProfile: (d) => ({ name: d.name || d.email, email: d.email }),
    setup: {
      console: 'https://console.cloud.google.com/apis/credentials',
      steps: [
        'Create (or pick) a project in Google Cloud Console',
        'Enable the Google Drive API for it',
        'Create an OAuth 2.0 Client ID of type "Web application"',
        'Add the redirect URI below, then paste the client ID here',
      ],
    },
  },

  onedrive: {
    id: 'onedrive',
    label: 'OneDrive',
    authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: ['Files.Read', 'User.Read'],
    extraAuthParams: {},
    appTypeHint: 'Single-page application',
    profileUrl: 'https://graph.microsoft.com/v1.0/me',
    parseProfile: (d) => ({
      name: d.displayName || d.userPrincipalName,
      email: d.mail || d.userPrincipalName,
    }),
    setup: {
      console: 'https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade',
      steps: [
        'Register an application in Microsoft Entra ID (Azure AD)',
        'Under Authentication, add a "Single-page application" platform',
        'Add the redirect URI below, then paste the Application (client) ID here',
      ],
    },
  },
}

/** Client IDs are public identifiers, so localStorage is the right home. */
const KEY = (id) => `cloudClientId_${id}`

export function loadClientId(providerId) {
  try { return localStorage.getItem(KEY(providerId)) || '' } catch { return '' }
}

export function saveClientId(providerId, value) {
  try { localStorage.setItem(KEY(providerId), value.trim()) } catch { /* ignore */ }
}

/**
 * Confirm the token actually works by reading the signed-in account.
 * This is what turns "we got a token" into "you are connected as someone".
 */
export async function fetchProfile(providerId) {
  const config = CLOUD_PROVIDERS[providerId]
  const res = await authorizedFetch(providerId, config.profileUrl)
  if (!res.ok) throw new Error(`Could not read your ${config.label} profile (HTTP ${res.status}).`)
  return config.parseProfile(await res.json())
}

export { redirectUri }
