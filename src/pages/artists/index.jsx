import Head from 'next/head';
import Artists from '../../views/Artists.jsx';

export default function ArtistsPage() {
  return (
    <>
      <Head>
        <title>UK Artists — GigRadar</title>
        <meta name="description" content="Browse 18,000+ UK artists tracked by GigRadar. Find upcoming gigs, follow artists and get email alerts." />
      </Head>
      <Artists />
    </>
  );
}
