const fs = require('fs');

// 3. Fix TimelineClip.vue total width logic to use absolute speed
const timelineClipPath = 'src/components/timeline/TimelineClip.vue';
let content = fs.readFileSync(timelineClipPath, 'utf8');

// The line: const currentSpeed = computed(() => clipItem.value?.speed || 1);
// needs to be absolute for visual width calculation
content = content.replace(
  /const currentSpeed = computed\(\(\) => clipItem\.value\?\.speed \|\| 1\);/g,
  'const currentSpeed = computed(() => Math.abs(clipItem.value?.speed || 1));'
);

// Also need to fix TimelineAudioWaveform.vue to use absolute speed
const wavePath = 'src/components/timeline/audio/TimelineAudioWaveform.vue';
let wave = fs.readFileSync(wavePath, 'utf8');
wave = wave.replace(
  /const speed = computed\(\(\) => \{\s*const s = props\.item\.speed \|\| 1;\s*\/\/ Prevent division by zero and extreme values\s*return Math\.max\(0\.001, Math\.min\(100, s\)\);\s*\}\);/g,
  `const speed = computed(() => {
  const s = props.item.speed || 1;
  const abs = Math.abs(s);
  // Prevent division by zero and extreme values
  return Math.max(0.001, Math.min(100, abs));
});`
);
fs.writeFileSync(wavePath, wave);

console.log('Fixed width calcs for negative speed');
