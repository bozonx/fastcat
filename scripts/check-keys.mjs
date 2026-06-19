import fs from 'fs';

const data = JSON.parse(fs.readFileSync('src/locales/en-US.json'));
console.log('Root keys:', Object.keys(data));
console.log('Has videoEditor.timeline:', !!data.videoEditor?.timeline);
console.log('Has timeline:', !!data.timeline);
if (data.timeline) console.log('timeline keys:', Object.keys(data.timeline).slice(0, 10));
if (data.videoEditor?.timeline)
  console.log('videoEditor.timeline keys:', Object.keys(data.videoEditor.timeline).slice(0, 10));
