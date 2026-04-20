#!/usr/bin/env node
/**
 * Runs the Lambda scraper handler locally for artist enrichment.
 * Imports Last.fm top UK artists, enriches with Deezer images.
 */
'use strict';

const path = require('path');
const lambdaPath = path.join(__dirname, '../lambda/scraper/index.js');
const { handler } = require(lambdaPath);

console.log('Running Lambda scraper locally...');
handler()
  .then(r => { console.log('Lambda complete:', JSON.stringify(r)); })
  .catch(e => { console.error('Lambda error:', e.message); process.exit(1); });
