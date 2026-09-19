import { describe, it, expect, afterEach } from 'vitest';
import {
  canManageProjectDocuments,
  canReorganizeFiles,
  isEmbedRuntime,
  isEmbedSessionTimelineEntry,
} from '~/utils/embed-runtime';

const initialPath = window.location.pathname;

afterEach(() => {
  window.history.replaceState(null, '', initialPath);
});

describe('embed runtime', () => {
  it('recognises the embed route, trailing slash or not', () => {
    window.history.replaceState(null, '', '/embed/');
    expect(isEmbedRuntime()).toBe(true);
    window.history.replaceState(null, '', '/editor/demo');
    expect(isEmbedRuntime()).toBe(false);
  });

  it('keeps an embedded session to the one timeline it hands back', () => {
    window.history.replaceState(null, '', '/embed');
    expect(canManageProjectDocuments()).toBe(false);
    window.history.replaceState(null, '', '/editor/demo');
    expect(canManageProjectDocuments()).toBe(true);
  });

  // The host's draft finds each clip's file by the path the session gave it.
  it('keeps the files of an embedded session where the session put them', () => {
    window.history.replaceState(null, '', '/embed');
    expect(canReorganizeFiles()).toBe(false);
    window.history.replaceState(null, '', '/editor/demo');
    expect(canReorganizeFiles()).toBe(true);
  });

  it('protects the session timeline and every folder holding it', () => {
    const timeline = '_timelines/session.otio';
    window.history.replaceState(null, '', '/embed');
    expect(isEmbedSessionTimelineEntry({ kind: 'file', path: timeline }, timeline)).toBe(true);
    expect(isEmbedSessionTimelineEntry({ kind: 'directory', path: '_timelines' }, timeline)).toBe(
      true,
    );
    expect(isEmbedSessionTimelineEntry({ kind: 'directory', path: '_video' }, timeline)).toBe(
      false,
    );
    expect(isEmbedSessionTimelineEntry({ kind: 'file', path: '_video/a.mp4' }, timeline)).toBe(
      false,
    );
    window.history.replaceState(null, '', '/editor/demo');
    expect(isEmbedSessionTimelineEntry({ kind: 'file', path: timeline }, timeline)).toBe(false);
  });
});
