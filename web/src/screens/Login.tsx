import { useSearchParams } from 'react-router';

const ERRORS: Record<string, string> = {
  private: "This app is private. That Google account isn't on the list.",
  cancelled: 'Sign-in was cancelled.',
  state: 'Sign-in timed out. Please try again.',
  google: "Google sign-in didn't work. Please try again.",
};

export function Login() {
  const [params] = useSearchParams();
  const error = params.get('error');
  return (
    <div className="safe-top grid min-h-dvh place-items-center px-6">
      <div className="w-full max-w-sm text-center">
        <img src="/icons/icon.svg" alt="" className="mx-auto mb-6 size-24 drop-shadow-lg" />
        <h1 className="mb-2 text-3xl font-extrabold tracking-tight">Pocket</h1>
        <p className="mb-8 text-ink-2">All your accounts. One clear picture of where your money goes.</p>
        {error && (
          <p role="alert" className="mb-4 rounded-2xl bg-warn-soft px-4 py-3 text-sm font-medium text-warn">
            {ERRORS[error] ?? 'Something went wrong. Please try again.'}
          </p>
        )}
        {/* A full-page link (not a pop-up) so it works inside the iPhone home-screen app. */}
        <a
          href="/auth/login"
          className="flex min-h-12 w-full items-center justify-center gap-3 rounded-2xl bg-surface px-4 font-semibold text-ink shadow ring-1 ring-line hover:ring-brand"
        >
          <svg viewBox="0 0 48 48" className="size-5" aria-hidden>
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
          </svg>
          Continue with Google
        </a>
      </div>
    </div>
  );
}
