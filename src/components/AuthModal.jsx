import React, { useState } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '../context/AuthContext.jsx';
import { signUp, confirmSignUp, resendCode, signIn } from '../utils/cognito.js';

const inputCls = 'w-full bg-zinc-800 border border-zinc-700 text-white rounded-xl px-4 py-2.5 focus:outline-none focus:border-violet-500 placeholder-zinc-500 text-sm transition-colors';

export default function AuthModal() {
  const router = useRouter();
  const { showAuth, setShowAuth, authTab, setAuthTab, refresh } = useAuth();
  const [step, setStep] = useState('form');
  const [pendingEmail, setPending] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');

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
      <div className="relative bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-sm p-6 shadow-2xl"
        onClick={e => e.stopPropagation()}>

        <button onClick={close} className="absolute right-4 top-4 text-zinc-500 hover:text-white transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {step === 'verify' ? (
          <>
            <div className="text-4xl mb-3 text-center">✉️</div>
            <h2 className="text-xl font-bold text-white text-center mb-1">Check your inbox</h2>
            <p className="text-zinc-400 text-sm text-center mb-5">
              We sent a 6-digit code to <span className="text-white">{pendingEmail}</span>
            </p>
            <form onSubmit={handleVerify} className="space-y-3">
              <input
                className={`${inputCls} text-center text-2xl tracking-widest font-mono`}
                maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="000000" required autoFocus
              />
              {error && <p className="text-red-400 text-sm text-center">{error}</p>}
              <button type="submit" disabled={loading || code.length !== 6}
                className="w-full bg-violet-600 hover:bg-violet-500 text-white font-semibold py-2.5 rounded-xl transition-colors disabled:opacity-50">
                {loading ? 'Verifying…' : 'Verify & sign in'}
              </button>
            </form>
            <p className="text-zinc-500 text-xs text-center mt-4">
              Didn't get it?{' '}
              <button onClick={handleResend} className="text-violet-400 hover:underline">Resend code</button>
            </p>
          </>
        ) : (
          <>
            <div className="flex bg-zinc-800 rounded-xl p-1 mb-5">
              {['login', 'signup'].map(t => (
                <button key={t} onClick={() => { setAuthTab(t); setError(''); }}
                  className={`flex-1 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    authTab === t ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'
                  }`}>
                  {t === 'login' ? 'Log in' : 'Sign up'}
                </button>
              ))}
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              {authTab === 'signup' && (
                <input className={inputCls} type="text" placeholder="Your name" value={name}
                  onChange={e => setName(e.target.value)} autoFocus />
              )}
              <input className={inputCls} type="email" placeholder="Email address" value={email}
                onChange={e => setEmail(e.target.value)} required autoFocus={authTab === 'login'} />
              <input className={inputCls} type="password" placeholder="Password" value={password}
                onChange={e => setPassword(e.target.value)} required minLength={8} />
              {error && <p className="text-red-400 text-sm">{error}</p>}
              <button type="submit" disabled={loading}
                className="w-full bg-violet-600 hover:bg-violet-500 text-white font-semibold py-2.5 rounded-xl transition-colors disabled:opacity-50">
                {loading ? '…' : authTab === 'login' ? 'Log in' : 'Create account'}
              </button>
            </form>

            <p className="text-zinc-500 text-xs text-center mt-4">
              {authTab === 'login' ? "Don't have an account? " : 'Already have an account? '}
              <button onClick={() => { setAuthTab(authTab === 'login' ? 'signup' : 'login'); setError(''); }}
                className="text-violet-400 hover:underline">
                {authTab === 'login' ? 'Sign up free' : 'Log in'}
              </button>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
