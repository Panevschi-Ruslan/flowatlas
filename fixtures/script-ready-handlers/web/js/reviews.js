// jQuery hands a ready handler itself: `$` is the jQuery the page loads, and
// the data of a GET is its query.
jQuery(function ($) {
  $.get(SHOP + '/reviews', { page: 1 }, function (reviews) {
    $('#app').text(reviews.length);
  });
});
