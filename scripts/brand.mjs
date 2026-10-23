import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const upstream=path.join(root,'upstream');
const configuration=path.join(upstream,'config.json');
if(!fs.existsSync(configuration)) {console.error('[SuperMan] Upstream source missing. Run npm run setup first.');process.exit(1);}
const config=JSON.parse(fs.readFileSync(configuration,'utf8'));
config.title='SuperMan';
config.host='127.0.0.1'; // gateway alone should be reachable publicly
config.port=8080;
config.showSplash=false;
fs.writeFileSync(configuration,JSON.stringify(config,null,2)+'\n');
const dir=path.join(upstream,'views','assets','img');
fs.mkdirSync(dir,{recursive:true});
for (const name of ['superman-emblem.svg','hyperdrive-core.svg','ghost-layer.svg']) fs.copyFileSync(path.join(root,'public','assets',name),path.join(dir,name));
console.log('[SuperMan] Visible title, logos, and internal listening address configured.');
console.log('[SuperMan] Engine package identifiers and open-source license credits intentionally remain intact.');
