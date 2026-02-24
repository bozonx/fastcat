import { defineNuxtPlugin } from '#app';
import { initEffects } from '~/effects';

export default defineNuxtPlugin(() => {
  initEffects();
});
