export default defineAppConfig({
  ui: {
    colors: {
      primary: 'gray',
      //primary: 'mist',
      //neutral: 'slate',
    },
    toast: {
      slots: {
        title: 'select-text',
        description: 'select-text',
      },
    },
  },
});
