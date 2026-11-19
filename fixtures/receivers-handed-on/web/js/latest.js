// One function handed instances made with different bases, by two callers.
function latest(client) {
  return client.get('/latest');
}

function latestReviews() {
  return latest(axios.create({ baseURL: 'https://reviews.example.test' }));
}

function latestRatings() {
  return latest(axios.create({ baseURL: 'https://ratings.example.test' }));
}

// The same, handed where no function can carry each: the path alone, and a row.
class Feed {
  constructor(client) {
    this.client = client;
  }

  recent() {
    return this.client.get('/recent');
  }
}

const reviewsFeed = new Feed(axios.create({ baseURL: 'https://reviews.example.test' }));
const ratingsFeed = new Feed(axios.create({ baseURL: 'https://ratings.example.test' }));
