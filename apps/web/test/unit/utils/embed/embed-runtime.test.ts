import { describe, it, expect, afterEach } from 'vitest';
import { canManageProjectDocuments, isEmbedRuntime } from '~/utils/embed-runtime';

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
});
