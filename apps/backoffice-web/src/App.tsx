import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { ApprovalsPage } from './admin/ApprovalsPage';
import { ForgotPasswordPage } from './auth/ForgotPasswordPage';
import { LoginPage } from './auth/LoginPage';
import { ResetPasswordPage } from './auth/ResetPasswordPage';
import { SignUpPage } from './auth/SignUpPage';
import { VerifyEmailPage } from './auth/VerifyEmailPage';
import { PropertiesPage } from './host/PropertiesPage';
import { NewPropertyPage, PropertyPage } from './host/PropertyPage';
import { UnitPage } from './host/UnitPage';
import { SessionProvider } from './session';
import { AdminHome } from './shell/AdminHome';
import { AuditPage } from './shell/AuditPage';
import { RequireSession } from './shell/RequireSession';
import { Shell } from './shell/Shell';

/**
 * A signed-in page. Host pages serve hosts and admins acting as one; admin pages serve admins who
 * are not acting. Anyone else is sent home.
 */
function Page({ area, children }: { area: 'host' | 'admin'; children: ReactNode }) {
  return (
    <RequireSession>
      {(me) => {
        const adminArea = me.account.role === 'admin' && !me.actingAs;
        if ((area === 'admin') !== adminArea) return <Navigate to="/" replace />;
        return <Shell me={me}>{children}</Shell>;
      }}
    </RequireSession>
  );
}

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
                  {me.account.role === 'admin' && !me.actingAs ? <AdminHome /> : <PropertiesPage />}
                </Shell>
              )}
            </RequireSession>
          }
        />
        <Route
          path="/properties/new"
          element={
            <Page area="host">
              <NewPropertyPage />
            </Page>
          }
        />
        <Route
          path="/properties/:id"
          element={
            <Page area="host">
              <PropertyPage />
            </Page>
          }
        />
        <Route
          path="/units/:id"
          element={
            <Page area="host">
              <UnitPage />
            </Page>
          }
        />
        <Route
          path="/admin/approvals"
          element={
            <Page area="admin">
              <ApprovalsPage />
            </Page>
          }
        />
        <Route
          path="/admin/audit"
          element={
            <Page area="admin">
              <AuditPage />
            </Page>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </SessionProvider>
  );
}
