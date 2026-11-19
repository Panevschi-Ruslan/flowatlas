function cancelBooking(id) {
  const request = new XMLHttpRequest();
  request.open('DELETE', `${API_ROOT}/bookings/${id}`);
  request.send();
}
