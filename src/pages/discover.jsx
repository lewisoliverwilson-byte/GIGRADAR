import Head from 'next/head';
import Discover from '../views/Discover.jsx';

export default function DiscoverPage() {
  return (
    <>
      <Head>
        <title>Discover Gigs — GigRadar</title>
        <meta name="description" content="Discover upcoming gigs and live music events across the UK." />
      </Head>
      <Discover />
    </>
  );
}
