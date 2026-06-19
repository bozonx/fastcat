function estimateSnapshotBytes(value, depth = 0) {
  if (value == null) return 4;
  const t = typeof value;
  if (t === 'string') return value.length * 2 + 8;
  if (t === 'number') return 8;
  if (t === 'boolean') return 4;
  if (t !== 'object') return 8;
  if (depth > 64) return 0;
  if (Array.isArray(value)) {
    let total = 16;
    for (let i = 0; i < value.length; i += 1) total += estimateSnapshotBytes(value[i], depth + 1);
    return total;
  }
  let total = 16;
  for (const key in value) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      total += key.length * 2 + estimateSnapshotBytes(value[key], depth + 1);
    }
  }
  return total;
}

function makeBigDoc(id, payloadChars) {
  return {
    OTIO_SCHEMA: 'Timeline.1',
    id,
    name: id,
    timebase: { fps: 30 },
    tracks: [],
    payload: 'x'.repeat(payloadChars),
  };
}

const doc = makeBigDoc('doc-0', 50000);
const bytes = estimateSnapshotBytes(doc);
console.log('Estimated bytes:', bytes);
console.log('Estimated KB:', bytes / 1024);
console.log('Estimated MB:', bytes / 1024 / 1024);
