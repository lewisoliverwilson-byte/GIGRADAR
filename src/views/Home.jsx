import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { api } from '../utils/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useFollow } from '../context/FollowContext.jsx';
import ArtistCard from '../components/ArtistCard.jsx';
import GigCard from '../components/GigCard.jsx';
import Footer from '../components/Footer.jsx';

const CITIES = ['London','Manchester','Birmingham','Glasgow','Liverpool','Leeds','Bristol','Edinburgh','Newcastle','Sheffield','Nottingham','Cardiff','Brighton'];

function SectionHeader({ title, subtitle, label, labelColor = 'text-zinc-500', href, linkText }) {
  return (
    <div className="flex items-end justify-between mb-6 border-b border-zinc-900 pb-4">
      <div>
        {label && <p className={`text-[10px] font-black uppercase tracking-widest mb-1 ${labelColor}`}>{label}</p>}
        <h2 className="font-display text-4xl text-white">{title}</h2>
        {subtitle && <p className="text-xs font-bold uppercase tracking-wider text-zinc-600 mt-1">{subtitle}</p>}
      </div>
      {href && (
        <Link href={href} className="text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:text-white transition-colors shrink-0 mb-1">
          {linkText || 'See all'} →
        </Link>
      )}
    </div>
  );
}

export default function Home() {
  const { user, openAuth } = useAuth();
  const { following } = useFollow();
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
  const [featuredVenues, setFeaturedVenues] = useState([]);
  const router = useRouter();

  useEffect(() => {
    Promise.all([api.getGigs(), api.getTrending()])
      .then(([g, t]) => { setGigs(g); setTrending(t); })
      .catch(() => {})
      .finally(() => setLoading(false));

    Promise.all([
      api.getEmerging().catch(() => []),
      api.getGrassroots().catch(() => []),
      api.getOnSale().catch(() => []),
      api.getComingSoon().catch(() => []),
      api.getEarlyRadar().catch(() => []),
      api.getVenuesFeatured().catch(() => []),
    ]).then(([e, gr, os, cs, er, vs]) => {
      setEmerging(e);
      setGrassroots(gr);
      setOnSale(os);
      setComingSoon(cs);
      setEarlyRadar(er);
      setFeaturedVenues((Array.isArray(vs) ? vs : []).slice(0, 8));
    }).catch(() => {});
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

  const upcomingGigs = gigs.filter(g => g.date >= today).slice(0, 8);
  const followedGigs = gigs.filter(g => following.has(g.artistId) && g.date >= today);

  function handleSearch(e) {
    e.preventDefault();
    if (search.trim()) router.push(`/search?q=${encodeURIComponent(search.trim())}`);
  }

  // Marquee: duplicate for seamless loop
  const marqueeNames = trending.length > 0
    ? [...trending.map(a => a.name), ...trending.map(a => a.name)]
    : [];

  return (
    <div className="min-h-screen bg-black">

      {/* Hero */}
      <section className="bg-black border-b border-zinc-900">

        {/* Artist name ticker */}
        {marqueeNames.length > 0 && (
          <div className="border-b border-zinc-900 overflow-hidden py-2.5">
            <div className="flex animate-marquee whitespace-nowrap">
              {marqueeNames.map((name, i) => (
                <span key={i} className="font-display text-sm text-zinc-700 px-6 tracking-widest shrink-0">
                  {name}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="max-w-7xl mx-auto px-6 py-16 lg:py-24">
          <div className="max-w-4xl">

            <h1 className="font-display text-[13vw] lg:text-[9rem] leading-none text-white mb-0">
              EVERY UK GIG.
            </h1>
            <h1 className="font-display text-[13vw] lg:text-[9rem] leading-none text-zinc-600 mb-10">
              ONE PLACE.
            </h1>

            <p className="text-sm font-bold uppercase tracking-widest text-zinc-500 mb-10 max-w-lg">
              86,000+ gigs from every ticket platform. Follow artists, get alerts the moment new shows drop.
            </p>

            <div className="flex flex-wrap gap-3 items-center mb-6">
              {!user ? (
                <button onClick={() => openAuth('signup')}
                  className="bg-white text-black font-black text-sm uppercase tracking-widest px-8 py-4 hover:bg-zinc-100 transition-colors">
                  CREATE ACCOUNT
                </button>
              ) : null}
              <Link href="/gigs"
                className="border border-zinc-700 text-white font-black text-sm uppercase tracking-widest px-8 py-4 hover:bg-white hover:text-black hover:border-white transition-colors">
                BROWSE GIGS
              </Link>
              <button onClick={handleNearMeNav}
                className="border border-zinc-800 text-zinc-400 font-black text-sm uppercase tracking-widest px-8 py-4 hover:border-white hover:text-white transition-colors flex items-center gap-2">
                NEAR ME
              </button>
            </div>

            <form onSubmit={handleSearch} className="flex max-w-md">
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search artists or venues..."
                className="flex-1 bg-zinc-950 border border-zinc-800 border-r-0 px-4 py-3 text-white placeholder-zinc-700 focus:outline-none focus:border-zinc-600 text-sm font-medium transition-colors"
              />
              <button type="submit" className="border border-zinc-800 bg-zinc-900 hover:bg-white hover:text-black px-5 py-3 text-white text-sm font-black transition-colors">
                →
              </button>
            </form>

          </div>

          {/* Stats strip */}
          <div className="flex gap-12 mt-16 border-t border-zinc-900 pt-8">
            {[['86K+', 'Upcoming gigs'], ['40K+', 'Artists tracked'], ['8K+', 'UK venues'], ['14', 'Ticket sources']].map(([val, label]) => (
              <div key={label}>
                <p className="font-display text-4xl text-white">{val}</p>
                <p className="text-[10px] font-black uppercase tracking-widest text-zinc-600 mt-0.5">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Browse by city */}
      <section className="border-b border-zinc-900">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <p className="text-[10px] font-black uppercase tracking-widest text-zinc-600 mb-4">Browse by city</p>
          <div className="flex flex-wrap gap-2">
            {CITIES.map(city => (
              <Link key={city} href={`/gigs/${city.toLowerCase()}`}
                className="border border-zinc-800 text-zinc-400 text-[10px] font-black uppercase tracking-widest px-4 py-2 hover:border-white hover:text-white transition-colors">
                {city}
              </Link>
            ))}
            <button onClick={handleNearMe}
              className="border border-zinc-800 text-zinc-500 text-[10px] font-black uppercase tracking-widest px-4 py-2 hover:border-white hover:text-white transition-colors">
              Near me
            </button>
          </div>
        </div>
      </section>

      {/* Near me results */}
      {(nearbyLoading || nearbyGigs.length > 0 || locationDenied) && (
        <section className="border-b border-zinc-900">
          <div className="max-w-7xl mx-auto px-6 py-10">
            <SectionHeader title="GIGS NEAR YOU" href="/gigs" linkText="See all" />
            {nearbyLoading ? (
              <div className="space-y-px">
                {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-16 bg-zinc-950 animate-pulse" />)}
              </div>
            ) : locationDenied ? (
              <p className="text-xs font-bold uppercase tracking-wider text-zinc-600">Location access denied. <button onClick={handleNearMeNav} className="text-white underline">Use city search →</button></p>
            ) : nearbyGigs.length === 0 ? (
              <p className="text-xs font-bold uppercase tracking-wider text-zinc-600">No gigs found within 15 miles.</p>
            ) : (
              <div>{nearbyGigs.map(g => <GigCard key={g.gigId} gig={g} showArtist />)}</div>
            )}
          </div>
        </section>
      )}

      {/* My gigs */}
      {user && following.size > 0 && (
        <section className="border-b border-zinc-900">
          <div className="max-w-7xl mx-auto px-6 py-10">
            <SectionHeader title="YOUR UPCOMING GIGS"
              href={followedGigs.length > 8 ? '/gigs?filter=following' : undefined}
              linkText={`View all ${followedGigs.length}`} />
            {followedGigs.length > 0 ? (
              <div>{followedGigs.slice(0, 8).map(g => <GigCard key={g.gigId} gig={g} showArtist />)}</div>
            ) : (
              <p className="text-xs font-bold uppercase tracking-wider text-zinc-700">None of your followed artists have announced shows yet.</p>
            )}
          </div>
        </section>
      )}

      {/* Trending artists */}
      <section className="border-b border-zinc-900">
        <div className="max-w-7xl mx-auto px-6 py-10">
          <SectionHeader title="TRENDING NOW" subtitle="Most popular UK artists with upcoming shows" href="/artists" linkText="All artists" />
          {loading ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-px bg-zinc-900">
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="aspect-square bg-zinc-950 animate-pulse" />
              ))}
            </div>
          ) : trending.length > 0 ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-px bg-zinc-900">
              {trending.slice(0, 12).map(a => <ArtistCard key={a.artistId} artist={a} />)}
            </div>
          ) : null}
        </div>
      </section>

      {/* On sale this week */}
      {(loading || onSale.length > 0) && (
        <section className="border-b border-zinc-900">
          <div className="max-w-7xl mx-auto px-6 py-10">
            <SectionHeader title="ON SALE NOW" label="Tickets just dropped" labelColor="text-amber-500" subtitle="Grab them before they sell out" href="/gigs" linkText="All gigs" />
            {loading ? (
              <div className="space-y-px">
                {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-16 bg-zinc-950 animate-pulse" />)}
              </div>
            ) : (
              <div>{onSale.slice(0, 8).map(g => <GigCard key={g.gigId} gig={g} showArtist />)}</div>
            )}
          </div>
        </section>
      )}

      {/* Just announced */}
      {(loading || comingSoon.length > 0) && (
        <section className="border-b border-zinc-900">
          <div className="max-w-7xl mx-auto px-6 py-10">
            <SectionHeader title="JUST ANNOUNCED" label="New this week" labelColor="text-sky-500" subtitle="New gigs added in the last two weeks" href="/gigs" linkText="See all" />
            {loading ? (
              <div className="space-y-px">
                {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-16 bg-zinc-950 animate-pulse" />)}
              </div>
            ) : (
              <div>{comingSoon.slice(0, 8).map(g => <GigCard key={g.gigId} gig={g} showArtist />)}</div>
            )}
          </div>
        </section>
      )}

      {/* Grassroots */}
      <section className="border-b border-zinc-900">
        <div className="max-w-7xl mx-auto px-6 py-10">
          <SectionHeader title="GRASSROOTS GIGS" label="Support local venues" labelColor="text-emerald-500" subtitle="Small stages, big atmosphere" href="/gigs?grassroots=true" linkText="More grassroots" />
          {loading ? (
            <div className="space-y-px">
              {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-16 bg-zinc-950 animate-pulse" />)}
            </div>
          ) : grassroots.length > 0 ? (
            <div>{grassroots.slice(0, 8).map(g => <GigCard key={g.gigId} gig={g} showArtist grassroots />)}</div>
          ) : (
            <p className="text-xs font-bold uppercase tracking-wider text-zinc-700">Check back soon.</p>
          )}
        </div>
      </section>

      {/* Featured Venues */}
      {featuredVenues.length > 0 && (
        <section className="border-b border-zinc-900">
          <div className="max-w-7xl mx-auto px-6 py-10">
            <SectionHeader title="FEATURED VENUES" label="Verified on GigRadar" labelColor="text-amber-500" href="/venues" linkText="All venues" />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-zinc-900">
              {featuredVenues.map(v => (
                <Link key={v.venueId} href={`/venues/${v.slug}`}
                  className="bg-black p-5 hover:bg-zinc-950 transition-colors group">
                  <div className="flex items-center gap-2 mb-2">
                    {v.isVenuePro
                      ? <span className="text-[9px] font-black uppercase tracking-widest text-amber-500">Pro</span>
                      : <span className="text-[9px] font-black uppercase tracking-widest text-zinc-600">Verified</span>
                    }
                    {v.upcoming > 0 && (
                      <span className="text-[9px] font-black uppercase tracking-widest text-zinc-700">{v.upcoming} gig{v.upcoming !== 1 ? 's' : ''}</span>
                    )}
                  </div>
                  <div className="font-bold text-white text-sm group-hover:text-zinc-300 transition-colors leading-tight">{v.name}</div>
                  {v.city && <div className="text-[10px] font-black uppercase tracking-wider text-zinc-600 mt-0.5">{v.city}</div>}
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Early Radar */}
      <section className="border-b border-zinc-900">
        <div className="max-w-7xl mx-auto px-6 py-10">
          <SectionHeader title="EARLY RADAR" label="On the rise" labelColor="text-violet-500" subtitle="Fastest growing artists still playing small stages" />
          {loading ? (
            <div className="space-y-px">
              {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-16 bg-zinc-950 animate-pulse" />)}
            </div>
          ) : earlyRadar.length === 0 ? (
            <p className="text-xs font-bold uppercase tracking-wider text-zinc-700">Building the radar — check back soon.</p>
          ) : (
            <div>
              {earlyRadar.map(artist => {
                const gig = artist.upcomingGrassrootsGigs?.[0];
                return (
                  <div key={artist.artistId} className="flex items-center gap-4 border-b border-zinc-900 py-4 hover:bg-zinc-950 transition-colors px-0">
                    <Link href={`/artists/${encodeURIComponent(artist.artistId)}`} className="shrink-0">
                      {artist.imageUrl
                        ? <img src={artist.imageUrl} alt={artist.name} className="w-10 h-10 object-cover" />
                        : <div className="w-10 h-10 bg-zinc-900 flex items-center justify-center font-display text-xl text-zinc-600">{artist.name?.[0]}</div>
                      }
                    </Link>
                    <div className="flex-1 min-w-0">
                      <Link href={`/artists/${encodeURIComponent(artist.artistId)}`}
                        className="font-black text-sm uppercase tracking-wide text-white hover:text-zinc-400 transition-colors block truncate">
                        {artist.name}
                      </Link>
                      {gig && (
                        <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-600 truncate mt-0.5">
                          {gig.venueName}{gig.venueCity ? `, ${gig.venueCity}` : ''} · {new Date(gig.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                        </p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-display text-2xl text-violet-500">+{artist.growthRate}%</div>
                      <div className="text-[10px] font-black uppercase tracking-wider text-zinc-700">{(artist.latestListeners || 0).toLocaleString()} listeners</div>
                    </div>
                    {gig?.ticketUrl && (
                      <a href={gig.ticketUrl} target="_blank" rel="noopener noreferrer"
                        className="shrink-0 text-[9px] font-black uppercase tracking-widest border border-zinc-800 text-zinc-400 hover:border-white hover:text-white px-3 py-2 transition-colors">
                        Tickets
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* Emerging artists */}
      <section className="border-b border-zinc-900">
        <div className="max-w-7xl mx-auto px-6 py-10">
          <SectionHeader title="EMERGING ARTISTS" subtitle="Up-and-coming acts with multiple upcoming shows" href="/artists" linkText="Discover more" />
          {loading ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-px bg-zinc-900">
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="aspect-square bg-zinc-950 animate-pulse" />
              ))}
            </div>
          ) : emerging.length > 0 && (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-px bg-zinc-900">
              {emerging.slice(0, 12).map(a => <ArtistCard key={a.artistId} artist={a} />)}
            </div>
          )}
        </div>
      </section>

      {/* Upcoming gigs */}
      <section className="border-b border-zinc-900">
        <div className="max-w-7xl mx-auto px-6 py-10">
          <SectionHeader title="UPCOMING GIGS" href="/gigs" linkText="See all" />
          {loading ? (
            <div className="space-y-px">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-16 bg-zinc-950 animate-pulse" />
              ))}
            </div>
          ) : upcomingGigs.length > 0 ? (
            <>
              <div>{upcomingGigs.map(g => <GigCard key={g.gigId} gig={g} showArtist />)}</div>
              <div className="mt-8">
                <Link href="/gigs" className="inline-block border border-zinc-800 text-zinc-400 font-black text-[10px] uppercase tracking-widest px-8 py-3 hover:border-white hover:text-white transition-colors">
                  View all upcoming gigs →
                </Link>
              </div>
            </>
          ) : (
            <p className="text-xs font-bold uppercase tracking-wider text-zinc-700">No upcoming gigs found.</p>
          )}
        </div>
      </section>

      {/* Feature callouts */}
      <section className="border-b border-zinc-900">
        <div className="max-w-7xl mx-auto px-6 py-10">
          <div className="grid sm:grid-cols-3 gap-px bg-zinc-900">
            {[
              { icon: '🔔', title: 'INSTANT GIG ALERTS', desc: 'Get an email the moment a new show is announced for any artist or venue you follow. Never miss ticket day again.', cta: 'Browse artists', href: '/artists' },
              { icon: '📍', title: 'GIGS NEAR ME', desc: 'Find every live show within 15 miles of your location across all ticket platforms, including grassroots venues.', cta: 'Find local gigs', href: '/gigs' },
              { icon: '🎵', title: 'SPOTIFY IMPORT', desc: 'Connect Spotify to auto-follow your top listened artists and see all their upcoming UK shows in one place.', cta: 'Connect Spotify', href: '/onboarding/connect' },
            ].map(({ icon, title, desc, cta, href }) => (
              <div key={title} className="bg-black p-8 hover:bg-zinc-950 transition-colors">
                <div className="text-2xl mb-4">{icon}</div>
                <h3 className="font-display text-2xl text-white mb-3">{title}</h3>
                <p className="text-xs font-bold uppercase tracking-wider text-zinc-600 leading-relaxed mb-6">{desc}</p>
                <Link href={href} className="text-[10px] font-black uppercase tracking-widest text-zinc-400 hover:text-white transition-colors border-b border-zinc-800 hover:border-white pb-0.5">
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
