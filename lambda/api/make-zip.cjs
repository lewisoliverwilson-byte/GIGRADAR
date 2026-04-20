#!/usr/bin/env node
'use strict';
const archiver = require('./node_modules/archiver');
const fs = require('fs');
const path = require('path');

const out = fs.createWriteStream(path.join(__dirname, 'function_v3.zip'));
const archive = archiver('zip', { zlib: { level: 6 } });

out.on('close', () => {
  console.log('ZIP size:', archive.pointer(), 'bytes');
});
archive.on('error', e => { throw e; });
archive.pipe(out);
archive.file(path.join(__dirname, 'index.js'), { name: 'index.js' });
archive.directory(path.join(__dirname, 'node_modules'), 'node_modules');
archive.finalize();
