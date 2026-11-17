// superagent called as a function, the verb before the address, and its
// query handed to `.query` along the chain.
$(document).ready(function () {
  superagent('GET', SHOP + '/orders').query({ page: 1 });

  $('#order').on('click', function () {
    superagent('POST', SHOP + '/orders').set('Accept', 'application/json').send({ item: 1 });
  });
});
