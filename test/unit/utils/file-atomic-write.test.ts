import { describe, it, expect } from 'vitest';
import { validateSerializedContent } from '~/utils/file-atomic-write';

describe('validateSerializedContent', () => {
  it('returns valid true for valid JSON object', () => {
    const content = JSON.stringify({ OTIO_SCHEMA: 'Timeline.1', tracks: [] });
    const result = validateSerializedContent(content);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('returns valid false for empty string', () => {
    const result = validateSerializedContent('');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Content is empty or too small');
  });

  it('returns valid false for null', () => {
    const result = validateSerializedContent(null as any);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Content is empty or too small');
  });

  it('returns valid false for string smaller than 10 chars', () => {
    const result = validateSerializedContent('{"a":1}');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Content is empty or too small');
  });

  it('returns valid false for invalid JSON', () => {
    const result = validateSerializedContent('{"invalid": json}');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('JSON parsing failed');
  });

  it('returns valid false for JSON null', () => {
    const result = validateSerializedContent('null');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Content is empty or too small');
  });

  it('returns valid false for JSON primitive', () => {
    const result = validateSerializedContent('1234567890');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Content is not a valid object');
  });

  it('returns valid false for JSON array', () => {
    const result = validateSerializedContent('[1,2,3,4,5]');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Content is not a valid object');
  });

  it('accepts valid timeline document', () => {
    const timeline = {
      OTIO_SCHEMA: 'Timeline.1',
      id: 'test-id',
      name: 'Test Timeline',
      timebase: { fps: 30 },
      tracks: [{ id: 'v1', kind: 'video', name: 'Video 1', items: [] }],
      metadata: { fastcat: { version: 1 } },
    };
    const result = validateSerializedContent(JSON.stringify(timeline));
    expect(result.valid).toBe(true);
  });
});
