import { Navigate, Route, Routes } from 'react-router';
import { AboutMePage } from './about-me/AboutMePage';
import { AccessPage } from './access/AccessPage';
import { NoLinkPage } from './access/NoLinkPage';
import { GuideSection } from './guide/GuideSection';
import { RecoverPage } from './recovery/RecoverPage';
import { VerifyEmailPage } from './recovery/VerifyEmailPage';
import { SettingsPage } from './settings/SettingsPage';
import { TAB_NAMES } from './shell/EmptyTab';
import { RequireSpace } from './shell/RequireSpace';
import { Shell } from './shell/Shell';
import { SpaceProvider, type SpaceState } from './space';

/** The router is supplied by the caller (BrowserRouter in main, MemoryRouter in tests). */
export function App({ initial }: { initial?: SpaceState }) {
  return (
    <SpaceProvider initial={initial}>
      <Routes>
        <Route path="/u/:slug" element={<AccessPage />} />
        {/* Emailed links: they work on any device, with or without a space. */}
        <Route path="/recover" element={<RecoverPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        {TAB_NAMES.map((tab) => (
          <Route
            key={tab}
            path={`/${tab}`}
            element={
              <RequireSpace>
                <Shell tab={tab} />
              </RequireSpace>
            }
          />
        ))}
        <Route
          path="/guide/:section"
          element={
            <RequireSpace>
              <Shell tab="guide">
                <GuideSection />
              </Shell>
            </RequireSpace>
          }
        />
        <Route
          path="/about-me"
          element={
            <RequireSpace>
              <Shell>
                <AboutMePage />
              </Shell>
            </RequireSpace>
          }
        />
        <Route
          path="/settings"
          element={
            <RequireSpace>
              <Shell>
                <SettingsPage />
              </Shell>
            </RequireSpace>
          }
        />
        <Route
          path="/"
          element={
            <RequireSpace>
              <Navigate to="/chat" replace />
            </RequireSpace>
          }
        />
        <Route path="*" element={<NoLinkPage />} />
      </Routes>
    </SpaceProvider>
  );
}
