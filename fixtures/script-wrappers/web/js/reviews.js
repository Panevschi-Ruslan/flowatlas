// A jQuery plugin's wrapper: `$` is the jQuery the page's script tag loads.
!function ($) {
  window.reviews = {
    list: function (id) {
      return $.getJSON(SHOP + '/items/' + id + '/reviews');
    },
  };
}(jQuery);
