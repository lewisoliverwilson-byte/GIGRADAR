import Head from 'next/head';
import Venues from '../../views/Venues.jsx';

export default function VenuesPage() {
  return (
    <>
      <Head>
        <title>UK Music Venues — GigRadar</title>
        <meta name="description" content="Browse 12,000+ UK music venues tracked by GigRadar. See upcoming gigs, follow your local venues and get instant alerts." />
        <link rel="canonical" href="https://gigradar.co.uk/venues" />
      </Head>
      <Venues />
    </>
  );
}
