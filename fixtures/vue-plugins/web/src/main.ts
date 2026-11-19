import { createApp, defineAsyncComponent } from 'vue';
import { createVuetify } from 'vuetify';
import PrimeVue from 'primevue/config';
import Button from 'primevue/button';
import UiKit from '@shop/ui-kit';

import App from './App.vue';
import { badges } from './plugins/badges';
import { router } from './router';

const vuetify = createVuetify();
const app = createApp(App);
app.use(router).use(vuetify).use(PrimeVue).use(UiKit).use(badges);
app.component('Button', Button);
app.component('OrderChart', defineAsyncComponent(() => import('./components/OrderChart.vue')));
app.mount('#app');
