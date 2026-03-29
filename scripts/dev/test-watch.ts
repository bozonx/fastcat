import { ref, watch } from 'vue';

const settings = ref({ val: 1 });
const isLoading = ref(true);

watch(
  settings,
  () => {
    console.log('Watcher ran. isLoading:', isLoading.value);
  },
  { deep: true },
);

settings.value = { val: 2 };
isLoading.value = false;

setTimeout(() => {
  console.log('Timeout');
}, 0);
