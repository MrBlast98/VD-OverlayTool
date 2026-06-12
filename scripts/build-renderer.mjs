import { build } from 'esbuild';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const rendererDir = path.join(rootDir, 'src', 'renderer');
const entryPoint = path.join(rendererDir, 'app.js');
const bundleFile = path.join(rendererDir, 'app.bundle.js');
const indexFile = path.join(rendererDir, 'index.html');
const preloadFile = path.join(rootDir, 'src', 'main', 'preload.js');
const manifestFile = path.join(rendererDir, 'renderer-manifest.json');

function sha256File(filePath) {
  const buffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex').toUpperCase();
}

async function main() {
  await build({
    entryPoints: [entryPoint],
    outfile: bundleFile,
    bundle: true,
    minify: true,
    sourcemap: false,
    platform: 'node',
    format: 'cjs',
    target: ['node18'],
    logLevel: 'info',
    charset: 'utf8',
    external: ['electron'],
    define: {
      'process.env.NODE_ENV': '"production"',
    },
  });

  const manifest = {
    generatedAt: new Date().toISOString(),
    entryPoint: 'app.bundle.js',
    appBundleHash: sha256File(bundleFile),
    indexHtmlHash: sha256File(indexFile),
    preloadHash: sha256File(preloadFile),
  };

  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`Wrote bundle to ${path.relative(rootDir, bundleFile)}`);
  console.log(`Wrote manifest to ${path.relative(rootDir, manifestFile)}`);
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
