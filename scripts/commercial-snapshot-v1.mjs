import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {buildCommercialSnapshot} from '../lib/commercial/commercial-snapshot-v1.mjs';
const args=process.argv.slice(2),val=k=>{const i=args.indexOf(k);return i>=0?args[i+1]:null};
const input=val('--input'),output=val('--output');
if(!input||!output){console.error('usage: node scripts/commercial-snapshot-v1.mjs --input data.json --output snapshot.json');process.exit(2)}
const src=JSON.parse(await readFile(resolve(input),'utf8'));
const snapshot=buildCommercialSnapshot(src,{now:process.env.SNAPSHOT_NOW||new Date()});
await writeFile(resolve(output),`${JSON.stringify(snapshot,null,2)}\n`,'utf8');
console.log(JSON.stringify({ok:true,output:resolve(output),version:snapshot.version,external_side_effect:false}));
