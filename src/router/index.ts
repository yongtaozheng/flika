import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: () => import('../views/HomePage.vue'),
    },
    {
      path: '/filmstrip',
      name: 'filmstrip',
      component: () => import('../views/FilmStripPage.vue'),
    },
  ],
})

export default router
