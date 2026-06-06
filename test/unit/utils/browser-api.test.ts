import { describe, it, expect, vi } from 'vitest';
import {
  getDevicePixelRatio,
  dispatchWindowEvent,
  elementFromPoint,
  getActiveElement,
  querySelector,
  querySelectorAll,
  elementsFromPoint,
  addDocumentEventListener,
  removeDocumentEventListener,
} from '~/utils/browser-api';

describe('browser-api', () => {
  describe('getDevicePixelRatio', () => {
    it('returns window.devicePixelRatio', () => {
      expect(getDevicePixelRatio()).toBe(window.devicePixelRatio || 1);
    });
  });

  describe('dispatchWindowEvent', () => {
    it('dispatches event on window', () => {
      const listener = vi.fn();
      window.addEventListener('test-browser-api-event', listener);
      dispatchWindowEvent(new CustomEvent('test-browser-api-event'));
      expect(listener).toHaveBeenCalled();
      window.removeEventListener('test-browser-api-event', listener);
    });
  });

  describe('elementFromPoint', () => {
    it('delegates to document.elementFromPoint', () => {
      const spy = vi.spyOn(document, 'elementFromPoint').mockReturnValue(null);
      elementFromPoint(10, 20);
      expect(spy).toHaveBeenCalledWith(10, 20);
      spy.mockRestore();
    });
  });

  describe('getActiveElement', () => {
    it('returns document.activeElement', () => {
      expect(getActiveElement()).toBe(document.activeElement);
    });
  });

  describe('querySelector', () => {
    it('delegates to document.querySelector', () => {
      const spy = vi.spyOn(document, 'querySelector').mockReturnValue(null);
      querySelector('.foo');
      expect(spy).toHaveBeenCalledWith('.foo');
      spy.mockRestore();
    });
  });

  describe('querySelectorAll', () => {
    it('delegates to document.querySelectorAll', () => {
      const spy = vi.spyOn(document, 'querySelectorAll').mockReturnValue(document.querySelectorAll('.foo'));
      querySelectorAll('.bar');
      expect(spy).toHaveBeenCalledWith('.bar');
      spy.mockRestore();
    });
  });

  describe('elementsFromPoint', () => {
    it('delegates to document.elementsFromPoint', () => {
      if (!('elementsFromPoint' in document)) {
        // Skip in environments (e.g. happy-dom) that lack this API
        return;
      }
      const spy = vi.spyOn(document, 'elementsFromPoint').mockReturnValue([]);
      elementsFromPoint(5, 10);
      expect(spy).toHaveBeenCalledWith(5, 10);
      spy.mockRestore();
    });
  });

  describe('addDocumentEventListener / removeDocumentEventListener', () => {
    it('registers and removes a document listener', () => {
      const listener = vi.fn();
      addDocumentEventListener('click', listener);
      document.dispatchEvent(new MouseEvent('click'));
      expect(listener).toHaveBeenCalled();

      removeDocumentEventListener('click', listener);
      document.dispatchEvent(new MouseEvent('click'));
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });
});
