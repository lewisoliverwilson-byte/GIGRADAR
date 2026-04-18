import Head from 'next/head';
import Venues from '../../views/Venues.jsx';

export default function VenuesPage() {
  return (
    <>
      <Head>
        <title>UK Music Venues — GigRadar</title>
        <meta name="description" content="Browse 4,700+ UK music venues tracked by GigRadar. See upcoming gigs and follow your local venues." />
      </Head>
      <Venues />
    </>
  );
}
