const fs = require('fs');

// 1. ClipProperties.vue
let clipPropsPath = 'src/components/properties/ClipProperties.vue';
let clipProps = fs.readFileSync(clipPropsPath, 'utf8');

// Remove reversed computed property and toggle logic
clipProps = clipProps.replace(/const isReversed = computed\(\(\) => \{\s*if \(\!props\.clip\) return false;\s*return Boolean\(props\.clip\.reversed\);\s*\}\);\s*const toggleReversed = \(\) => \{\s*if \(\!props\.clip\) return;\s*timelineStore\.updateClipProperties\(props\.clip\.id, \{\s*reversed: !isReversed\.value,\s*\}\);\s*\};\s*/g, '');

// Remove reversed UI switch
clipProps = clipProps.replace(/<div class="flex items-center justify-between">\s*<span class="text-xs text-ui-text-muted">\s*\{\{ t\('granVideoEditor.clip.reversed', 'Reverse Playback'\) \}\}\s*<\/span>\s*<UToggle\s*:model-value="isReversed"\s*size="sm"\s*@update:model-value="toggleReversed"\s*\/>\s*<\/div>/g, '');

fs.writeFileSync(clipPropsPath, clipProps);

// 2. useClipContextMenu.ts
let ctxMenuPath = 'src/composables/timeline/useClipContextMenu.ts';
let ctxMenu = fs.readFileSync(ctxMenuPath, 'utf8');

// Remove Reverse Playback option from context menu
ctxMenu = ctxMenu.replace(/,\s*\{\s*label: clipItem\.reversed\s*\?\s*t\('granVideoEditor\.timeline\.contextMenu\.removeReverse', 'Remove Reverse'\)\s*:\s*t\('granVideoEditor\.timeline\.contextMenu\.reverse', 'Reverse Playback'\),\s*icon: clipItem\.reversed \? 'i-heroicons-arrow-right' : 'i-heroicons-arrow-left',\s*click: \(\) => \{\s*timelineStore\.updateClipProperties\(clipItem\.id, \{\s*reversed: !clipItem\.reversed,\s*\}\);\s*\}\s*\}/g, '');

fs.writeFileSync(ctxMenuPath, ctxMenu);

console.log('Removed reversed from UI');
