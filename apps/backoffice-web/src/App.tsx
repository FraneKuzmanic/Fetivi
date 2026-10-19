import { Navigate, Route, Routes } from 'react-router';
import { ForgotPasswordPage } from './auth/ForgotPasswordPage';
import { LoginPage } from './auth/LoginPage';
import { ResetPasswordPage } from './auth/ResetPasswordPage';
import { SignUpPage } from './auth/SignUpPage';
import { VerifyEmailPage } from './auth/VerifyEmailPage';
import { SessionProvider } from './session';
import { AdminHome } from './shell/AdminHome';
import { AuditPage } from './shell/AuditPage';
import { HostHome } from './shell/HostHome';
import { RequireSession } from './shell/RequireSession';
import { Shell } from './shell/Shell';

/** The router is supplied by the caller: BrowserRouter in main.tsx, MemoryRouter in tests. */
export function App() {
  return (
    <SessionProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/sign-up" element={<SignUpPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route
          path="/"
          element={
            <RequireSession>
              {(me) => (
                <Shell me={me}>
                  {me.account.role === 'admin' && !me.actingAs ? <AdminHome /> : <HostHome />}
                </Shell>
              )}
            </RequireSession>
          }
        />
        <Route
          path="/admin/audit"
          element={
            <RequireSession>
              {(me) =>
                me.account.role === 'admin' && !me.actingAs ? (
                  <Shell me={me}>
                    <AuditPage />
                  </Shell>
                ) : (
                  <Navigate to="/" replace />
                )
              }
            </RequireSession>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </SessionProvider>
  );
}
