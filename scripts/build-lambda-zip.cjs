#!/usr/bin/env node
'use strict';
// Builds lambda/api/deploy.zip — called by deploy-lambda.sh
const archiver = require('../lambda/api/node_modules/archiver');
const fs   = require('fs');
const path = require('path');

const lambdaDir = path.join(__dirname, '../lambda/api');
const outPath   = path.join(lambdaDir, 'deploy.zip');

const out     = fs.createWriteStream(outPath);
const archive = archiver('zip', { zlib: { level: 6 } });

out.on('close', () => {
  const mb = (archive.pointer() / 1024 / 1024).toFixed(1);
  console.log(`  deploy.zip: ${mb}MB (${archive.pointer().toLocaleString()} bytes)`);
});
archive.on('error', e => { throw e; });
archive.pipe(out);

archive.file(path.join(lambdaDir, 'index.js'), { name: 'index.js' });
archive.directory(path.join(lambdaDir, 'node_modules'), 'node_modules');
archive.finalize();
