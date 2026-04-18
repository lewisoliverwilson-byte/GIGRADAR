import Head from 'next/head';
import Search from '../views/Search.jsx';

export default function SearchPage() {
  return (
    <>
      <Head>
        <title>Search — GigRadar</title>
        <meta name="description" content="Search for artists, venues and gigs on GigRadar." />
      </Head>
      <Search />
    </>
  );
}
