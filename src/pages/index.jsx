import Head from 'next/head';
import Home from '../views/Home.jsx';

export default function IndexPage() {
  return (
    <>
      <Head>
        <title>GigRadar — Find Every UK Gig</title>
        <meta name="description" content="GigRadar tracks every upcoming gig for UK artists across Ticketmaster, Songkick, Dice, Skiddle and more. Discover shows, follow artists, get alerts." />
        <meta property="og:title" content="GigRadar — Find Every UK Gig" />
        <meta property="og:description" content="Track every upcoming gig for UK artists. One place, every source." />
        <meta property="og:type" content="website" />
        <link rel="canonical" href="https://gigradar.co.uk" />
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content="GigRadar — Find Every UK Gig" />
        <meta name="twitter:description" content="Track every upcoming gig for UK artists. One place, every source." />
      </Head>
      <Home />
    </>
  );
}
