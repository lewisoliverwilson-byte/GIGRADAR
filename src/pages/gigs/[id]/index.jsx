import Head from 'next/head';
import CityGigsPage from '../../../views/CityGigsPage.jsx';
import { CONFIG } from '../../../utils/config.js';

const CITIES = [
  'London','Manchester','Birmingham','Glasgow','Liverpool','Leeds',
  'Bristol','Edinburgh','Newcastle','Sheffield','Nottingham','Cardiff',
  'Brighton','Oxford','Leicester','Southampton','Belfast','Cambridge',
  'Norwich','Exeter','Bath','York','Plymouth','Coventry','Reading',
];

export default function CityRoute({ city, gigs, venues }) {
  const cityName = city || '';
  const year = new Date().getFullYear();
  const title = `Live Gigs in ${cityName} ${year} — Every Show · GigRadar`;
  const desc  = `Find every upcoming live gig in ${cityName}${gigs?.length ? ` — ${gigs.length}+ shows` : ''} across Ticketmaster, Skiddle, Resident Advisor, Ents24 and more. Grassroots venues included.`;

  return (
    <>
      <Head>
        <title>{title}</title>
        <meta name="description" content={desc} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={desc} />
        <meta property="og:type" content="website" />
        <link rel="canonical" href={`${CONFIG.siteUrl}/gigs/${cityName.toLowerCase()}`} />
        <meta property="og:type" content="website" />
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={desc} />
      </Head>
      <CityGigsPage city={cityName} initialGigs={gigs || []} grassrootsVenues={venues || []} />
    </>
  );
}

export async function getStaticPaths() {
  return {
    paths: CITIES.map(city => ({ params: { id: city.toLowerCase() } })),
    fallback: 'blocking',
  };
}

export async function getStaticProps({ params }) {
  const slug = (params.id || '').toLowerCase();
  // Capitalise first letter only
  const city = slug.charAt(0).toUpperCase() + slug.slice(1);

  try {
    const [gigsRes, venuesRes] = await Promise.all([
      fetch(`${CONFIG.apiBaseUrl}/gigs?city=${encodeURIComponent(city)}&limit=200`),
      fetch(`${CONFIG.apiBaseUrl}/venues?city=${encodeURIComponent(city)}&grassroots=true`),
    ]);
    const gigs   = gigsRes.ok   ? await gigsRes.json()   : [];
    const venues = venuesRes.ok ? await venuesRes.json() : [];
    return { props: { city, gigs, venues }, revalidate: 1800 };
  } catch {
    return { props: { city, gigs: [], venues: [] }, revalidate: 1800 };
  }
}
