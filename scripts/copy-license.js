// Copies the root LICENSE into every package before `changeset publish`: npm only packs files
// in the package's own directory, and the MIT notice has to travel with each copy.
import { copyFileSync, readdirSync } from 'node:fs';

for (const name of readdirSync('packages')) {
	copyFileSync('LICENSE', `packages/${name}/LICENSE`);
}
