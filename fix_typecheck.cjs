const fs = require('fs');

// 1. ClipProperties.vue
let p = 'src/components/properties/ClipProperties.vue';
let c = fs.readFileSync(p, 'utf8');
c = c.replace(/const isReversed = computed\(\(\) => \{\s*if \(!props.clip\) return false;\s*return Boolean\(props.clip.reversed\);\s*}\);\s*const toggleReversed = \(\) => \{\s*if \(!props.clip\) return;\s*timelineStore.updateClipProperties\(props.clip.id, \{\s*reversed: !isReversed.value,\s*}\);\s*};\s*/g, '');
fs.writeFileSync(p, c);

// 2. useClipContextMenu.ts
p = 'src/composables/timeline/useClipContextMenu.ts';
c = fs.readFileSync(p, 'utf8');
c = c.replace(/,\s*\{\s*label: clipItem\.reversed[\s\S]*?\}\s*\}/g, '');
fs.writeFileSync(p, c);

// 3. AudioEngine.ts
p = 'src/utils/video-editor/AudioEngine.ts';
c = fs.readFileSync(p, 'utf8');
// Fix isClipReversed used before declaration
c = c.replace(/const isTimelineBackward = this\.globalSpeed < 0;\s*\/\/ isClipReversed is calculated from speed\s*const playReversedBuffer = isTimelineBackward !== isClipReversed;/g, 'const isTimelineBackward = this.globalSpeed < 0;');
c = c.replace(/const isClipReversed = clipSpeed < 0;\s*const absSpeed = Math\.abs\(clipSpeed\);\s*const effectiveSpeed = absSpeed \* Math\.abs\(this\.globalSpeed\);/g, `const isClipReversed = clipSpeed < 0;\n    const playReversedBuffer = isTimelineBackward !== isClipReversed;\n    const absSpeed = Math.abs(clipSpeed);\n    const effectiveSpeed = absSpeed * Math.abs(this.globalSpeed);`);
// Fix `speed` used in transition mapping
c = c.replace(/rampEndClipS\) \/ speed;/g, 'rampEndClipS) / absSpeed;');
c = c.replace(/rampStartClipS\) \/ speed;/g, 'rampStartClipS) / absSpeed;');
fs.writeFileSync(p, c);

// 4. VideoCompositor.ts
p = 'src/utils/video-editor/VideoCompositor.ts';
c = fs.readFileSync(p, 'utf8');
c = c.replace(/reusable\.reversed = reversed;/g, '');
c = c.replace(/reversed,\n/g, '');
c = c.replace(/clip\.reversed = reversed;/g, '');
c = c.replace(/prevClip\.reversed/g, '((prevClip.speed || 1) < 0)');
c = c.replace(/clip\.reversed/g, '((clip.speed || 1) < 0)');
c = c.replace(/const reversed = Boolean\(\(clipData as any\)\.reversed\);/g, '');
c = c.replace(/const reversed = Boolean\(\(next as any\)\.reversed\);/g, '');
fs.writeFileSync(p, c);

console.log('Fixed typecheck errors');
