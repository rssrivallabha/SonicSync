import fs from 'node:fs';
const required=[
 'docs/HARDWARE_ARCHITECTURE.md','docs/BOM.md','docs/SCHEMATIC.md','docs/HARDWARE_LATENCY.md','docs/SYNCHRONIZATION_MEASUREMENT.md','docs/TEST_FIXTURE.md',
 'hardware/esp32s3-speaker-node/main/main.cpp','hardware/measurement/gpio-timestamp-fixture/main/main.cpp'
];
const missing=required.filter(p=>!fs.existsSync(p));
if(missing.length){console.error('Missing measurement deliverables:',missing.join(', '));process.exit(1)}
for(const f of required){ if(!fs.statSync(f).size) {console.error('Empty deliverable:',f);process.exit(1)} }
console.log(`Measurement/hardware deliverables present: ${required.length}`);
