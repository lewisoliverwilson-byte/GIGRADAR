import React from 'react';
import Link from 'next/link';
import Head from 'next/head';
import Footer from '../../components/Footer.jsx';

const CITIES = [
  { name: 'London',     slug: 'london',     emoji: '🏙️' },
  { name: 'Manchester', slug: 'manchester',  emoji: '🐝' },
  { name: 'Glasgow',    slug: 'glasgow',     emoji: '🏴󠁧󠁢󠁳󠁣󠁴󠁿' },
  { name: 'Bristol',    slug: 'bristol',     emoji: '🎨' },
  { name: 'Birmingham', slug: 'birmingham',  emoji: '🎺' },
  { name: 'Leeds',      slug: 'leeds',       emoji: '🎸' },
  { name: 'Edinburgh',  slug: 'edinburgh',   emoji: '🏰' },
  { name: 'Liverpool',  slug: 'liverpool',   emoji: '🎵' },
  { name: 'Brighton',   slug: 'brighton',    emoji: '🌊' },
  { name: 'Newcastle',  slug: 'newcastle',   emoji: '🦁' },
];

export default function CitiesIndex() {
  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col">
      <Head>
        <title>Grassroots Venues by City — GigRadar</title>
        <meta name="description" content="Find grassroots music venues in UK cities. Follow venues and get alerts when new gigs are announced." />
      </Head>

      <div className="flex-1 max-w-4xl mx-auto px-6 py-12 w-full">
        <div className="mb-10">
          <h1 className="text-3xl font-black text-white mb-2">Browse by City</h1>
          <p className="text-zinc-400">Grassroots venues, sorted by who's following them.</p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {CITIES.map(city => (
            <Link key={city.slug} href={`/cities/${city.slug}`}
              className="group bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 rounded-2xl p-5 transition-colors">
              <div className="text-2xl mb-2">{city.emoji}</div>
              <div className="font-bold text-white text-lg group-hover:text-violet-300 transition-colors">{city.name}</div>
              <div className="text-xs text-zinc-500 mt-0.5">Grassroots venues →</div>
            </Link>
          ))}
        </div>
      </div>

      <Footer />
    </div>
  );
}
