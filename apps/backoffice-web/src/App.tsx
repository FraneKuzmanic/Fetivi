import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { ApprovalsPage } from './admin/ApprovalsPage';
import { DestinationPage, NewDestinationPage } from './admin/catalog/DestinationPage';
import { DestinationsPage } from './admin/catalog/DestinationsPage';
import { NewRecordPage, RecordPage } from './admin/catalog/RecordPage';
import { SeedingPage } from './admin/catalog/seeding/SeedingPage';
import { CurationPage } from './admin/curation/CurationPage';
import { StalenessPage } from './admin/curation/StalenessPage';
import { FeedbackStatsPage } from './admin/feedback/FeedbackStatsPage';
import { OrderLookupPage } from './admin/orders/OrderLookupPage';
import { OrderPage } from './admin/orders/OrderPage';
import { NewOfferPage, OfferPage } from './admin/providers/OfferPage';
import { NewProviderPage, ProviderPage } from './admin/providers/ProviderPage';
import { ProvidersPage } from './admin/providers/ProvidersPage';
import { ReconciliationPage } from './admin/reconciliation/ReconciliationPage';
import { ForgotPasswordPage } from './auth/ForgotPasswordPage';
import { LoginPage } from './auth/LoginPage';
import { ResetPasswordPage } from './auth/ResetPasswordPage';
import { SignUpPage } from './auth/SignUpPage';
import { VerifyEmailPage } from './auth/VerifyEmailPage';
import { InboxPage } from './host/inbox/InboxPage';
import { PropertiesPage } from './host/PropertiesPage';
import { NewPropertyPage, PropertyPage } from './host/PropertyPage';
import { HostPicksPage } from './host/picks/HostPicksPage';
import { ProvidersPage as HostProvidersPage } from './host/services/ProvidersPage';
import { NewServicePage, ServicePage } from './host/services/ServicePage';
import { ServicesPage } from './host/services/ServicesPage';
import { NotificationsPage } from './host/settings/notifications/NotificationsPage';
import { UnitStatsPage } from './host/stats/UnitStatsPage';
import { NewStayPage } from './host/stays/NewStayPage';
import { ConfirmProposalPage } from './host/stays/proposed/ConfirmProposalPage';
import { StayPage } from './host/stays/StayPage';
import { StaysPage } from './host/stays/StaysPage';
import { SuggestionsPage } from './host/suggestions/SuggestionsPage';
import { UnitPage } from './host/UnitPage';
import { ImportPage } from './host/wizard/import/ImportPage';
import { WizardPage } from './host/wizard/WizardPage';
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
          path="/properties/:id/picks"
          element={
            <Page area="host">
              <HostPicksPage />
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
          path="/units/:id/stats"
          element={
            <Page area="host">
              <UnitStatsPage />
            </Page>
          }
        />
        <Route
          path="/units/:id/setup"
          element={
            <Page area="host">
              <WizardPage />
            </Page>
          }
        />
        <Route
          path="/units/:id/setup/import"
          element={
            <Page area="host">
              <ImportPage />
            </Page>
          }
        />
        <Route
          path="/units/:id/setup/:stepId"
          element={
            <Page area="host">
              <WizardPage />
            </Page>
          }
        />
        <Route
          path="/stays"
          element={
            <Page area="host">
              <StaysPage />
            </Page>
          }
        />
        <Route
          path="/services"
          element={
            <Page area="host">
              <ServicesPage />
            </Page>
          }
        />
        <Route
          path="/services/new"
          element={
            <Page area="host">
              <NewServicePage />
            </Page>
          }
        />
        <Route
          path="/services/providers"
          element={
            <Page area="host">
              <HostProvidersPage />
            </Page>
          }
        />
        <Route
          path="/services/:id"
          element={
            <Page area="host">
              <ServicePage />
            </Page>
          }
        />
        <Route
          path="/inbox"
          element={
            <Page area="host">
              <InboxPage />
            </Page>
          }
        />
        <Route
          path="/suggestions"
          element={
            <Page area="host">
              <SuggestionsPage />
            </Page>
          }
        />
        <Route
          path="/settings/notifications"
          element={
            <Page area="host">
              <NotificationsPage />
            </Page>
          }
        />
        <Route
          path="/stays/new"
          element={
            <Page area="host">
              <NewStayPage />
            </Page>
          }
        />
        <Route
          path="/stays/proposed/:id"
          element={
            <Page area="host">
              <ConfirmProposalPage />
            </Page>
          }
        />
        <Route
          path="/stays/:id"
          element={
            <Page area="host">
              <StayPage />
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
          path="/admin/curation"
          element={
            <Page area="admin">
              <CurationPage />
            </Page>
          }
        />
        <Route
          path="/admin/feedback"
          element={
            <Page area="admin">
              <FeedbackStatsPage />
            </Page>
          }
        />
        <Route
          path="/admin/curation/staleness"
          element={
            <Page area="admin">
              <StalenessPage />
            </Page>
          }
        />
        <Route
          path="/admin/reconciliation"
          element={
            <Page area="admin">
              <ReconciliationPage />
            </Page>
          }
        />
        <Route
          path="/admin/orders"
          element={
            <Page area="admin">
              <OrderLookupPage />
            </Page>
          }
        />
        <Route
          path="/admin/orders/:id"
          element={
            <Page area="admin">
              <OrderPage />
            </Page>
          }
        />
        <Route
          path="/admin/catalog"
          element={
            <Page area="admin">
              <DestinationsPage />
            </Page>
          }
        />
        <Route
          path="/admin/catalog/destinations/new"
          element={
            <Page area="admin">
              <NewDestinationPage />
            </Page>
          }
        />
        <Route
          path="/admin/catalog/destinations/:id"
          element={
            <Page area="admin">
              <DestinationPage />
            </Page>
          }
        />
        <Route
          path="/admin/catalog/destinations/:id/seeding"
          element={
            <Page area="admin">
              <SeedingPage />
            </Page>
          }
        />
        <Route
          path="/admin/catalog/destinations/:id/new/:kind"
          element={
            <Page area="admin">
              <NewRecordPage />
            </Page>
          }
        />
        <Route
          path="/admin/catalog/records/:id"
          element={
            <Page area="admin">
              <RecordPage />
            </Page>
          }
        />
        <Route
          path="/admin/providers"
          element={
            <Page area="admin">
              <ProvidersPage />
            </Page>
          }
        />
        <Route
          path="/admin/providers/new"
          element={
            <Page area="admin">
              <NewProviderPage />
            </Page>
          }
        />
        <Route
          path="/admin/providers/:id"
          element={
            <Page area="admin">
              <ProviderPage />
            </Page>
          }
        />
        <Route
          path="/admin/providers/:id/offers/new"
          element={
            <Page area="admin">
              <NewOfferPage />
            </Page>
          }
        />
        <Route
          path="/admin/offers/:id"
          element={
            <Page area="admin">
              <OfferPage />
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
