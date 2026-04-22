import { Html, Head, Main, NextScript } from 'next/document';

export default function Document() {
  return (
    <Html lang="en" className="dark">
      <Head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="sitemap" type="application/xml" href="/sitemap.xml" />
        <meta name="twitter:site" content="@GigRadarUK" />
      </Head>
      <body className="bg-zinc-950 text-white antialiased">
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
