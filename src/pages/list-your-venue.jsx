import React from 'react';
import Link from 'next/link';
import Head from 'next/head';
import Footer from '../components/Footer.jsx';

const STRIPE_PAYMENT_LINK = 'https://buy.stripe.com/7sY7sDdFecFJ2uubU26Na01';

const BENEFITS = [
  { icon: '★', title: 'Spotlight badge', desc: 'Pinned at the top of your city page above all other venues.' },
  { icon: '📈', title: 'Weekly stats email', desc: 'Every Friday: your follower count, upcoming gig count, and growth.' },
  { icon: '🔔', title: 'Priority in alerts', desc: 'Your shows surface first when followers get their weekly digest.' },
];

export default function ListYourVenue() {
  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col">
      <Head>
        <title>List Your Venue — GigRadar Spotlight</title>
        <meta name="description" content="Get your grassroots venue featured on GigRadar. Spotlight badge, weekly stats, and priority in gig alerts. £49/month." />
      </Head>

      <div className="flex-1 max-w-2xl mx-auto px-6 py-16 w-full">
        <div className="mb-2">
          <Link href="/cities" className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">← Browse venues</Link>
        </div>

        <div className="mb-8">
          <div className="inline-flex items-center gap-1.5 bg-amber-900 text-amber-300 text-xs font-bold px-3 py-1 rounded-full border border-amber-700 mb-4">
            ★ Venue Spotlight
          </div>
          <h1 className="text-4xl font-black text-white mb-3 leading-tight">
            Get your venue seen by the people who care.
          </h1>
          <p className="text-zinc-400 text-lg leading-relaxed">
            GigRadar tracks grassroots music across the UK. Thousands of fans follow venues to get notified the moment new shows go on sale. A Spotlight badge puts yours at the top.
          </p>
        </div>

        <div className="space-y-4 mb-10">
          {BENEFITS.map(b => (
            <div key={b.title} className="flex gap-4 items-start bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
              <div className="text-2xl flex-shrink-0 w-8 text-center">{b.icon}</div>
              <div>
                <div className="font-bold text-white mb-0.5">{b.title}</div>
                <div className="text-sm text-zinc-400">{b.desc}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 mb-6">
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-4xl font-black text-white">£49</span>
            <span className="text-zinc-400">/month</span>
          </div>
          <p className="text-sm text-zinc-400 mb-5">Cancel anytime. We activate your badge within 24 hours of payment.</p>
          <a href={STRIPE_PAYMENT_LINK}
            className="block w-full bg-violet-600 hover:bg-violet-500 text-white text-center font-bold py-3 px-6 rounded-xl transition-colors text-lg">
            Get Spotlight →
          </a>
          <p className="text-xs text-zinc-500 mt-3 text-center">
            After payment, we'll email you to confirm your venue and activate the badge.
          </p>
        </div>

        <p className="text-xs text-zinc-600 text-center">
          Questions? Email <a href="mailto:hello@gigradar.co.uk" className="text-zinc-400 hover:text-white">hello@gigradar.co.uk</a>
        </p>
      </div>

      <Footer />
    </div>
  );
}
