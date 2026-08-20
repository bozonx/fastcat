import { describe, expect, it } from 'vitest';
import { createTimelineDocId, createMarkerId, createLinkedGroupId } from '~/timeline/id';

describe('timeline/id', () => {
  describe('createTimelineDocId', () => {
    it('slugifies the project name and appends a random suffix', () => {
      const id = createTimelineDocId('My Project!');
      expect(id).toMatch(/^timeline_my-project_[0-9a-z]+$/);
    });

    it('falls back to "project" for an empty/symbol-only name', () => {
      expect(createTimelineDocId('   ')).toMatch(/^timeline_project_/);
      expect(createTimelineDocId('!!!')).toMatch(/^timeline_project_/);
    });

    it('produces unique ids for the same name', () => {
      expect(createTimelineDocId('a')).not.toBe(createTimelineDocId('a'));
    });
  });

  describe('createMarkerId', () => {
    it('uses the marker_ prefix and is unique', () => {
      const a = createMarkerId();
      const b = createMarkerId();
      expect(a).toMatch(/^marker_[0-9a-z]+_[0-9a-z]{8}$/);
      expect(a).not.toBe(b);
    });
  });

  describe('createLinkedGroupId', () => {
    it('uses the linked-group- prefix and is unique', () => {
      const a = createLinkedGroupId();
      const b = createLinkedGroupId();
      expect(a).toMatch(/^linked-group-[0-9a-z]+-[0-9a-z]{8}$/);
      expect(a).not.toBe(b);
    });
  });
});
