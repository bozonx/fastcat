const fs = require('fs');

let p = 'src/components/properties/ClipProperties.vue';
let c = fs.readFileSync(p, 'utf8');

c = c.replace(/const isReversed = computed\(\(\) => \{\s*if \(!props\.clip\) return false;\s*return Boolean\(\(props\.clip as any\)\.reversed\);\s*\}\);\s*const toggleReversed = \(\) => \{\s*if \(!props\.clip\) return;\s*timelineStore\.updateClipProperties\(props\.clip\.id, \{\s*reversed: !isReversed\.value,\s*\} as any\);\s*\};\s*/g, '');

c = c.replace(/const isReversed = computed\(\(\) => \{\s*if \(!props\.clip\) return false;\s*return Boolean\(props\.clip\.reversed\);\s*\}\);\s*const toggleReversed = \(\) => \{\s*if \(!props\.clip\) return;\s*timelineStore\.updateClipProperties\(props\.clip\.id, \{\s*reversed: !isReversed\.value,\s*\}\);\s*\};\s*/g, '');

c = c.replace(/const isReversed = computed\(\(\) => \{\n  if \(!props.clip\) return false;\n  return Boolean\(props.clip.reversed\);\n\}\);\n\nconst toggleReversed = \(\) => \{\n  if \(!props.clip\) return;\n  timelineStore.updateClipProperties\(props.clip.id, \{\n    reversed: !isReversed.value,\n  \}\);\n\};\n/g, '');

fs.writeFileSync(p, c);
console.log('Fixed clip props');
