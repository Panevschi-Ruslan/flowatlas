// The top of the script only builds an object, whose handler sits in a list.
window.app = {
  forms: [
    {
      name: 'order',
      submit: function () {
        return superagent.post(SHOP + '/orders').send({ item: 1 });
      },
    },
  ],
};
