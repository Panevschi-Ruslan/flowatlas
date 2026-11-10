/**
 * Where the API is. The id is written down by hand once it is first deployed.
 */
const API_ID = 'k7m2p9q4r1'; // set after the first deploy
const API_REGION = 'eu-west-1';

const API_ROOT = `https://${API_ID}.execute-api.${API_REGION}.amazonaws.com`;
const SLOTS_ENDPOINT = `${API_ROOT}/dev/slots`;
const BOOK_ENDPOINT = `${API_ROOT}/dev/bookings`;
const FORECAST_ENDPOINT = `https://${API_ID}.execute-api.eu-central-1.amazonaws.com/dev/forecast`;
