import { AuthProvider } from '../context/AuthContext.jsx';
import { FollowProvider } from '../context/FollowContext.jsx';
import Navbar from '../components/Navbar.jsx';
import AuthModal from '../components/AuthModal.jsx';
import '../index.css';

const FULLSCREEN_ROUTES = ['/onboarding/connect', '/onboarding/artists', '/auth/spotify/callback'];

export default function App({ Component, pageProps, router }) {
  const isFullscreen = FULLSCREEN_ROUTES.some(r => router.pathname.startsWith(r));

  return (
    <AuthProvider>
      <FollowProvider>
        <div className="min-h-screen flex flex-col">
          {!isFullscreen && <Navbar />}
          <main className="flex-1">
            <Component {...pageProps} />
          </main>
          {!isFullscreen && <AuthModal />}
        </div>
      </FollowProvider>
    </AuthProvider>
  );
}
