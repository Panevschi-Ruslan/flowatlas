// The top of the script only news a constructor, handing it a handler
// nothing keeps as a function of its own: the top answers for it.
new Router({
  '/catalog': function () {
    return ky.get(SHOP + '/catalog');
  },
});
