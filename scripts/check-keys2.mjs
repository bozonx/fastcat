import fs from 'fs';

const data = JSON.parse(fs.readFileSync('src/locales/en-US.json'));
if (data.videoEditor?.timeline) {
  const keys = Object.keys(data.videoEditor.timeline);
  console.log('All videoEditor.timeline keys:', keys);
} else {
  console.log('No videoEditor.timeline');
}

if (data.fastcat?.timeline) {
  const keys = Object.keys(data.fastcat.timeline);
  console.log('All fastcat.timeline keys (first 20):', keys.slice(0, 20));
  console.log('Total fastcat.timeline keys:', keys.length);
} else {
  console.log('No fastcat.timeline');
}
