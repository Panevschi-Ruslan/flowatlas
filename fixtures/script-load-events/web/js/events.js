// Load events beyond DOMContentLoaded and load, each a function of its own.
window.addEventListener('pageshow', function () {
  fetch(SHOP + '/cart');
});

document.onreadystatechange = function () {
  if (document.readyState === 'complete') {
    ky.get(SHOP + '/stock');
  }
};

// jQuery 1's load shorthand on the page's object.
$(window).load(function () {
  $.getJSON(SHOP + '/reviews', { page: 1 });
});
