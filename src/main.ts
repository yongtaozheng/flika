import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import router from './router'
import { createTracker } from '@jyeontu/web-tracker';

const hostname = location.hostname;
const tracker = createTracker({
  appId: 'flika',
  reportUrl: `http://${hostname}:3003/addVisitRecord`,
});

// 登录后设置用户标识
tracker.setUser('user_123');

createApp(App).use(router).mount('#app')
