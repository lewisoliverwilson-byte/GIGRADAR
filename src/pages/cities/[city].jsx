import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Head from 'next/head';
import { api } from '../../utils/api.js';
import Footer from '../../components/Footer.jsx';

const CITY_META = {
  london:     { name: 'London',     emoji: '🏙️' },
  manchester: { name: 'Manchester', emoji: '🐝' },
  glasgow:    { name: 'Glasgow',    emoji: '🏴󠁧󠁢󠁳󠁣󠁴󠁿' },
  bristol:    { name: 'Bristol',    emoji: '🎨' },
  birmingham: { name: 'Birmingham', emoji: '🎺' },
  leeds:      { name: 'Leeds',      emoji: '🎸' },
  edinburgh:  { name: 'Edinburgh',  emoji: '🏰' },
  liverpool:  { name: 'Liverpool',  emoji: '🎵' },
  brighton:   { name: 'Brighton',   emoji: '🌊' },
  newcastle:  { name: 'Newcastle',  emoji: '🦁' },
};

function VenueCard({ venue }) {
  return (
    <Link href={`/venues/${venue.slug}`}
      className="group bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 rounded-2xl p-5 transition-colors flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            {venue.isSpotlight && (
              <span className="inline-flex items-center gap-1 bg-amber-900 text-amber-300 text-xs font-bold px-2 py-0.5 rounded-full border border-amber-700">
                ★ Spotlight
              </span>
            )}
            {venue.isGrassroots && (
              <span className="inline-flex items-center gap-1 bg-emerald-950 text-emerald-400 text-xs font-semibold px-2 py-0.5 rounded-full border border-emerald-800">
                Grassroots
              </span>
            )}
          </div>
          <h2 className="font-bold text-white text-lg group-hover:text-violet-300 transition-colors leading-tight">{venue.name}</h2>
          {venue.capacity && (
            <p className="text-xs text-zinc-500 mt-0.5">Cap. {venue.capacity.toLocaleString()}</p>
          )}
        </div>
        {venue.followerCount > 0 && (
          <div className="text-right flex-shrink-0">
            <div className="text-sm font-bold text-violet-400">{venue.followerCount.toLocaleString()}</div>
            <div className="text-xs text-zinc-500">followers</div>
          </div>
        )}
      </div>
      {venue.upcoming > 0 && (
        <div className="text-xs text-zinc-400">
          <span className="text-violet-400 font-semibold">{venue.upcoming}</span> upcoming {venue.upcoming === 1 ? 'gig' : 'gigs'}
        </div>
      )}
      {venue.genres?.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {venue.genres.slice(0, 3).map(g => (
            <span key={g} className="bg-zinc-800 text-zinc-400 text-xs px-1.5 py-0.5 rounded capitalize">{g}</span>
          ))}
        </div>
      )}
    </Link>
  );
}

export default function CityPage() {
  const { query: { city } } = useRouter();
  const meta = CITY_META[city];
  const [venues, setVenues] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!city) return;
    setLoading(true);
    api.getVenuesFiltered({ city: meta?.name || city, grassroots: 'true' })
      .then(v => {
        // Spotlight venues first, then sort by followerCount desc, then upcoming desc
        const sorted = [...v].sort((a, b) => {
          if (a.isSpotlight && !b.isSpotlight) return -1;
          if (!a.isSpotlight && b.isSpotlight) return 1;
          return (b.followerCount || 0) - (a.followerCount || 0) || (b.upcoming || 0) - (a.upcoming || 0);
        });
        setVenues(sorted);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [city]);

  if (!meta) return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
      <div className="text-center">
        <p className="text-zinc-400 mb-4">City not found.</p>
        <Link href="/cities" className="text-violet-400 hover:text-violet-300">← All cities</Link>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col">
      <Head>
        <title>Grassroots Venues in {meta.name} — GigRadar</title>
        <meta name="description" content={`Discover grassroots music venues in ${meta.name}. Follow your favourites and get alerts when new gigs are announced.`} />
      </Head>

      <div className="flex-1 max-w-4xl mx-auto px-6 py-12 w-full">
        <div className="mb-3">
          <Link href="/cities" className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">← All cities</Link>
        </div>
        <div className="flex items-center gap-3 mb-2">
          <span className="text-3xl">{meta.emoji}</span>
          <h1 className="text-3xl font-black text-white">{meta.name}</h1>
        </div>
        <p className="text-zinc-400 mb-8">
          {loading ? 'Loading venues…' : `${venues.length} grassroots venue${venues.length !== 1 ? 's' : ''}`}
        </p>

        {venues.length > 0 && (
          <div className="mb-8 p-4 bg-zinc-900 border border-zinc-800 rounded-2xl text-sm text-zinc-400">
            Want your venue featured at the top?{' '}
            <Link href="/list-your-venue" className="text-violet-400 hover:text-violet-300 font-semibold">
              Get a Spotlight badge →
            </Link>
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 animate-pulse h-28" />
            ))}
          </div>
        ) : venues.length === 0 ? (
          <p className="text-zinc-500">No grassroots venues found for {meta.name} yet.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {venues.map(v => <VenueCard key={v.venueId} venue={v} />)}
          </div>
        )}
      </div>

      <Footer />
    </div>
  );
}
