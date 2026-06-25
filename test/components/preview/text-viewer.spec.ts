import { describe, it, expect } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import TextViewer from '~/components/preview/TextViewer.vue';

describe('TextViewer', () => {
  it('renders content in pre tag', async () => {
    const component = await mountSuspended(TextViewer, {
      props: { content: 'Hello World' },
    });

    expect(component.find('pre').exists()).toBe(true);
    expect(component.text()).toContain('Hello World');
  });

  it('renders empty content', async () => {
    const component = await mountSuspended(TextViewer, {
      props: { content: '' },
    });

    expect(component.find('pre').exists()).toBe(true);
  });

  it('preserves whitespace', async () => {
    const component = await mountSuspended(TextViewer, {
      props: { content: 'line1\nline2' },
    });

    expect(component.find('pre').classes()).toContain('whitespace-pre-wrap');
  });

  it('renders multiline content', async () => {
    const component = await mountSuspended(TextViewer, {
      props: { content: 'line1\nline2\nline3' },
    });

    expect(component.text()).toContain('line1');
    expect(component.text()).toContain('line2');
    expect(component.text()).toContain('line3');
  });
});
