import Head from 'next/head';
import CityGigsPage from '../../../views/CityGigsPage.jsx';
import { CONFIG } from '../../../utils/config.js';

const CITIES = [
  'London','Manchester','Birmingham','Glasgow','Liverpool','Leeds',
  'Bristol','Edinburgh','Newcastle','Sheffield','Nottingham','Cardiff',
  'Brighton','Oxford','Leicester','Southampton','Belfast',
];
const GENRES = ['rock','indie','pop','electronic','dance','jazz','classical','hip-hop','folk','metal','punk','alternative'];

export default function CityGenreRoute({ city, genre, gigs, venues }) {
  const genreCap = genre ? genre.charAt(0).toUpperCase() + genre.slice(1) : '';
  const year  = new Date().getFullYear();
  const title = `${genreCap} Gigs in ${city} ${year} — GigRadar`;
  const desc  = `Every upcoming ${genreCap} gig in ${city}${gigs?.length ? ` — ${gigs.length}+ shows` : ''}. From grassroots clubs to major venues, all in one place.`;

  return (
    <>
      <Head>
        <title>{title}</title>
        <meta name="description" content={desc} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={desc} />
        <meta property="og:type" content="website" />
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={desc} />
        <link rel="canonical" href={`${CONFIG.siteUrl}/gigs/${city.toLowerCase()}/${genre}`} />
      </Head>
      <CityGigsPage city={city} genre={genre} initialGigs={gigs || []} grassrootsVenues={venues || []} />
    </>
  );
}

export async function getStaticPaths() {
  return { paths: [], fallback: 'blocking' };
}

export async function getStaticProps({ params }) {
  const city  = (params.id || '').charAt(0).toUpperCase() + (params.id || '').slice(1);
  const genre = (params.genre || '').toLowerCase();
  if (!GENRES.includes(genre)) return { notFound: true };

  try {
    const [gigsRes, venuesRes] = await Promise.all([
      fetch(`${CONFIG.apiBaseUrl}/gigs?city=${encodeURIComponent(city)}&genre=${encodeURIComponent(genre)}&limit=200`),
      fetch(`${CONFIG.apiBaseUrl}/venues?city=${encodeURIComponent(city)}&grassroots=true`),
    ]);
    const gigs   = gigsRes.ok   ? await gigsRes.json()   : [];
    const venues = venuesRes.ok ? await venuesRes.json() : [];
    return { props: { city, genre, gigs, venues }, revalidate: 1800 };
  } catch {
    return { props: { city, genre, gigs: [], venues: [] }, revalidate: 1800 };
  }
}
