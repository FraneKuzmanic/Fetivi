import { Navigate, Route, Routes } from 'react-router';
import { AccessPage } from './access/AccessPage';
import { NoLinkPage } from './access/NoLinkPage';
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
