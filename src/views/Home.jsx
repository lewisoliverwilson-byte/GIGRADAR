import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { api } from '../utils/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useFollow } from '../context/FollowContext.jsx';
import ArtistCard from '../components/ArtistCard.jsx';
import GigCard from '../components/GigCard.jsx';
import Footer from '../components/Footer.jsx';
import { artistInitials, artistColor } from '../utils/format.js';

const CITIES = ['London','Manchester','Birmingham','Glasgow','Liverpool','Leeds','Bristol','Edinburgh','Newcastle','Sheffield','Nottingham','Cardiff','Brighton'];

export default function Home() {
  const { user, openAuth } = useAuth();
  const { following } = useFollow();
  const [artists, setArtists] = useState([]);
  const [gigs, setGigs] = useState([]);
  const [trending, setTrending] = useState([]);
  const [emerging, setEmerging] = useState([]);
  const [grassroots, setGrassroots] = useState([]);
  const [onSale, setOnSale] = useState([]);
  const [comingSoon, setComingSoon] = useState([]);
  const [earlyRadar, setEarlyRadar] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [nearbyGigs, setNearbyGigs] = useState([]);
  const [nearbyLoading, setNearbyLoading] = useState(false);
  const [locationDenied, setLocationDenied] = useState(false);
  const router = useRouter();

  useEffect(() => {
    Promise.all([
      api.getArtists(),
      api.getGigs(),
      api.getTrending(),
      api.getEmerging(),
      api.getGrassroots(),
      api.getOnSale().catch(() => []),
      api.getComingSoon().catch(() => []),
      api.getEarlyRadar().catch(() => []),
    ])
      .then(([a, g, t, e, gr, os, cs, er]) => {
        setArtists(a);
        setGigs(g);
        setTrending(t);
        setEmerging(e);
        setGrassroots(gr);
        setOnSale(os);
        setComingSoon(cs);
        setEarlyRadar(er);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const today = new Date().toISOString().split('T')[0];

  function loadNearbyGigs(lat, lng) {
    setNearbyLoading(true);
    api.getNearbyGigs(lat, lng, 15)
      .then(g => setNearbyGigs(Array.isArray(g) ? g.slice(0, 8) : []))
      .catch(() => setNearbyGigs([]))
      .finally(() => setNearbyLoading(false));
  }

  function handleNearMe() {
    if (!navigator.geolocation) { router.push('/gigs'); return; }
    navigator.geolocation.getCurrentPosition(
      pos => {
        sessionStorage.setItem('nearme_coords', JSON.stringify({ lat: pos.coords.latitude, lng: pos.coords.longitude }));
        loadNearbyGigs(pos.coords.latitude, pos.coords.longitude);
      },
      () => setLocationDenied(true)
    );
  }

  function handleNearMeNav() {
    if (!navigator.geolocation) { router.push('/gigs'); return; }
    navigator.geolocation.getCurrentPosition(
      pos => {
        sessionStorage.setItem('nearme_coords', JSON.stringify({ lat: pos.coords.latitude, lng: pos.coords.longitude }));
        router.push('/gigs?nearme=1');
      },
      () => router.push('/gigs')
    );
  }

  const featuredArtists = [...artists]
    .filter(a => a.upcoming > 0)
    .sort((a, b) => (b.upcoming - a.upcoming) || ((a.lastfmRank || 999999) - (b.lastfmRank || 999999)))
    .slice(0, 18);

  const upcomingGigs = gigs.filter(g => g.date >= today).slice(0, 8);
  const followedGigs = gigs.filter(g => following.has(g.artistId) && g.date >= today);

  function handleSearch(e) {
    e.preventDefault();
    if (search.trim()) router.push(`/search?q=${encodeURIComponent(search.trim())}`);
  }

  return (
    <div className="min-h-screen bg-zinc-950">

      {/* Hero */}
      <section className="bg-zinc-950 border-b border-zinc-800">
        <div className="max-w-4xl mx-auto px-6 py-24 text-center">

          <div className="inline-flex items-center gap-2 bg-violet-950 border border-violet-800 rounded-full px-4 py-1.5 text-sm text-violet-300 font-medium mb-8">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse inline-block"></span>
            Updated weekly · 14 ticket sources
          </div>

          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-black tracking-tight leading-tight mb-6">
            <span className="text-white">Every UK gig.</span>
            <br />
            <span className="text-violet-400">One place.</span>
          </h1>

          <p className="text-zinc-400 text-lg max-w-xl mx-auto mb-10 leading-relaxed">
            86,000+ UK gigs from every ticket platform. Follow artists, discover grassroots venues, get alerts the moment new shows drop.
          </p>

          <form onSubmit={handleSearch} className="max-w-lg mx-auto flex gap-2 mb-8">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search artists or venues…"
              className="flex-1 bg-zinc-900 border border-zinc-700 rounded-xl px-5 py-3 text-white placeholder-zinc-500 focus:outline-none focus:border-violet-500 text-base transition-colors"
            />
            <button type="submit" className="bg-violet-600 hover:bg-violet-500 text-white font-semibold px-6 py-3 rounded-xl transition-colors text-base">
              Search
            </button>
          </form>

          <div className="flex gap-3 justify-center flex-wrap">
            <Link href="/gigs" className="bg-violet-600 hover:bg-violet-500 text-white font-semibold px-7 py-3 rounded-xl transition-colors">
              Browse gigs
            </Link>
            <button onClick={handleNearMeNav} className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-emerald-600 text-white font-semibold px-7 py-3 rounded-xl transition-colors flex items-center gap-2">
              📍 Near me
            </button>
            <Link href="/artists" className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-white font-semibold px-7 py-3 rounded-xl transition-colors hidden sm:inline-flex">
              Find artists
            </Link>
            {!user && (
              <button onClick={() => openAuth('signup')} className="text-zinc-400 hover:text-white font-medium px-5 py-3 transition-colors hidden sm:block">
                Sign up free →
              </button>
            )}
          </div>

          <div className="grid grid-cols-3 gap-6 max-w-xs mx-auto mt-14">
            {[['86K+', 'Upcoming gigs'], ['40K+', 'Artists tracked'], ['8K+', 'UK venues']].map(([val, label]) => (
              <div key={label}>
                <p className="text-2xl font-black text-white">{val}</p>
                <p className="text-xs text-zinc-500 mt-0.5">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Browse by city */}
      <section className="border-b border-zinc-800">
        <div className="max-w-5xl mx-auto px-6 py-8">
          <h2 className="text-sm font-bold text-zinc-400 uppercase tracking-widest mb-4">Browse by city</h2>
          <div className="flex flex-wrap gap-2">
            {CITIES.map(city => (
              <Link key={city} href={`/gigs/${city.toLowerCase()}`}
                className="bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 hover:border-violet-600 text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors">
                {city}
              </Link>
            ))}
            <button onClick={handleNearMe}
              className="bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 hover:border-emerald-600 text-emerald-400 text-sm font-medium px-4 py-2 rounded-xl transition-colors flex items-center gap-1.5">
              📍 Near me
            </button>
          </div>
        </div>
      </section>

      {/* Near me results — shown after user clicks "Near me" in city row */}
      {(nearbyLoading || nearbyGigs.length > 0 || locationDenied) && (
        <section className="border-b border-zinc-800">
          <div className="max-w-5xl mx-auto px-6 py-8">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <span className="text-emerald-400">📍</span>
                <h2 className="text-xl font-bold text-white">Gigs near you</h2>
              </div>
              {nearbyGigs.length > 0 && (
                <button onClick={handleNearMeNav} className="text-sm text-violet-400 hover:text-violet-300 transition-colors">
                  See all →
                </button>
              )}
            </div>
            {nearbyLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 bg-zinc-800 rounded-xl animate-pulse" />)}
              </div>
            ) : locationDenied ? (
              <p className="text-zinc-500 text-sm">Location access denied. <button onClick={handleNearMeNav} className="text-violet-400 hover:text-violet-300 underline">Use city search instead →</button></p>
            ) : nearbyGigs.length === 0 ? (
              <p className="text-zinc-500 text-sm">No gigs found within 15 miles. <button onClick={handleNearMeNav} className="text-violet-400 hover:text-violet-300 underline">Try a wider search →</button></p>
            ) : (
              <div className="space-y-2">
                {nearbyGigs.map(g => <GigCard key={g.gigId} gig={g} showArtist />)}
              </div>
            )}
          </div>
        </section>
      )}

      {/* My gigs */}
      {user && following.size > 0 && (
        <section className="max-w-5xl mx-auto px-6 py-12">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-xl font-bold text-white">Your upcoming gigs</h2>
            {followedGigs.length > 8 && (
              <Link href="/gigs?filter=following" className="text-sm text-violet-400 hover:text-violet-300 transition-colors">
                View all {followedGigs.length} →
              </Link>
            )}
          </div>
          {followedGigs.length > 0 ? (
            <div className="space-y-2">
              {followedGigs.slice(0, 8).map(g => <GigCard key={g.gigId} gig={g} showArtist />)}
            </div>
          ) : (
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-10 text-center">
              <p className="text-zinc-400 text-sm">None of your followed artists have announced shows yet.</p>
            </div>
          )}
        </section>
      )}

      {/* Trending artists */}
      <section className="max-w-7xl mx-auto px-6 py-12">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-white">Trending now</h2>
            <p className="text-sm text-zinc-500 mt-1">Most popular UK artists with upcoming shows</p>
          </div>
          <Link href="/artists" className="text-sm text-violet-400 hover:text-violet-300 font-medium transition-colors">
            See all artists →
          </Link>
        </div>
        {loading ? (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="aspect-square rounded-xl bg-zinc-800 animate-pulse" />
            ))}
          </div>
        ) : trending.length > 0 ? (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
            {trending.slice(0, 12).map(a => <ArtistCard key={a.artistId} artist={a} />)}
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
            {featuredArtists.slice(0, 12).map(a => <ArtistCard key={a.artistId} artist={a} />)}
          </div>
        )}
      </section>

      {/* On sale this week */}
      {(loading || onSale.length > 0) && (
        <section className="border-t border-zinc-800">
          <div className="max-w-5xl mx-auto px-6 py-12">
            <div className="flex items-center justify-between mb-6">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
                  <span className="text-xs font-bold text-amber-400 uppercase tracking-widest">On sale now</span>
                </div>
                <h2 className="text-2xl font-bold text-white">Tickets on sale this week</h2>
                <p className="text-sm text-zinc-500 mt-1">Newly released tickets — grab them before they sell out</p>
              </div>
              <Link href="/gigs" className="text-sm text-amber-400 hover:text-amber-300 font-medium transition-colors hidden sm:block">
                Browse all gigs →
              </Link>
            </div>
            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 rounded-xl bg-zinc-800 animate-pulse" />)}
              </div>
            ) : (
              <div className="space-y-2">
                {onSale.slice(0, 8).map(g => <GigCard key={g.gigId} gig={g} showArtist />)}
              </div>
            )}
          </div>
        </section>
      )}

      {/* Recently announced */}
      {(loading || comingSoon.length > 0) && (
        <section className="border-t border-zinc-800">
          <div className="max-w-5xl mx-auto px-6 py-12">
            <div className="flex items-center justify-between mb-6">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="inline-block w-2 h-2 rounded-full bg-sky-400"></span>
                  <span className="text-xs font-bold text-sky-400 uppercase tracking-widest">Just announced</span>
                </div>
                <h2 className="text-2xl font-bold text-white">Recently announced shows</h2>
                <p className="text-sm text-zinc-500 mt-1">New gigs added in the last two weeks</p>
              </div>
              <Link href="/gigs" className="text-sm text-sky-400 hover:text-sky-300 font-medium transition-colors hidden sm:block">
                See all gigs →
              </Link>
            </div>
            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 rounded-xl bg-zinc-800 animate-pulse" />)}
              </div>
            ) : (
              <div className="space-y-2">
                {comingSoon.slice(0, 8).map(g => <GigCard key={g.gigId} gig={g} showArtist />)}
              </div>
            )}
          </div>
        </section>
      )}

      {/* Grassroots picks */}
      <section className="border-t border-zinc-800 bg-zinc-900/30">
        <div className="max-w-5xl mx-auto px-6 py-12">
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="inline-block w-2 h-2 rounded-full bg-emerald-400"></span>
                <span className="text-xs font-bold text-emerald-400 uppercase tracking-widest">Support local venues</span>
              </div>
              <h2 className="text-2xl font-bold text-white">Grassroots gigs this week</h2>
              <p className="text-sm text-zinc-500 mt-1">Small stages, big atmosphere. The heartbeat of UK live music.</p>
            </div>
            <Link href="/gigs?grassroots=true" className="text-sm text-emerald-400 hover:text-emerald-300 font-medium transition-colors hidden sm:block">
              More grassroots gigs →
            </Link>
          </div>

          <div className="mt-6">
            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-20 rounded-xl bg-zinc-800 animate-pulse" />)}
              </div>
            ) : grassroots.length > 0 ? (
              <>
                <div className="space-y-2">
                  {grassroots.slice(0, 8).map(g => (
                    <GigCard key={g.gigId} gig={g} showArtist grassroots />
                  ))}
                </div>
                <div className="mt-6 flex gap-3 flex-wrap">
                  <Link href="/gigs?grassroots=true" className="text-sm text-emerald-400 hover:text-emerald-300 font-medium transition-colors sm:hidden">
                    More grassroots gigs →
                  </Link>
                </div>
              </>
            ) : (
              <p className="text-zinc-500 text-sm">Check back soon for grassroots picks.</p>
            )}
          </div>

          <div className="mt-8 bg-emerald-950/40 border border-emerald-900/50 rounded-2xl p-5">
            <p className="text-sm text-emerald-300 font-medium">🎸 Why grassroots matters</p>
            <p className="text-xs text-zinc-400 mt-1.5 leading-relaxed">
              Grassroots venues are where careers are built and scenes are born. Every ticket sold keeps these spaces open.
              GigRadar highlights every show at these venues so they never go unnoticed.
            </p>
          </div>
        </div>
      </section>

      {/* Early Radar */}
      <section className="border-t border-zinc-800 bg-zinc-900/20">
        <div className="max-w-5xl mx-auto px-6 py-12">
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="inline-block w-2 h-2 rounded-full bg-violet-400 animate-pulse"></span>
                <span className="text-xs font-bold text-violet-400 uppercase tracking-widest">Early Radar</span>
              </div>
              <h2 className="text-2xl font-bold text-white">On the rise — playing grassroots this week</h2>
              <p className="text-sm text-zinc-500 mt-1">Artists with the fastest growing Spotify audiences, still playing small stages.</p>
            </div>
          </div>

          <div className="mt-6">
            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-20 rounded-xl bg-zinc-800 animate-pulse" />)}
              </div>
            ) : earlyRadar.length === 0 ? (
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 text-center">
                <div className="text-3xl mb-3">📡</div>
                <p className="text-white font-semibold mb-1">Building the radar…</p>
                <p className="text-sm text-zinc-500 max-w-sm mx-auto">
                  Early Radar tracks how fast artists are growing on Spotify. We're collecting the first week of data — check back soon.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {earlyRadar.map(artist => {
                  const gig = artist.upcomingGrassrootsGigs?.[0];
                  return (
                    <div key={artist.artistId} className="bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded-2xl p-4 flex items-center gap-4 transition-colors">
                      <Link href={`/artists/${encodeURIComponent(artist.artistId)}`} className="shrink-0">
                        {artist.imageUrl
                          ? <img src={artist.imageUrl} alt={artist.name} className="w-12 h-12 rounded-xl object-cover" />
                          : <div className="w-12 h-12 rounded-xl bg-zinc-800 flex items-center justify-center text-lg font-black text-zinc-500">{artist.name?.[0]}</div>
                        }
                      </Link>
                      <div className="flex-1 min-w-0">
                        <Link href={`/artists/${encodeURIComponent(artist.artistId)}`}
                          className="font-bold text-white hover:text-violet-300 transition-colors block truncate">
                          {artist.name}
                        </Link>
                        {gig && (
                          <p className="text-xs text-zinc-400 truncate mt-0.5">
                            {gig.venueName}{gig.venueCity ? `, ${gig.venueCity}` : ''} · {new Date(gig.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                          </p>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-bold text-violet-400">+{artist.growthRate}%</div>
                        <div className="text-xs text-zinc-500">{(artist.latestListeners || 0).toLocaleString()} listeners</div>
                      </div>
                      {gig?.ticketUrl && (
                        <a href={gig.ticketUrl} target="_blank" rel="noopener noreferrer"
                          className="shrink-0 text-xs bg-violet-600 hover:bg-violet-500 text-white font-semibold px-3 py-1.5 rounded-lg transition-colors">
                          Tickets
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Emerging artists */}
      <section className="max-w-7xl mx-auto px-6 py-12">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-white">Emerging artists</h2>
            <p className="text-sm text-zinc-500 mt-1">Up-and-coming acts with multiple upcoming shows</p>
          </div>
          <Link href="/artists" className="text-sm text-violet-400 hover:text-violet-300 font-medium transition-colors">
            Discover more →
          </Link>
        </div>
        {loading ? (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="aspect-square rounded-xl bg-zinc-800 animate-pulse" />
            ))}
          </div>
        ) : emerging.length > 0 && (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
            {emerging.slice(0, 12).map(a => <ArtistCard key={a.artistId} artist={a} />)}
          </div>
        )}
      </section>

      {/* Upcoming gigs */}
      <section className="border-t border-zinc-800">
        <div className="max-w-5xl mx-auto px-6 py-12">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-white">Upcoming gigs</h2>
            <Link href="/gigs" className="text-sm text-violet-400 hover:text-violet-300 font-medium transition-colors">
              See all gigs →
            </Link>
          </div>

          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-20 rounded-xl bg-zinc-800 animate-pulse" />
              ))}
            </div>
          ) : upcomingGigs.length > 0 ? (
            <>
              <div className="space-y-2">
                {upcomingGigs.map(g => <GigCard key={g.gigId} gig={g} showArtist />)}
              </div>
              <div className="mt-8 text-center">
                <Link href="/gigs" className="inline-block bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-white font-semibold px-8 py-3 rounded-xl transition-colors text-sm">
                  View all upcoming gigs →
                </Link>
              </div>
            </>
          ) : (
            <p className="text-zinc-500 text-sm">No upcoming gigs found.</p>
          )}
        </div>
      </section>

      {/* Feature callouts */}
      <section className="border-t border-zinc-800">
        <div className="max-w-5xl mx-auto px-6 py-12">
          <div className="grid sm:grid-cols-3 gap-4">
            {[
              { icon: '🔔', title: 'Instant gig alerts', desc: 'Get an email the moment a new show is announced for any artist or venue you follow. Never miss ticket day again.', cta: 'Browse artists', href: '/artists' },
              { icon: '📍', title: 'Gigs near me', desc: 'Find every live show within 15 miles of your location across all ticket platforms, including grassroots venues.', cta: 'Find local gigs', href: '/gigs' },
              { icon: '🎵', title: 'Spotify import', desc: 'Connect Spotify to auto-follow your top listened artists and see all their upcoming UK shows in one place.', cta: 'Connect Spotify', href: '/onboarding/connect' },
            ].map(({ icon, title, desc, cta, href }) => (
              <div key={title} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 hover:border-zinc-600 transition-colors">
                <div className="text-3xl mb-4">{icon}</div>
                <h3 className="text-base font-bold text-white mb-2">{title}</h3>
                <p className="text-sm text-zinc-400 leading-relaxed mb-5">{desc}</p>
                <Link href={href} className="text-sm text-violet-400 hover:text-violet-300 font-semibold transition-colors">
                  {cta} →
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
