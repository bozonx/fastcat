const fs = require('fs');

// 1. AudioEngine.ts
const audioPath = 'src/utils/video-editor/AudioEngine.ts';
let audio = fs.readFileSync(audioPath, 'utf8');

// Replace speed limit logic (allow negative speed)
audio = audio.replace(
  /const speedRaw = clip\.speed;\s*const speed =\s*typeof speedRaw === 'number' && Number\.isFinite\(speedRaw\)\s*\?\s*Math\.max\(0\.1, Math\.min\(10, speedRaw\)\)\s*:\s*1;\s*const effectiveSpeed = speed \* Math\.abs\(this\.globalSpeed\);/g,
  `const speedRaw = clip.speed;
    const clipSpeed =
      typeof speedRaw === 'number' && Number.isFinite(speedRaw) && speedRaw !== 0
        ? Math.max(-10, Math.min(10, speedRaw))
        : 1;

    const isClipReversed = clipSpeed < 0;
    const absSpeed = Math.abs(clipSpeed);
    const effectiveSpeed = absSpeed * Math.abs(this.globalSpeed);`
);

// Replace isClipReversed hardcode
audio = audio.replace(/const isClipReversed = clip\.reversed === true;/g, '// isClipReversed is calculated from speed');

// Replace usages of `speed` with `absSpeed` in playback logic
audio = audio.replace(/currentClipLocalS \* speed/g, 'currentClipLocalS * absSpeed');
audio = audio.replace(/remainingInClipS \* speed/g, 'remainingInClipS * absSpeed');

fs.writeFileSync(audioPath, audio);


// 2. VideoCompositor.ts
const videoPath = 'src/utils/video-editor/VideoCompositor.ts';
let video = fs.readFileSync(videoPath, 'utf8');

// Replace speed limit logic in clip mappings to allow negative speed (but not 0)
video = video.replace(
  /const speed =\s*typeof speedRaw === 'number' && Number\.isFinite\(speedRaw\)\s*\?\s*Math\.max\(0\.1, Math\.min\(10, speedRaw\)\)\s*:\s*undefined;/g,
  `const speed =
        typeof speedRaw === 'number' && Number.isFinite(speedRaw) && speedRaw !== 0
          ? Math.max(-10, Math.min(10, speedRaw))
          : undefined;`
);

// Update local time processing to use absolute speed and negative check
video = video.replace(
  /const speed = typeof clip\.speed === 'number' \? clip\.speed : 1;\s*const reversed = clip\.reversed === true;/g,
  `const speedRaw = typeof clip.speed === 'number' && clip.speed !== 0 ? clip.speed : 1;
        const speed = Math.abs(speedRaw);
        const reversed = speedRaw < 0;`
);

fs.writeFileSync(videoPath, video);

console.log('Updated engines to use negative speed');
