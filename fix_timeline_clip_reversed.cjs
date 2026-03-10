const fs = require('fs');
const path = 'src/components/timeline/TimelineClip.vue';
let content = fs.readFileSync(path, 'utf8');

// Replace old violet border logic with new speed-based borders
content = content.replace(
  /<div\s*v-if="clipItem && clipItem\.reversed && !isMediaMissing"\s*class="absolute inset-0 rounded border-2 border-violet-400 pointer-events-none z-40"\s*><\/div>/g,
  `<div
        v-if="clipItem && typeof clipItem.speed === 'number' && clipItem.speed !== 1 && !isMediaMissing"
        class="absolute inset-0 rounded border-2 pointer-events-none z-40"
        :class="clipItem.speed < 0 ? 'border-fuchsia-500' : 'border-violet-400'"
      ></div>`
);

fs.writeFileSync(path, content);
console.log('Fixed TimelineClip borders');
