import React, { useState } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '../context/AuthContext.jsx';
import { signUp, confirmSignUp, resendCode, signIn } from '../utils/cognito.js';

export default function AuthModal() {
  const router = useRouter();
  const { showAuth, setShowAuth, authTab, setAuthTab, refresh } = useAuth();
  const [step, setStep]         = useState('form'); // 'form' | 'verify'
  const [pendingEmail, setPending] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  // form fields
  const [name, setName]         = useState('');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode]         = useState('');

  if (!showAuth) return null;

  function reset() {
    setStep('form'); setError(''); setLoading(false);
    setName(''); setEmail(''); setPassword(''); setCode('');
  }

  function close() { reset(); setShowAuth(false); }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      if (authTab === 'signup') {
        await signUp(email, password, name || email.split('@')[0]);
        setPending(email);
        setStep('verify');
      } else {
        await signIn(email, password);
        await refresh();
        close();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify(e) {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      await confirmSignUp(pendingEmail, code);
      await signIn(pendingEmail, password);
      await refresh();
      close();
      router.push('/onboarding/connect');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    setError('');
    try { await resendCode(pendingEmail); }
    catch (err) { setError(err.message); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={close}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div
        className="relative bg-surface-1 border border-white/10 rounded-2xl w-full max-w-sm p-6 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Close */}
        <button onClick={close} className="absolute right-4 top-4 text-gray-500 hover:text-white transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {step === 'verify' ? (
          <>
            <div className="text-4xl mb-3 text-center">✉️</div>
            <h2 className="text-xl font-bold text-center mb-1">Check your inbox</h2>
            <p className="text-gray-400 text-sm text-center mb-5">
              We sent a 6-digit code to <span className="text-white">{pendingEmail}</span>
            </p>
            <form onSubmit={handleVerify} className="space-y-3">
              <input
                className="input text-center text-2xl tracking-widest font-mono"
                maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="000000" required autoFocus
              />
              {error && <p className="text-red-400 text-sm text-center">{error}</p>}
              <button type="submit" disabled={loading || code.length !== 6} className="btn-primary w-full">
                {loading ? 'Verifying…' : 'Verify & sign in'}
              </button>
            </form>
            <p className="text-gray-500 text-xs text-center mt-4">
              Didn't get it?{' '}
              <button onClick={handleResend} className="text-brand hover:underline">Resend code</button>
            </p>
          </>
        ) : (
          <>
            {/* Tabs */}
            <div className="flex bg-surface-3 rounded-lg p-1 mb-5">
              {['login', 'signup'].map(t => (
                <button key={t}
                  onClick={() => { setAuthTab(t); setError(''); }}
                  className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors ${authTab === t ? 'bg-surface-1 text-white shadow' : 'text-gray-400 hover:text-white'}`}>
                  {t === 'login' ? 'Log in' : 'Sign up'}
                </button>
              ))}
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              {authTab === 'signup' && (
                <input className="input" type="text" placeholder="Your name" value={name}
                  onChange={e => setName(e.target.value)} autoFocus />
              )}
              <input className="input" type="email" placeholder="Email address" value={email}
                onChange={e => setEmail(e.target.value)} required autoFocus={authTab === 'login'} />
              <input className="input" type="password" placeholder="Password" value={password}
                onChange={e => setPassword(e.target.value)} required minLength={8} />
              {error && <p className="text-red-400 text-sm">{error}</p>}
              <button type="submit" disabled={loading} className="btn-primary w-full">
                {loading ? '…' : authTab === 'login' ? 'Log in' : 'Create account'}
              </button>
            </form>

            <p className="text-gray-500 text-xs text-center mt-4">
              {authTab === 'login' ? "Don't have an account? " : 'Already have an account? '}
              <button
                onClick={() => { setAuthTab(authTab === 'login' ? 'signup' : 'login'); setError(''); }}
                className="text-brand hover:underline">
                {authTab === 'login' ? 'Sign up free' : 'Log in'}
              </button>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
