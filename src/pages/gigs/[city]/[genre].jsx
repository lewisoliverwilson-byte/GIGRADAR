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
  const title = `${genre} Gigs in ${city} — GigRadar`;
  const desc  = `Every upcoming ${genre} gig in ${city}${gigs?.length ? ` — ${gigs.length}+ shows` : ''}. From grassroots clubs to major venues, all in one place.`;

  return (
    <>
      <Head>
        <title>{title}</title>
        <meta name="description" content={desc} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={desc} />
        <link rel="canonical" href={`https://gigradar.co.uk/gigs/${city.toLowerCase()}/${genre}`} />
      </Head>
      <CityGigsPage city={city} genre={genre} initialGigs={gigs || []} grassrootsVenues={venues || []} />
    </>
  );
}

export async function getStaticPaths() {
  return { paths: [], fallback: 'blocking' };
}

export async function getStaticProps({ params }) {
  const city  = (params.city || '').charAt(0).toUpperCase() + (params.city || '').slice(1);
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
