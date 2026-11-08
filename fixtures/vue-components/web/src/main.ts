import { createApp } from 'vue';

import App from './App.vue';
import AppIcon from './components/AppIcon.vue';
import CartSummary from './components/CartSummary.vue';
import { router } from './router';

const app = createApp(App);
// Registered for every template, under the name each is written with.
app.component('AppIcon', AppIcon);
app.component('cart-summary', CartSummary);
app.use(router).mount('#app');
