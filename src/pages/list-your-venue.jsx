import React from 'react';
import Link from 'next/link';
import Head from 'next/head';
import Footer from '../components/Footer.jsx';

const SPOTLIGHT_LINK = 'https://buy.stripe.com/7sY7sDdFecFJ2uubU26Na01';
const PRO_LINK       = 'https://buy.stripe.com/7sYdR18kUgVZ5GGbU26Na02';

const SPOTLIGHT_BENEFITS = [
  { icon: '✦', title: 'Spotlight badge', desc: 'Pinned at the top of your city page above all other venues.' },
  { icon: '📈', title: 'Weekly stats email', desc: 'Every Friday: your follower count, upcoming gig count, and growth.' },
  { icon: '🔔', title: 'Priority in alerts', desc: 'Your shows surface first when followers get their weekly digest.' },
  { icon: '✏️', title: 'Edit your profile', desc: 'Update bio, photos, website, socials, and booking contact.' },
];

const PRO_BENEFITS = [
  { icon: '⭐', title: 'Venue Pro badge', desc: 'Gold Pro badge — the top tier on GigRadar.' },
  { icon: '📊', title: 'Analytics dashboard', desc: 'See page views, follower count, and upcoming gig stats in real time.' },
  { icon: '📢', title: 'Announcement banner', desc: 'Pin a message to your venue page — new booking form, residency, special offer.' },
  { icon: '🏠', title: 'Featured on homepage', desc: 'Your venue shows up in the Featured Venues section seen by every visitor.' },
  { icon: '📈', title: 'Weekly stats email', desc: 'Every Friday: page views, followers, upcoming gigs, and growth.' },
  { icon: '🔔', title: 'Priority in alerts', desc: 'Your shows surface first when followers get their weekly digest.' },
  { icon: '✏️', title: 'Full profile editing', desc: 'Bio, photos, website, socials, booking contact, and announcement.' },
];

export default function ListYourVenue() {
  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col">
      <Head>
        <title>List Your Venue — GigRadar</title>
        <meta name="description" content="Get your grassroots venue featured on GigRadar. Analytics, Spotlight badge, announcements, and priority in gig alerts. From £49/month." />
      </Head>

      <div className="flex-1 max-w-4xl mx-auto px-6 py-16 w-full">
        <div className="mb-2">
          <Link href="/cities" className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">← Browse venues</Link>
        </div>

        <div className="mb-10 text-center">
          <h1 className="text-4xl sm:text-5xl font-black text-white mb-3 leading-tight">
            Get your venue seen.
          </h1>
          <p className="text-zinc-400 text-lg leading-relaxed max-w-xl mx-auto">
            GigRadar tracks grassroots music across the UK. Thousands of fans follow venues to get notified the moment new shows go on sale.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-6 mb-12">

          {/* Spotlight */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-7 flex flex-col">
            <div className="inline-flex items-center gap-1.5 bg-indigo-950 text-indigo-300 text-xs font-bold px-3 py-1 rounded-full border border-indigo-700 mb-4 self-start">
              ✦ Spotlight
            </div>
            <div className="flex items-baseline gap-2 mb-1">
              <span className="text-4xl font-black text-white">£49</span>
              <span className="text-zinc-400">/month</span>
            </div>
            <p className="text-sm text-zinc-500 mb-6">Cancel anytime. Badge live within 24 hours.</p>

            <ul className="space-y-3 mb-8 flex-1">
              {SPOTLIGHT_BENEFITS.map(b => (
                <li key={b.title} className="flex items-start gap-3">
                  <span className="text-lg w-6 flex-shrink-0">{b.icon}</span>
                  <div>
                    <div className="text-sm font-semibold text-white">{b.title}</div>
                    <div className="text-xs text-zinc-500">{b.desc}</div>
                  </div>
                </li>
              ))}
            </ul>

            <a href={SPOTLIGHT_LINK}
              className="block w-full bg-indigo-700 hover:bg-indigo-600 text-white text-center font-bold py-3 px-6 rounded-xl transition-colors">
              Get Spotlight →
            </a>
          </div>

          {/* Venue Pro */}
          <div className="bg-zinc-900 border border-amber-800/60 rounded-2xl p-7 flex flex-col relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-amber-600 to-orange-500" />
            <div className="inline-flex items-center gap-1.5 bg-gradient-to-r from-amber-900 to-orange-900 text-amber-300 text-xs font-bold px-3 py-1 rounded-full border border-amber-700 mb-4 self-start">
              ⭐ Venue Pro
            </div>
            <div className="flex items-baseline gap-2 mb-1">
              <span className="text-4xl font-black text-white">£149</span>
              <span className="text-zinc-400">/month</span>
            </div>
            <p className="text-sm text-zinc-500 mb-6">Cancel anytime. Everything in Spotlight, plus:</p>

            <ul className="space-y-3 mb-8 flex-1">
              {PRO_BENEFITS.map(b => (
                <li key={b.title} className="flex items-start gap-3">
                  <span className="text-lg w-6 flex-shrink-0">{b.icon}</span>
                  <div>
                    <div className="text-sm font-semibold text-white">{b.title}</div>
                    <div className="text-xs text-zinc-500">{b.desc}</div>
                  </div>
                </li>
              ))}
            </ul>

            <a href={PRO_LINK}
              className="block w-full bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white text-center font-bold py-3 px-6 rounded-xl transition-all">
              Get Venue Pro →
            </a>
          </div>
        </div>

        <p className="text-xs text-zinc-600 text-center">
          Questions? Email <a href="mailto:hello@gigradar.co.uk" className="text-zinc-400 hover:text-white">hello@gigradar.co.uk</a>
        </p>
      </div>

      <Footer />
    </div>
  );
}
