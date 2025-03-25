// fix-script-paths.js
import { readFile, writeFile } from 'fs/promises';
import { glob } from 'glob';

// Find the hashed filename of app.js in dist/assets/
const assetFiles = await glob('dist/assets/app.js');
const appFile = assetFiles[0];

if (!appFile) {
  console.error('Could not find bundled app.js in dist/assets/');
  process.exit(1);
}

// Extract the hashed filename (e.g., /assets/app-<hash>.js)
const appPath = `/${appFile.replace('dist/', '')}`;

// Update signup.html
let signupHtml = await readFile('dist/signup.html', 'utf-8');
signupHtml = signupHtml.replace('src="/assets/app.js"', `src="${appPath}"`);
await writeFile('dist/signup.html', signupHtml);
console.log(`Updated script path in signup.html to ${appPath}`);

// Update node-instructions.html
let nodeInstructionsHtml = await readFile('dist/node-instructions.html', 'utf-8');
nodeInstructionsHtml = nodeInstructionsHtml.replace('src="/assets/app.js"', `src="${appPath}"`);
await writeFile('dist/node-instructions.html', nodeInstructionsHtml);
console.log(`Updated script path in node-instructions.html to ${appPath}`);