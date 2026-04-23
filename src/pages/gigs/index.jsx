import Head from 'next/head';
import Gigs from '../../views/Gigs.jsx';
import { CONFIG } from '../../utils/config.js';

export default function GigsPage() {
  return (
    <>
      <Head>
        <title>Upcoming UK Gigs — GigRadar</title>
        <meta name="description" content="Find every upcoming UK gig. Filter by city, genre, date and price. Tickets from Ticketmaster, Skiddle, Ents24, Resident Advisor and more." />
        <link rel="canonical" href={`${CONFIG.siteUrl}/gigs`} />
        <meta property="og:title" content="Upcoming UK Gigs — GigRadar" />
        <meta property="og:description" content="106,000+ upcoming UK gigs across every ticket platform. Filter by city, genre or date." />
        <meta property="og:type" content="website" />
      </Head>
      <Gigs />
    </>
  );
}
