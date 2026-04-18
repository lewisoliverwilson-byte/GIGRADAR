import Head from 'next/head';
import Gigs from '../../views/Gigs.jsx';

export default function GigsPage() {
  return (
    <>
      <Head>
        <title>Upcoming UK Gigs — GigRadar</title>
        <meta name="description" content="Find every upcoming UK gig. Filter by city, date, or artist. Tickets from Ticketmaster, Skiddle, Dice and more." />
      </Head>
      <Gigs />
    </>
  );
}
