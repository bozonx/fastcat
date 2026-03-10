const fs = require('fs');

function removeReversed(file) {
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(/reversed:\s*[^\n,]+,?\n?/g, '');
  content = content.replace(/reversed\??:\s*boolean;?\n?/g, '');
  content = content.replace(/\|\s*'reversed'\n?/g, '');
  content = content.replace(/clip\.reversed/g, 'false');
  content = content.replace(/clipItem\.reversed/g, 'false');
  content = content.replace(/next\.reversed/g, 'false');
  fs.writeFileSync(file, content);
}

const files = [
  'src/stores/timeline/timelineClips.ts',
  'src/composables/monitor/useMonitorCore.ts',
  'src/composables/monitor/useMonitorTimeline.ts',
  'src/composables/timeline/useTimelineExport.ts',
  'src/timeline/commands.ts',
];

files.forEach(removeReversed);
console.log('Removed reversed from mapping files');
