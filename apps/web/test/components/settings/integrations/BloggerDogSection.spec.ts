import { describe, it, expect } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import BloggerDogSection from '~/components/settings/integrations/BloggerDogSection.vue';

const IntegrationAccountSectionStub = {
  props: [
    'integrationKey',
    'title',
    'hintKey',
    'connectActionKey',
    'apiUrlConfigKey',
    'uiUrlConfigKey',
    'target',
    'includeStt',
    'missingConfigFallback',
  ],
  template:
    '<div class="ias-stub" :data-integration-key="integrationKey" :data-target="target" :data-include-stt="includeStt" :data-title="title" />',
};

describe('BloggerDogSection', () => {
  it('renders IntegrationAccountSection with BloggerDog config', async () => {
    const component = await mountSuspended(BloggerDogSection, {
      global: { stubs: { IntegrationAccountSection: IntegrationAccountSectionStub } },
    });

    const stub = component.find('.ias-stub');
    expect(stub.exists()).toBe(true);
    expect(stub.attributes('data-integration-key')).toBe('fastcatPublicador');
    expect(stub.attributes('data-target')).toBe('bloggerdog');
    expect(stub.attributes('data-include-stt')).toBe('false');
    expect(stub.attributes('data-title')).toBe('BloggerDog');
  });
});
