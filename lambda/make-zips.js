const archiver = require('archiver');
const fs = require('fs');
const path = require('path');

function makeZip(srcDir, outPath) {
  return new Promise((resolve, reject) => {
    try { fs.unlinkSync(outPath); } catch (e) {}
    const output = fs.createWriteStream(outPath);
    const archive = archiver('zip', { zlib: { level: 6 } });
    output.on('close', () => resolve(archive.pointer()));
    archive.on('error', reject);
    archive.pipe(output);
    // Add all files except devDependencies zips and the output itself
    archive.glob('**/*', {
      cwd: srcDir,
      ignore: ['function.zip', 'function.tar.gz', 'node_modules/archiver/**', 'node_modules/archiver-utils/**']
    });
    archive.finalize();
  });
}

(async () => {
  for (const dir of ['scraper', 'api']) {
    const srcDir = path.join('C:/GIGSITE/lambda', dir);
    const outPath = path.join('C:/GIGSITE/lambda', dir, 'function.zip');
    try {
      const bytes = await makeZip(srcDir, outPath);
      console.log(dir + ': ' + (bytes / 1024 / 1024).toFixed(1) + ' MB');
    } catch (e) {
      console.error(dir + ' failed:', e.message);
    }
  }
})();
