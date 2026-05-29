const { execSync } = require('child_process');

const getGitHash = () => {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'no-git-info';
  }
};

let commitJson = {
  hash: JSON.stringify(getGitHash()),
  version: JSON.stringify(process.env.npm_package_version),
};

console.log(`
★═══════════════════════════════════════★
          L U X C O D E R
     Local AI Vibe Coding Studio
★═══════════════════════════════════════★
`);
console.log('📍 Version:', `v${commitJson.version}`);
console.log('📍 Commit:', commitJson.hash);
console.log('📍 Open http://127.0.0.1:5173 when the URL appears');
console.log('★═══════════════════════════════════════★');
