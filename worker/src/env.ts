export interface Env {
  DB: D1Database;
  BACKUPS?: R2Bucket;
  ASSETS?: Fetcher;
  GOOGLE_CLIENT_ID: string;
  /** Secret. */
  GOOGLE_CLIENT_SECRET: string;
  /** Secret. Comma-separated "email:role" pairs, e.g. "kid@gmail.com:daughter,me@gmail.com:parent". */
  ALLOWED_USERS: string;
  /** "true" only for local development and tests: enables /auth/dev-login. */
  DEV_LOGIN?: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'daughter' | 'parent';
}

export type AppEnv = { Bindings: Env; Variables: { user: User } };
