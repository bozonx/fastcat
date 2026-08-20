import { describe, it, expect } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import FastcatAccountSection from '~/components/settings/integrations/FastcatAccountSection.vue';

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

describe('FastcatAccountSection', () => {
  it('renders IntegrationAccountSection with Fastcat Account config', async () => {
    const component = await mountSuspended(FastcatAccountSection, {
      global: { stubs: { IntegrationAccountSection: IntegrationAccountSectionStub } },
    });

    const stub = component.find('.ias-stub');
    expect(stub.exists()).toBe(true);
    expect(stub.attributes('data-integration-key')).toBe('fastcatAccount');
    expect(stub.attributes('data-target')).toBe('fastcat');
    expect(stub.attributes('data-include-stt')).toBe('true');
    expect(stub.attributes('data-title')).toBe('Fastcat Account');
  });
});
