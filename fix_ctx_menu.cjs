const fs = require('fs');

let p = 'src/composables/timeline/useClipContextMenu.ts';
let c = fs.readFileSync(p, 'utf8');

const targetStr = `
      if (clipItem.clipType === 'media' || clipItem.clipType === 'timeline') {
        mainGroup.push({
          label: clipItem.reversed
            ? options.t('granVideoEditor.timeline.unreverse', 'Play Forward')
            : options.t('granVideoEditor.timeline.reverse', 'Reverse'),
          icon: 'i-heroicons-arrows-right-left',
          onSelect: async () => {
            options.updateClipProperties(track.id, clipItem.id, {
              reversed: !clipItem.reversed,
            });
            await options.requestTimelineSave({ immediate: true });
          },
        });
      }`;

c = c.replace(targetStr, '');
fs.writeFileSync(p, c);
console.log('Fixed useClipContextMenu.ts');
